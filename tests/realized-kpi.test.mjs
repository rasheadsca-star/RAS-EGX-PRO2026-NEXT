import assert from 'node:assert/strict';
import fs from 'node:fs';
await import('../realized-kpi.js');
const K=globalThis.EGXOneRealizedKPI;
assert.ok(K,'KPI API missing');
assert.equal(K.CONTRACT.scoringImpact,'NONE');
assert.equal(K.CONTRACT.recommendationMutationAllowed,false);
assert.equal(K.CONTRACT.executionAllowed,false);
assert.equal(K.CONTRACT.automaticOrders,false);
assert.equal(K.CONTRACT.mixesHistoricalAndForward,false);

const sample=[
  {ticker:'AAA',terminalSession:'2026-09-01',outcome:{state:'TARGET1'},netReturnPct:3},
  {ticker:'BBB',terminalSession:'2026-09-01',outcome:{state:'TARGET2'},netReturnPct:5},
  {ticker:'CCC',terminalSession:'2026-09-01',outcome:{state:'STOP'},netReturnPct:-4},
  {ticker:'DDD',terminalSession:'2026-09-02',outcome:{state:'TIMEOUT'},netReturnPct:0.2},
  {ticker:'EEE',terminalSession:'2026-09-02',outcome:{state:'NOT_TRIGGERED'}}
];
const s=K.summarizeRecords(sample);
assert.equal(s.total,4);
assert.equal(s.targetHits,2);
assert.equal(s.target2,1);
assert.equal(s.stops,1);
assert.equal(s.timeouts,1);
assert.equal(s.targetHitRatePct,50);
assert.equal(s.failureRatePct,25);
assert.equal(s.timeoutRatePct,25);
const d=K.buildDaily(sample);
assert.equal(d.length,2);
assert.equal(d[0].date,'2026-09-01');
assert.equal(d[0].total,3);
assert.equal(d[1].date,'2026-09-02');
assert.equal(d[1].total,1);

const historical=K.selectEvidence({resolutions:[],startAfterSession:'2026-08-31'},{records:sample});
assert.equal(historical.forward,false);
assert.equal(historical.evidenceGrade,'POINT_IN_TIME_HISTORICAL_REPLAY');
const forward=K.selectEvidence({resolutions:[sample[0]],startAfterSession:'2026-08-31'},{records:sample});
assert.equal(forward.forward,true);
assert.equal(forward.records.length,1);
assert.equal(forward.evidenceGrade,'FORWARD_SHADOW_FROZEN');

const sim=JSON.parse(fs.readFileSync(new URL('../data/research/simulator/latest.json',import.meta.url),'utf8'));
const actual=K.summarizeRecords(sim.records);
assert.equal(actual.total,sim.performance.allDailySignals.triggered);
assert.equal(actual.targetHits,sim.performance.allDailySignals.target1OrBetter);
assert.equal(actual.stops,sim.performance.allDailySignals.stops);
assert.equal(actual.timeouts,sim.performance.allDailySignals.timeouts);
assert.ok(Math.abs(actual.targetHitRatePct-sim.performance.allDailySignals.target1HitRatePct)<0.01);
assert.ok(Math.abs(actual.failureRatePct-sim.performance.allDailySignals.stopRatePct)<0.01);
console.log('realized-kpi tests: PASS');
