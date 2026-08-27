import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalCycleEngine, metaStrategyEngine, structureRetestEngine } from '../src/strategies.js';

const day=(i)=>new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);

function breakoutSeries(){
  const bars=[];
  for(let i=0;i<90;i++){
    const wave=Math.sin(i/4)*1.8,base=96+Math.min(i,70)*0.035;
    let close=base+wave,high=close+1,low=close-1,volume=1000;
    if([24,42,61,72].includes(i)){high=100.1+(i%2)*0.15;close=98.7;low=97.8;}
    bars.push({date:day(i),open:close-.2,high,low,close,volume});
  }
  bars.push({date:day(90),open:99.4,high:103.2,low:99.2,close:102.6,volume:2500});
  bars.push({date:day(91),open:102.1,high:102.3,low:99.7,close:100.8,volume:900});
  bars.push({date:day(92),open:100.9,high:103.4,low:100.7,close:103.0,volume:1300});
  return bars;
}

function cycleSeries(){
  const bars=[];
  for(let i=0;i<360;i++){
    const cycle=2*Math.PI*i/42,close=100+11*Math.sin(cycle-Math.PI/2)+i*0.025;
    bars.push({date:day(i),open:close-.15,high:close+1.1,low:close-1.1,close,volume:1200+Math.round(150*Math.cos(cycle))});
  }
  return bars;
}

test('structure retest engine confirms a breakout followed by a successful retest',()=>{
  const x=structureRetestEngine(breakoutSeries(),{strategies:{structureRetest:{minBreakoutVolumeRatio:1.2,breakoutSearchSessions:8,retestWindowSessions:5,minTouches:2}}});
  assert.equal(x.raw.resistance.pass,true);
  assert.equal(x.raw.resistance.status,'BREAKOUT_RETEST_CONFIRMED');
  assert.ok(x.raw.resistance.touches>=2);
  assert.ok(Number(x.raw.resistance.breakout.volumeRatio)>1.2);
  assert.ok(x.score>50);
});

test('historical cycle engine reports recurring bottom-to-peak structure without pretending it is calibrated probability',()=>{
  const x=historicalCycleEngine(cycleSeries(),{strategies:{historicalCycle:{minSamples:3,minAdvancePct:8,minBottomSeparationSessions:15,maxCycleSessions:100}}});
  assert.ok(x.raw.samples>=3);
  assert.equal(x.raw.calibratedProbability,false);
  assert.equal(x.raw.interpretation,'HISTORICAL_ALIGNMENT_SCORE_NOT_PROBABILITY');
  assert.ok(Number(x.raw.median_bottom_to_bottom_sessions)>25);
  assert.ok(Number(x.raw.median_bottom_to_bottom_sessions)<60);
  assert.ok(Number(x.raw.median_advance_pct)>8);
});

test('meta strategy stays challenger-only and cannot change eligibility',()=>{
  const row={
    structureRetest:{raw:{resistance:{pass:true,score:88,status:'BREAKOUT_RETEST_CONFIRMED'},support:{pass:false,score:20,status:'NO_SUPPORT_RECLAIM'}}},
    historicalCycle:{pass:true,score:75,raw:{cycle_phase:'IN_TYPICAL_PEAK_WINDOW'}},entry:{score:70,raw:{status:'READY NOW'}},vcp:{pass:true,score:68}
  };
  const meta=metaStrategyEngine(row,{strategies:{challengerMode:true}});
  assert.equal(meta.mode,'CHALLENGER');
  assert.equal(meta.eligibilityImpact,'NONE_CHALLENGER_MODE');
  assert.equal(meta.bestStrategy,'BREAKOUT_RETEST');
  assert.ok(meta.confirmationCount>=2);
});
