import test from 'node:test';
import assert from 'node:assert/strict';
import { structuralPrecisionGeometryEngine } from '../src/precision-geometry.js';

function bars(n=100){
  const out=[];
  for(let i=0;i<n;i++){
    const wave=i%10;
    const close=wave<5?100+wave*.55:102.2-(wave-5)*.55;
    out.push({
      date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
      open:close-.15,
      high:close+2.2,
      low:close-2.2,
      close,
      volume:100000+i*100,
    });
  }
  return out;
}

test('structural precision challenger blocks insufficient history without promotion',()=>{
  const x=structuralPrecisionGeometryEngine(bars(40));
  assert.equal(x.pass,false);
  assert.ok(x.reasonCodes.includes('INSUFFICIENT_HISTORY'));
  assert.equal(x.raw.researchOnly,true);
  assert.equal(x.raw.eligibilityImpact,'NONE_CHALLENGER_MODE');
});

test('structural precision geometry is deterministic and never self-promotes',()=>{
  const input=bars(100);
  const a=structuralPrecisionGeometryEngine(input);
  const b=structuralPrecisionGeometryEngine(input);
  assert.deepEqual(a,b);
  assert.equal(a.raw.researchOnly,true);
  assert.equal(a.raw.eligibilityImpact,'NONE_CHALLENGER_MODE');
  if(a.raw.promotionAllowed!==undefined)assert.equal(a.raw.promotionAllowed,false);
  if(a.raw.entryZone){
    assert.ok(Number.isFinite(a.raw.entryZone.from));
    assert.ok(Number.isFinite(a.raw.entryZone.to));
    assert.ok(a.raw.entryZone.to>a.raw.entryZone.from);
    assert.ok(Number.isFinite(a.raw.stopLoss));
    assert.ok(a.raw.stopLoss<a.raw.entryZone.from);
    assert.ok(Number.isFinite(a.raw.structuralResistance));
    assert.ok(a.raw.structuralResistance>a.raw.entryZone.to);
    assert.ok(Number.isFinite(a.raw.precisionTarget?.price));
  }
});

test('precision geometry cannot declare production eligibility or execution',()=>{
  const x=structuralPrecisionGeometryEngine(bars(100));
  assert.equal('eligibleForTop' in x,false);
  assert.equal('executionAllowed' in x,false);
  assert.equal(x.raw.eligibilityImpact,'NONE_CHALLENGER_MODE');
  assert.notEqual(x.raw.promotionAllowed,true);
});
