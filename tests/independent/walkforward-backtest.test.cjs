'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {POLICY,signalAt,walkForwardBacktest}=require('../../scripts/independent/walkforward-backtest.cjs');
const {historicalBarValid}=require('../../scripts/independent/egx-independent-paper.cjs');
// DETERMINISTIC UNIT FIXTURES ONLY; these are NOT real EGX market data or performance claims.
const fixture=(n=155)=>Array.from({length:n},(_,i)=>{
 const date=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
 const close=100+i*0.2;
 return {date,sourceSessionDate:date,open:close-0.1,high:close+1,low:close-1,
  close,volume:100000,validationStatus:'precise_public_source_session_confirmed',
  sourceSessionEvidence:'UNIT_TEST_FIXTURE_NOT_MARKET_DATA',verifiedBy:['unit_test'],
  sourceUrls:{primary:'https://example.org/fixture'},fetchedAt:'2026-10-28T07:00:00Z'};
});
const run=(bars,extra={})=>walkForwardBacktest(bars,{barValid:historicalBarValid,...extra});
test('chronological holdout is separate, costed, next-open only, and never certified',()=>{
 const bars=fixture(),out=run(bars);
 assert.equal(out.status,'OOS_RESEARCH_RESULTS_NOT_CERTIFIED');
 assert.equal(out.oosBars,bars.length-POLICY.trainBars);
 assert.equal(out.oosStartSession,bars[POLICY.trainBars].date);
 assert.equal(out.performanceCertified,false);assert.ok(out.tradeCount>0);
 assert.equal(out.assumptions.parameterSearch,false);
 for(const t of out.trades){
  assert.ok(t.entrySession>t.signalSession);
  assert.ok(t.exitSession>=t.entrySession);
  assert.ok(t.feesEgp>0);assert.ok(t.shares>0);
 }
 assert.ok(out.trades[0].entryPrice!==bars[POLICY.trainBars-1].close);
});
test('signal is determined by past and current closes, never by next candle',()=>{
 const bars=fixture(),t=110,signal=signalAt(bars,t);
 const changed=fixture();changed[t+1]={...changed[t+1],open:500,high:510,low:90,close:400};
 assert.deepEqual(signalAt(changed,t),signal);
});
test('stop is assumed first on ambiguous stop-and-target session',()=>{
 const bars=fixture();
 const entry=bars[POLICY.trainBars].open;
 bars[POLICY.trainBars].low=entry-10;
 bars[POLICY.trainBars].high=entry+15;
 const out=run(bars);
 assert.ok(out.tradeCount>0);
 assert.equal(out.trades[0].exitReason,'STOP_OR_AMBIGUOUS');
 assert.ok(out.trades[0].netPnlEgp<0);
});
test('unverified or reconstructed history cannot be performance-tested',()=>{
 const bars=fixture();bars[33].warnings=['partial_ohlc_reconstructed_from_close'];
 const out=run(bars);
 assert.equal(out.status,'UNVERIFIED_OR_DUPLICATE_HISTORICAL_OHLCV');
 assert.equal(out.tradeCount,0);
});
test('missing primary provenance and duplicate dates fail closed',()=>{
 const noEvidence=fixture();delete noEvidence[5].sourceUrls;
 assert.equal(run(noEvidence).status,'UNVERIFIED_OR_DUPLICATE_HISTORICAL_OHLCV');
 const duplicate=fixture();duplicate[40].date=duplicate[39].date;
 duplicate[40].sourceSessionDate=duplicate[39].date;
 assert.equal(run(duplicate).status,'UNVERIFIED_OR_DUPLICATE_HISTORICAL_OHLCV');
});
test('insufficient chronological holdout never reports a performance result',()=>{
 const out=run(fixture(120));
 assert.equal(out.status,'INSUFFICIENT_VERIFIED_HISTORY');
 assert.equal(out.barsRequired,140);
 assert.equal(out.performanceCertified,false);
});
test('unverified USD/EGP liquidity units cannot be backtested as EGP',()=>{
 assert.equal(run(fixture(),{currency:'USD'}).status,'EGP_LIQUIDITY_UNIT_UNVERIFIED');
});

test('historical source conflicts block OOS backtest even with plausible OHLCV',()=>{
 const bars=fixture();bars[35].warnings=['source_conflict'];
 const out=run(bars);
 assert.equal(out.status,'UNVERIFIED_OR_DUPLICATE_HISTORICAL_OHLCV');
 assert.equal(out.tradeCount,0);assert.equal(out.performanceCertified,false);
});
