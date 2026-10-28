'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate,validBar}=require('../../scripts/independent/egx-independent-paper.cjs');
const session='2026-10-27';
const sample=Array.from({length:61},(_,i)=>({date:i===60?session:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),
 sourceSessionDate:i===60?session:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),
 open:100+i,high:102+i,low:99+i,close:101+i,volume:20000,currency:'EGP',
 sourceSessionEvidence:'dated_primary_market_volume_evidence',verifiedBy:['mubasher_symbol_pages'],
 sourceUrls:{primary:'https://english.mubasher.info/markets/EGX/stocks/TEST/'},fetchedAt:'2026-10-28T07:00:00Z',
 validationStatus:'precise_public_source_session_confirmed'}));
function run(changes={}){
 return evaluate({session,price:{expectedSession:session,ready:true,executionGrade:true,acceptedRows:190,sampleAccepted:[{ticker:'TEST'}]},
 handoff:{sessionDate:session,acceptedRows:190},symbols:[{ticker:'TEST',active:true,currency:'EGP',exchange:'EGX'}],
 loadHistory:()=>({symbolVerified:true,isin:'EG0000000000',ticker:'TEST',currency:'EGP',exchange:'EGX',sessions:sample}),...changes});
}
test('failed fresh source cannot release stale or inferred paper recommendations',()=>{
 const x=run({price:{expectedSession:session,ready:false,executionGrade:false,acceptedRows:0}});
 assert.equal(x.status,'RESEARCH_ONLY_PRICE_GATE_BLOCKED');
 assert.deepEqual(x.recommendations,[]);assert.deepEqual(x.watchlist,[]);
 assert.equal(x.researchWatchlist.length,1);
 assert.equal(x.researchWatchlist[0].state,'RESEARCH_ONLY_NO_EXECUTION');
});
test('Astra G22 handoff mismatch cannot block independent research',()=>{
 const x=run({handoff:{sessionDate:session,acceptedRows:189}});
 assert.equal(x.inputs.handoffAligned,false);
 assert.ok(x.diagnostics.includes('ASTRA_HANDOFF_NOT_ALIGNED_INFORMATIONAL'));
 assert.equal(x.status,'RESEARCH_READY_PAPER_VALIDATION_REQUIRED');
 assert.equal(x.verifiedCandidates.length,1);
 assert.equal(x.executable,false);assert.deepEqual(x.recommendations,[]);
});
test('suspicious reconstructed bar is rejected',()=>{
 assert.equal(validBar({...sample.at(-1),warnings:['partial_ohlc_reconstructed_from_close_or_previous_close']},session),false);
});
test('valid data may create research candidates but never executable recommendations',()=>{
 const x=run();assert.equal(x.executable,false);assert.equal(x.recommendations.length,0);
 assert.equal(x.status,'RESEARCH_READY_PAPER_VALIDATION_REQUIRED');
 assert.equal(x.verifiedCandidates.length,1);
 assert.ok(x.blockers.includes('NO_INDEPENDENT_OUT_OF_SAMPLE_PERFORMANCE_CERTIFICATION'));
});

test('duplicate lookback dates cannot inflate SMA/ATR observations',()=>{
 const bars=sample.map(r=>({...r}));
 bars[30].date=bars[29].date;bars[30].sourceSessionDate=bars[29].sourceSessionDate;
 const x=run({loadHistory:()=>({symbolVerified:true,isin:'EG0000000000',sessions:bars})});
 assert.equal(x.verifiedCandidates.length,0);assert.equal(x.watchlist.length,0);
});
test('reconstructed historical OHLC is excluded from independent signals',()=>{
 const bars=sample.map(r=>({...r}));
 bars[30].warnings=['partial_ohlc_reconstructed_from_close_or_previous_close'];
 const x=run({loadHistory:()=>({symbolVerified:true,isin:'EG0000000000',sessions:bars})});
 assert.equal(x.verifiedCandidates.length,0);assert.equal(x.watchlist.length,0);
});
test('historical session provenance mismatch cannot enter indicators',()=>{
 const bars=sample.map(r=>({...r}));bars[30].sourceSessionDate='2026-01-01';
 const x=run({loadHistory:()=>({symbolVerified:true,isin:'EG0000000000',sessions:bars})});
 assert.equal(x.verifiedCandidates.length,0);
});
test('history ticker and symbol-map ISIN must agree with requested symbol',()=>{
 const x=run({symbols:[{ticker:'TEST',active:true,isin:'EG1111111111'}],
  loadHistory:()=>({ticker:'OTHER',symbolVerified:true,isin:'EG0000000000',sessions:sample})});
 assert.equal(x.verifiedCandidates.length,0);
});
test('path-like ticker never reaches history loader',()=>{
 let called=false;const x=run({symbols:[{ticker:'../TEST',active:true}],
  price:{expectedSession:session,ready:true,executionGrade:true,acceptedRows:190,sampleAccepted:[{ticker:'../TEST'}]},
  loadHistory:()=>{called=true;throw Error('unsafe path')}});
 assert.equal(called,false);assert.equal(x.verifiedCandidates.length,0);
});

