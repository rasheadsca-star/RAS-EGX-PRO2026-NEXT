import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY } from '../src/policy.js';
import { scoreBars } from '../src/originalScore.js';
import { analyzeTicker, analyzeTickerBase, blendFusionScore, rankAnalyses } from '../src/engine.js';
import { assessDataQuality, normalizeBars } from '../src/quality.js';
import { wilsonLowerBound95, summarizeConfidence } from '../src/confidence.js';

function bars(n=220,{start=20,drift=.1,vol=1_500_000,noise=.15}={}){
  const out=[]; let p=start; const d=new Date('2025-10-01T00:00:00Z');
  for(let i=0;i<n;i++){
    const wave=Math.sin(i/4)*noise;
    const open=p+wave*.2;
    const close=Math.max(.5,p+drift+wave);
    const high=Math.max(open,close)+.25+Math.abs(Math.sin(i))*noise;
    const low=Math.min(open,close)-.25-Math.abs(Math.cos(i))*noise;
    out.push({date:d.toISOString().slice(0,10),open,high,low,close,volume:vol*(.9+(i%7)/20)});
    p=close; d.setUTCDate(d.getUTCDate()+1);
  }
  return out;
}

test('RC2 permissions remain hard blocked',()=>{
  assert.equal(POLICY.permissions.executionAllowed,false);
  assert.equal(POLICY.permissions.automaticOrders,false);
  assert.equal(POLICY.permissions.automaticChampionPromotion,false);
});

test('original scoreBars is deterministic',()=>{
  const x=bars();
  assert.deepEqual(scoreBars(x),scoreBars(x));
});

test('original technical score includes SMA200 when enough history',()=>{
  const s=scoreBars(bars());
  assert.match(s.breakdown[0].detail,/SMA200/);
  assert.ok(Number.isFinite(s.score));
});

test('stale data blocks before historical confidence',()=>{
  const a=analyzeTicker({ticker:'X',rows:bars(),historyMeta:{staleData:true}});
  assert.equal(a.eligible,false);
  assert.equal(a.historicalConfidence,null);
});

test('illiquid data cannot be rescued by historical confidence',()=>{
  const a=analyzeTicker({ticker:'X',rows:bars(220,{vol:10})});
  assert.equal(a.eligible,false);
  assert.ok(a.reasonCodes.includes('LIQUIDITY_GATE_FAIL'));
});

test('technical score below gate cannot be rescued',()=>{
  const a=analyzeTicker({ticker:'X',rows:bars(220,{drift:-.08})});
  if(a.scores?.core<POLICY.minCoreScore){
    assert.equal(a.eligible,false);
    assert.equal(a.historicalConfidence,null);
  }
});

test('RR below floor cannot be rescued',()=>{
  for(let s=1;s<80;s++){
    const a=analyzeTickerBase({ticker:'X',rows:bars(220,{noise:.1+s/100})});
    if(a.tradePlan&&a.tradePlan.structuralNetRR<POLICY.minStructuralNetRR){
      assert.equal(a.eligible,false);
      assert.ok(a.reasonCodes.includes('STRUCTURAL_RR_LOW'));
      return;
    }
  }
});

test('do not chase cannot be rescued',()=>{
  for(let s=1;s<80;s++){
    const a=analyzeTickerBase({ticker:'X',rows:bars(220,{drift:.02+s/1000,noise:.2})});
    if(a.tradePlan?.alignmentState==='DO_NOT_CHASE'){
      assert.equal(a.eligible,false);
      assert.ok(a.reasonCodes.includes('DO_NOT_CHASE'));
      return;
    }
  }
});

test('Wilson penalizes tiny samples',()=>{
  assert.ok(wilsonLowerBound95(3,3)<wilsonLowerBound95(30,45));
});

test('historical confidence exposes low reliability for small samples',()=>{
  const c=summarizeConfidence([{outcome:'TARGET1',netPct:1}]);
  assert.equal(c.sampleReliability,.2);
  assert.equal(c.hasEnoughSample,false);
  assert.equal(c.effectiveHistoricalScore,c.confidenceWilsonLower95Pct);
});

test('missing historical evidence is neutral in fusion',()=>{
  const b=blendFusionScore(82,{historicalTradeCount:0,sampleReliability:0,confidenceWilsonLower95Pct:null});
  assert.equal(b.fusionRank,82);
  assert.equal(b.researchWeight,1);
  assert.equal(b.historicalWeight,0);
});

test('historical weight increases gradually with evidence',()=>{
  const small=blendFusionScore(80,{sampleReliability:.2,confidenceWilsonLower95Pct:60});
  const full=blendFusionScore(80,{sampleReliability:1,confidenceWilsonLower95Pct:60});
  assert.equal(small.historicalWeight,.05);
  assert.equal(full.historicalWeight,.25);
  assert.ok(small.fusionRank>full.fusionRank);
});

test('fusion rank cannot make ineligible items rank',()=>{
  const ranked=rankAnalyses([{ticker:'X',eligible:false,scores:{fusionRank:100,research:100,core:100,supportResistance:100,liquidity:100}}]);
  assert.equal(ranked.length,0);
});

test('duplicate dates are deduplicated',()=>{
  const x=bars(70); x.push({...x[5]});
  assert.equal(normalizeBars(x).bars.length,70);
});

test('large conflict creates publication hold but not identity block',()=>{
  const q=assessDataQuality({bars:bars(80),warnings:['latest_close_conflict:25%'],symbolVerified:true,symbolVerification:{verified:true}});
  assert.equal(q.publicationHold,true);
  assert.notEqual(q.state,'BLOCKED');
});
