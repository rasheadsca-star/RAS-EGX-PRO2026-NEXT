import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedRetestReclaimV2, cyclePatternSimilarityEngine } from '../src/strategy-lab-v2.js';

const day=(i)=>new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10);

function breakoutSeries(){
  const bars=[];
  for(let i=0;i<120;i++){
    let close=96+Math.sin(i/5)*1.5,high=close+1,low=close-1,volume=1000;
    if([25,45,65,85,103].includes(i)){high=100.2;close=98.7;low=97.9;}
    bars.push({date:day(i),open:close-.2,high,low,close,volume});
  }
  bars.push({date:day(120),open:99.4,high:103.4,low:99.3,close:102.8,volume:2600});
  bars.push({date:day(121),open:102.0,high:102.2,low:99.65,close:100.7,volume:800});
  bars.push({date:day(122),open:100.9,high:103.8,low:100.7,close:103.4,volume:1300});
  return bars;
}

function cycleSeries(){
  const bars=[];
  for(let i=0;i<700;i++){
    const cycle=2*Math.PI*i/48,close=100+10*Math.sin(cycle-Math.PI/2)+i*.018+1.2*Math.sin(i/7);
    bars.push({date:day(i),open:close-.15,high:close+1,low:close-1,close,volume:1200+150*Math.cos(cycle)});
  }
  return bars;
}

test('V2 retest requires breakout then a later retest then a later reclaim',()=>{
  const x=confirmedRetestReclaimV2(breakoutSeries(),{strategies:{retestReclaimV2:{minBreakoutVolumeRatio:1.2,minRiskPct:1,maxRiskPct:10}}});
  assert.equal(x.pass,true);
  assert.equal(x.raw.status,'RETEST_RECLAIM_CONFIRMED');
  assert.notEqual(x.raw.breakout.date,x.raw.retest.date);
  assert.notEqual(x.raw.retest.date,x.raw.reclaim.date);
  assert.ok(Number(x.raw.retest.volumeVsBreakout)<.85);
  assert.equal(x.raw.plan.valid,true);
  assert.ok(Number(x.raw.plan.stopLoss)<Number(x.raw.plan.referenceEntry));
  assert.ok(Number(x.raw.plan.precisionTarget.price)>Number(x.raw.plan.referenceEntry));
  assert.equal(x.raw.promotionAllowed,false);
  assert.equal(x.raw.automaticEligibilityImpact,'NONE');
});

test('V2 retest does not confirm on breakout bar alone',()=>{
  const bars=breakoutSeries().slice(0,-2);
  const x=confirmedRetestReclaimV2(bars,{strategies:{retestReclaimV2:{minBreakoutVolumeRatio:1.2,minRiskPct:1,maxRiskPct:10}}});
  assert.equal(x.pass,false);
});

test('cycle pattern similarity uses only historical analogs and reports empirical evidence',()=>{
  const x=cyclePatternSimilarityEngine(cycleSeries(),{strategies:{cyclePatternSimilarity:{minSamples:5,minimumSimilarity:45,minWeightedHitPct:0,minScore:0}}});
  assert.ok(Number(x.raw.samples)>=5);
  assert.equal(x.raw.promotionAllowed,false);
  assert.equal(x.raw.automaticEligibilityImpact,'NONE');
  assert.equal(x.raw.interpretation,'EMPIRICAL_ANALOG_HIT_RATE_NOT_GUARANTEED_PROBABILITY');
  assert.equal(x.raw.launchDefinition.sameBarAmbiguity,'STOP_FIRST');
  assert.ok(Array.isArray(x.raw.analogs));
  assert.ok(x.raw.analogs.every(a=>String(a.asOfDate)<String(cycleSeries().at(-1).date)));
});
