import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTargetPlan, selectConcentratedRecommendations, selectReviewQueue } from '../src/concentration.js';

const row=(symbol,{score=90,confidence=85,rr=3,status='READY NOW',vcp=80,rs=90,entry=100,stop=95,riskPct=null,failedRules=[],fundamentalsPass=true}={})=>({
  symbol,final_score:score,confidence_score:confidence,reward_risk:rr,status,action:'BUY',rs_percentile:rs,
  vcp:{quality:vcp},entry_zone:[entry,entry],stop_loss:stop,risk_pct:riskPct,failed_rules:failedRules,
  audit_stages:{entry:{raw:{do_not_chase:false}},fundamentals:{pass:fundamentalsPass}}
});

test('target plan produces 2R 3R 4R objectives',()=>{
  const p=buildTargetPlan(row('AAA'),{targetRMultiples:[2,3,4]});
  assert.equal(p.valid,true);
  assert.deepEqual(p.targets.map(x=>x.price),[110,115,120]);
  assert.deepEqual(p.targets.map(x=>x.r),[2,3,4]);
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
