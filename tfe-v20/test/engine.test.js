import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY } from '../src/policy.js';
import { normalizeBars, assessDataQuality, parseLatestConflictPct } from '../src/quality.js';
import { analyzeTicker, rankAnalyses } from '../src/engine.js';
import { backtestHistory, summarizeBacktest } from '../src/backtest.js';

function bars(n=100,{start=20,drift=.11,vol=1_500_000,noise=.18}={}){
  const out=[]; let p=start; const d=new Date('2026-01-01T00:00:00Z');
  for(let i=0;i<n;i++){
    const wave=Math.sin(i/4)*noise; const open=p+wave*.25; const close=Math.max(.5,p+drift+wave);
    const high=Math.max(open,close)+.25+Math.abs(Math.sin(i))*noise;
    const low=Math.min(open,close)-.25-Math.abs(Math.cos(i))*noise;
    out.push({date:d.toISOString().slice(0,10),open,high,low,close,volume:vol*(.9+(i%7)/20)});
    p=close; d.setUTCDate(d.getUTCDate()+1);
  }
  return out;
}

test('policy hard blocks execution',()=>{assert.equal(POLICY.permissions.executionAllowed,false);assert.equal(POLICY.permissions.automaticOrders,false);assert.equal(POLICY.permissions.automaticChampionPromotion,false);assert.equal(POLICY.minStructuralNetRR,.7)});
test('normalize deduplicates and rejects broken OHLC',()=>{const x=bars(3);x.push({...x[1],close:-1});x.push({...x[2]});const n=normalizeBars(x);assert.equal(n.bars.length,3);assert.equal(n.rejected,1)});
test('normalize sorts dates',()=>{const x=bars(5).reverse();const n=normalizeBars(x);assert.ok(n.bars[0].date<n.bars[4].date)});
test('conflict parser',()=>assert.equal(parseLatestConflictPct(['latest_close_conflict:7.25%']),7.25));
test('quality blocks short history',()=>{const q=assessDataQuality({bars:bars(20),warnings:[]});assert.equal(q.state,'BLOCKED')});
test('quality blocks corporate action review',()=>{const q=assessDataQuality({bars:bars(80),warnings:['corporate_action_review_required']});assert.equal(q.state,'BLOCKED')});
test('quality reviews moderate conflict',()=>{const q=assessDataQuality({bars:bars(80),warnings:['latest_close_conflict:8%']});assert.equal(q.state,'REVIEW')});
test('quality blocks large conflict',()=>{const q=assessDataQuality({bars:bars(80),warnings:['latest_close_conflict:25%']});assert.equal(q.state,'BLOCKED')});
test('quality blocks symbol reference divergence above declared guard',()=>{const q=assessDataQuality({bars:bars(80),symbolVerified:true,symbolVerification:{guardedVerified:false,evidence:{localDifferencePct:12,guardedMaxDifferencePct:8}}});assert.equal(q.state,'BLOCKED');assert.ok(q.reasons.includes('SYMBOL_REFERENCE_DIVERGENCE'))});
test('quality accepts guarded identity reconciliation',()=>{const q=assessDataQuality({bars:bars(80),symbolVerified:true,symbolVerification:{guardedVerified:true,evidence:{localDifferencePct:12,guardedMaxDifferencePct:8}}});assert.notEqual(q.state,'BLOCKED')});
test('analysis always research only',()=>{const a=analyzeTicker({ticker:'TEST',rows:bars(100),historyMeta:{warnings:[]}});assert.equal(a.permissions.executionAllowed,false);assert.equal(a.researchOnly,true)});
test('analysis requires ticker',()=>assert.throws(()=>analyzeTicker({rows:bars(100)}),/TICKER_REQUIRED/));
test('short history returns no recommendation',()=>{const a=analyzeTicker({ticker:'X',rows:bars(30)});assert.equal(a.eligible,false);assert.equal(a.decision,'NO_RECOMMENDATION')});
test('analysis exposes separate precision and structural targets when plan exists',()=>{const a=analyzeTicker({ticker:'X',rows:bars(120),historyMeta:{warnings:[]}});if(a.tradePlan){assert.ok(a.tradePlan.target2>=a.tradePlan.target1);assert.ok(a.tradePlan.structuralNetRR!==null)}});
test('rank only eligible',()=>{const xs=[{ticker:'B',eligible:true,scores:{research:80,core:80,supportResistance:80,liquidity:80}},{ticker:'A',eligible:false,scores:{research:99}},{ticker:'C',eligible:true,scores:{research:90,core:70,supportResistance:70,liquidity:70}}];const r=rankAnalyses(xs);assert.deepEqual(r.map(x=>x.ticker),['C','B'])});
test('rank deterministic tie breaker',()=>{const z={eligible:true,scores:{research:80,core:80,supportResistance:80,liquidity:80}};assert.deepEqual(rankAnalyses([{...z,ticker:'B'},{...z,ticker:'A'}]).map(x=>x.ticker),['A','B'])});
test('V17 overlay can never grant execution',()=>{const a=analyzeTicker({ticker:'X',rows:bars(100),v17:{status:'READY',readiness:{executionReady:true},recommendations:[{ticker:'X',executionAllowed:true}]}});assert.equal(a.v17.executionAllowed,false);assert.equal(a.v17.matchedRecommendation.executionAllowed,false)});
test('discovery score is provenance only',()=>{const a=analyzeTicker({ticker:'X',rows:bars(100),discovery:{rank:1,nativeResearchScore:99}});assert.equal(a.discovery.source,'V20_NATIVE_DISCOVERY_ONLY_NOT_SCORING_INPUT')});
test('backtest uses next session or later',()=>{const r=backtestHistory({ticker:'X',rows:bars(140,{drift:.18})});for(const t of r.trades)assert.ok(t.entryDate>t.signalDate)});
test('backtest charges transaction cost',()=>{const s=summarizeBacktest([{outcome:'TARGET1',netPct:1},{outcome:'STOP',netPct:-.5}],[]);assert.equal(s.summary.entered,2);assert.equal(s.summary.avgNetPct,.25)});
test('wilson bound never exceeds observed target rate',()=>{const s=summarizeBacktest(Array.from({length:10},(_,i)=>({outcome:i<7?'TARGET1':'STOP',netPct:i<7?1:-1})),[]);assert.ok(s.summary.wilson95LowerTarget1Pct<=70)});
test('analysis does not mutate caller OHLC rows',()=>{const x=bars(90);const before=JSON.stringify(x);analyzeTicker({ticker:'IMM',rows:x});assert.equal(JSON.stringify(x),before)});
