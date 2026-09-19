import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTargetPlan, selectConcentratedRecommendations, selectReviewQueue } from '../src/concentration.js';

const row=(symbol,{score=90,confidence=85,rr=3,status='READY NOW',vcp=80,rs=90,entry=100,stop=95,riskPct=null,failedRules=[],fundamentalsPass=true,nearestResistance=null}={})=>({
  symbol,final_score:score,confidence_score:confidence,reward_risk:rr,status,action:'BUY',rs_percentile:rs,
  vcp:{quality:vcp},entry_zone:[entry,entry],stop_loss:stop,risk_pct:riskPct,failed_rules:failedRules,
  audit_stages:{entry:{raw:{do_not_chase:false}},fundamentals:{pass:fundamentalsPass},risk:{raw:{nearest_resistance:nearestResistance}}}
});

test('target plan keeps 2R 3R 4R objectives and adds separate 0.8R precision target',()=>{
  const p=buildTargetPlan(row('AAA'),{precisionTargetR:.8,targetRMultiples:[2,3,4]});
  assert.equal(p.valid,true);
  assert.deepEqual(p.targets.map(x=>x.price),[110,115,120]);
  assert.deepEqual(p.targets.map(x=>x.r),[2,3,4]);
  assert.equal(p.precisionTarget.id,'P1');
  assert.equal(p.precisionTarget.price,104);
  assert.equal(p.precisionTarget.r,.8);
  assert.equal(p.precisionTarget.requestedR,.8);
  assert.equal(p.precisionTarget.cappedByResistance,false);
});

test('precision target respects closer structural resistance without changing T1 T2 T3',()=>{
  const p=buildTargetPlan(row('CAP',{nearestResistance:102.5}),{precisionTargetR:.8,targetRMultiples:[2,3,4]});
  assert.equal(p.precisionTarget.price,102.5);
  assert.equal(p.precisionTarget.r,.5);
  assert.equal(p.precisionTarget.structuralCap,102.5);
  assert.equal(p.precisionTarget.cappedByResistance,true);
  assert.deepEqual(p.targets.map(x=>x.price),[110,115,120]);
});

test('resistance above raw precision objective does not stretch P1 beyond requested 0.8R',()=>{
  const p=buildTargetPlan(row('FAR',{nearestResistance:118}),{precisionTargetR:.8,targetRMultiples:[2,3,4]});
  assert.equal(p.precisionTarget.price,104);
  assert.equal(p.precisionTarget.r,.8);
  assert.equal(p.precisionTarget.structuralCap,118);
  assert.equal(p.precisionTarget.cappedByResistance,false);
});

test('selector defaults to three when only one extra is strong',()=>{
  const rows=[row('A'),row('B',{score:89}),row('C',{score:88}),row('D',{score:87}),row('E',{score:72,confidence:60,rr:1.5})];
  const out=selectConcentratedRecommendations(rows);
  assert.equal(out.length,3);
  assert.deepEqual(out.map(x=>x.conviction_rank),[1,2,3]);
});

test('selector expands to five only when both extra names are strong',()=>{
  const rows=[row('A'),row('B',{score:89}),row('C',{score:88}),row('D',{score:87}),row('E',{score:86})];
  const out=selectConcentratedRecommendations(rows);
  assert.equal(out.length,5);
  assert.ok(out.every(x=>x.target_plan?.primaryTarget?.r===2));
  assert.ok(out.every(x=>x.target_plan?.precisionTarget?.requestedR===.8));
});

test('extended and weak reward/risk stocks are never padded into top set',()=>{
  const rows=[row('A'),row('B'),row('C'),row('X',{status:'EXTENDED'}),row('Y',{rr:1.2})];
  const out=selectConcentratedRecommendations(rows);
  assert.deepEqual(out.map(x=>x.symbol).sort(),['A','B','C']);
});

test('corporate-action-only blocker enters review queue but is never executable',()=>{
  const out=selectReviewQueue([row('SCTS',{rr:3.57,riskPct:3.45,failedRules:['CORPORATE_ACTION_REVIEW_REQUIRED']})]);
  assert.equal(out.length,1);
  assert.equal(out[0].symbol,'SCTS');
  assert.equal(out[0].review_required,true);
  assert.equal(out[0].execution_allowed,false);
  assert.equal(out[0].review_reason,'CORPORATE_ACTION_REVIEW_REQUIRED');
  assert.equal(out[0].review_rank,1);
});

test('SCTS-like fundamentals confidence penalty is nonblocking only inside review queue',()=>{
  const out=selectReviewQueue([row('SCTS',{rr:3.57,riskPct:3.45,failedRules:['CORPORATE_ACTION_REVIEW_REQUIRED','FUNDAMENTALS_UNAVAILABLE_CONFIDENCE_PENALTY'],fundamentalsPass:true})]);
  assert.equal(out.length,1);
  assert.equal(out[0].symbol,'SCTS');
  assert.equal(out[0].execution_allowed,false);
});

test('review queue rejects candidates with any additional engine blocker',()=>{
  const out=selectReviewQueue([row('BAD',{failedRules:['CORPORATE_ACTION_REVIEW_REQUIRED','STALE_DATA']})]);
  assert.equal(out.length,0);
});

test('review queue rejects confidence penalty when fundamentals stage itself fails',()=>{
  const out=selectReviewQueue([row('BADF',{failedRules:['CORPORATE_ACTION_REVIEW_REQUIRED','FUNDAMENTALS_UNAVAILABLE_CONFIDENCE_PENALTY'],fundamentalsPass:false})]);
  assert.equal(out.length,0);
});

test('review queue still enforces reward risk and maximum risk width',()=>{
  const out=selectReviewQueue([
    row('LOWRR',{rr:1.2,failedRules:['CORPORATE_ACTION_REVIEW_REQUIRED']}),
    row('WIDE',{rr:3,riskPct:9.2,failedRules:['CORPORATE_ACTION_REVIEW_REQUIRED']})
  ]);
  assert.equal(out.length,0);
});
