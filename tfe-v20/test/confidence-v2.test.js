import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfidenceV2, classifyRegime } from '../sidecars/confidence-v2.js';

function bars(n=240){
  const out=[];
  let px=50;
  for(let i=0;i<n;i++){
    px*=1.0025;
    const date=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
    out.push({date,open:px*.995,high:px*1.015,low:px*.985,close:px,volume:2_000_000,valueTraded:px*2_000_000});
  }
  return out;
}

const analysis={
  scores:{core:76,research:78,liquidity:82,supportResistance:74,dataQuality:96},
  quality:{score:96,state:'TRUSTED'},
  tradePlan:{structuralNetRR:1.25,alignmentState:'IN_ENTRY_RANGE'},
};

function historyFrom(xs){
  const t1=xs.filter(x=>x.outcome==='TARGET1').length;
  const wins=xs.filter(x=>x.netPct>0).length;
  const losses=xs.filter(x=>x.netPct<0);
  const gp=xs.filter(x=>x.netPct>0).reduce((s,x)=>s+x.netPct,0);
  const gl=Math.abs(losses.reduce((s,x)=>s+x.netPct,0));
  return {
    trades:xs,
    historicalTradeCount:xs.length,
    target1HitRatePct:xs.length?t1/xs.length*100:null,
    positivePct:xs.length?wins/xs.length*100:null,
    stopRatePct:xs.length?xs.filter(x=>String(x.outcome).startsWith('STOP')).length/xs.length*100:null,
    avgNetPct:xs.length?xs.reduce((s,x)=>s+x.netPct,0)/xs.length:null,
    profitFactor:gl?gp/gl:'INF',
    confidenceWilsonLower95Pct:xs.length?45:null,
  };
}

test('small samples are shrunk and cannot receive strong evidence confidence',()=>{
  const b=bars();
  const trades=[
    {signalDate:b[180].date,outcome:'TARGET1',netPct:4},
    {signalDate:b[190].date,outcome:'TARGET1',netPct:3},
    {signalDate:b[200].date,outcome:'TARGET1',netPct:5},
  ];
  const c=buildConfidenceV2({analysis,bars:b,historicalConfidence:historyFrom(trades)});
  assert.equal(c.evidenceLevel,'THIN');
  assert.ok(c.overallConfidenceScore<=72);
  assert.ok(c.calibratedTarget1ProbabilityPct<100);
  assert.equal(c.recommendationMutationAllowed,false);
  assert.equal(c.executionAllowed,false);
});

test('larger stable samples can earn stronger evidence without changing hard gates',()=>{
  const b=bars();
  const trades=[];
  for(let i=0;i<32;i++){
    trades.push({signalDate:b[120+i*3].date,outcome:i%4===0?'STOP':'TARGET1',netPct:i%4===0?-2.1:3.2});
  }
  const c=buildConfidenceV2({analysis,bars:b,historicalConfidence:historyFrom(trades),mode:'OFFICIAL_CANDIDATE'});
  assert.equal(c.version,'CONFIDENCE_ENGINE_V2');
  assert.equal(c.scoringImpact,'NONE');
  assert.equal(c.methodology.officialHardGatesChanged,false);
  assert.ok(c.historical.sampleReliability>=1);
  assert.equal(c.walkForward.status,'EVALUATED');
  assert.ok(['STRONG','MODERATE'].includes(c.evidenceLevel));
});

test('regime classifier identifies a persistent uptrend',()=>{
  const r=classifyRegime(bars());
  assert.ok(['BULL','BULL_EARLY'].includes(r.trend));
  assert.ok(['LOW','NORMAL','HIGH'].includes(r.volatility));
});

test('confidence sidecar never mutates recommendation or execution state',()=>{
  const c=buildConfidenceV2({analysis,bars:bars(),historicalConfidence:historyFrom([]),mode:'WATCHLIST_SHADOW_RESEARCH_ONLY'});
  assert.equal(c.scoringImpact,'NONE');
  assert.equal(c.recommendationMutationAllowed,false);
  assert.equal(c.executionAllowed,false);
});