test('an unlisted symbol is research-only, not inferred accepted by an incomplete source sample',()=>{
 const x=run({price:{expectedSession:session,ready:true,executionGrade:true,acceptedRows:190,sampleAccepted:[]}});
 assert.equal(x.verifiedCandidates.length,1);
 assert.equal(x.researchWatchlist.length,1);
 assert.deepEqual(x.watchlist,[]);assert.deepEqual(x.recommendations,[]);
});
test('a missing dated source evidence prevents shadow research on blocked aggregate',()=>{
 const bars=sample.map(r=>({...r}));delete bars.at(-1).sourceSessionEvidence;
 const x=run({price:{expectedSession:session,ready:false,executionGrade:false,acceptedRows:0},
  loadHistory:()=>({ticker:'TEST',currency:'EGP',symbolVerified:true,isin:'EG0000000000',sessions:bars})});
 assert.equal(x.verifiedCandidates.length,0);assert.deepEqual(x.researchWatchlist,[]);
});
test('currency mismatches cannot pass the EGP liquidity test',()=>{
 const x=run({symbols:[{ticker:'TEST',active:true,currency:'USD'}]});
 assert.equal(x.verifiedCandidates.length,0);assert.deepEqual(x.researchWatchlist,[]);
});
test('USD-priced shares never use the EGP liquidity threshold',()=>{
 const bars=sample.map(r=>({...r,currency:'USD'}));
 const x=run({symbols:[{ticker:'TEST',active:true,currency:'USD'}],
  loadHistory:()=>({ticker:'TEST',currency:'USD',symbolVerified:true,isin:'EG0000000000',sessions:bars})});
 assert.equal(x.verifiedCandidates.length,1);assert.equal(x.verifiedCandidates[0].liquid,false);
 assert.deepEqual(x.researchWatchlist,[]);
});
test('an obsolete expected session cannot generate a fresh research snapshot',()=>{
 const x=run({price:{expectedSession:'2026-10-21',ready:false,executionGrade:false,acceptedRows:0}});
 assert.equal(x.status,'BLOCKED');assert.ok(x.blockers.includes('PRICE_SESSION_MISMATCH'));
 assert.deepEqual(x.verifiedCandidates,[]);assert.deepEqual(x.researchWatchlist,[]);
});
test('cross-provider evidence level is explicit, not inferred from one provider',()=>{
 const bars=sample.map(r=>({...r}));bars.at(-1).secondSourceConfirmed=true;
 const x=run({loadHistory:()=>({ticker:'TEST',currency:'EGP',symbolVerified:true,isin:'EG0000000000',sessions:bars})});
 assert.equal(x.verifiedCandidates[0].evidenceLevel,'CROSS_PROVIDER_CONFIRMED');
 const y=run();assert.equal(y.verifiedCandidates[0].evidenceLevel,'DATED_PROVIDER_EVIDENCE');
});

test('partially reconstructed 60-bar history remains an observation, never an SMA/ATR signal',()=>{
 const bars=sample.map(r=>({...r}));
 bars[30].warnings=['partial_ohlc_reconstructed_from_close_or_previous_close'];
 const x=run({price:{expectedSession:session,ready:false,executionGrade:false,acceptedRows:0},
  loadHistory:()=>({ticker:'TEST',currency:'EGP',symbolVerified:true,isin:'EG0000000000',sessions:bars})});
 assert.equal(x.datedPriceObservations.length,1);
 assert.equal(x.datedPriceObservations[0].indicatorReady,false);
 assert.equal(x.datedPriceObservations[0].cleanLookbackBars,59);
 assert.deepEqual(x.verifiedCandidates,[]);assert.deepEqual(x.researchWatchlist,[]);
 assert.deepEqual(x.watchlist,[]);assert.deepEqual(x.recommendations,[]);
});
test('a clean 60-bar series has an independently dated price observation',()=>{
 const x=run();assert.equal(x.datedPriceObservations.length,1);
 assert.equal(x.datedPriceObservations[0].indicatorReady,true);
 assert.equal(x.datedPriceObservations[0].state,'DATED_PRICE_OBSERVATION_NOT_A_SIGNAL');
});
