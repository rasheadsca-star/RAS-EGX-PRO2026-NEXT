import test from 'node:test';
import assert from 'node:assert/strict';
import { FULL_STRUCTURE_V3_DEFINITION, fullStructureV3Shadow } from '../src/strategy-lab-v3.js';

const good={pass:true,raw:{touches:3,breakout:{date:'2026-08-20',volumeRatio:1.6},retest:{date:'2026-08-21',volumeVsBreakout:.6,depthAtr:.3},reclaim:{date:'2026-08-24',volumeRatio:1.1},plan:{riskPct:5,entryZone:{from:10,to:10.2},referenceEntry:10.1,stopLoss:9.6,precisionTarget:{r:.8,price:10.5}}}};

test('FULL_STRUCTURE_V3 exact frozen mechanics pass',()=>{
  const x=fullStructureV3Shadow(good);
  assert.equal(x.pass,true);
  assert.equal(x.raw.promotionAllowed,false);
  assert.equal(x.raw.automaticEligibilityImpact,'NONE');
  assert.equal(x.raw.independentForwardValidationRequired,true);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.thresholds.minBreakoutVolumeRatio,1.4);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.thresholds.maxRetestVolumeVsBreakout,.75);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.thresholds.maxRetestDepthAtr,.45);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.thresholds.minReclaimVolumeRatio,.95);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.thresholds.minResistanceTouches,3);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.thresholds.minRiskPct,3);
  assert.equal(FULL_STRUCTURE_V3_DEFINITION.thresholds.maxRiskPct,7);
});

test('FULL_STRUCTURE_V3 cannot pass without confirmed retest-reclaim V2',()=>{
  const x=fullStructureV3Shadow({...good,pass:false});
  assert.equal(x.pass,false);
  assert.ok(x.reasonCodes.includes('V3_RETESTRECLAIMV2CONFIRMED_FAIL'));
});

test('FULL_STRUCTURE_V3 rejects risk and reclaim outside frozen bands',()=>{
  const x=fullStructureV3Shadow({pass:true,raw:{...good.raw,reclaim:{...good.raw.reclaim,volumeRatio:.8},plan:{...good.raw.plan,riskPct:7.5}}});
  assert.equal(x.pass,false);
  assert.equal(x.raw.checks.reclaimVolume,false);
  assert.equal(x.raw.checks.riskBand,false);
});
