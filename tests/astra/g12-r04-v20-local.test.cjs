'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const bridge=require('../../astra/runtime/bridges/v20-local.cjs');
const root=path.resolve(__dirname,'../..');
function input(){return{
  snapshot:{snapshotId:'G12-R04-PARITY',securityId:'SEC-COMI',ticker:'COMI',sessionDate:'2026-09-15',validationStatus:'VALID',migrationValidationStatus:'VALID'},
  components:{legacyOpportunity:70,dataEvidence:80,liquidity:85,supportResistance:75,netRiskReward:80,tradePlanAlignment:90,currentTechnical:88}
}}
test('R04 local V20 evaluator reproduces the G10 weighted score oracle',()=>{
  const out=bridge.executeV20(input());
  assert.equal(out.strategyExecution.eligibility,'ELIGIBLE');
  assert.equal(out.strategyExecution.rawScore,81.3);
  assert.deepEqual(out.publishedCandidates,[{ticker:'COMI',score:81.3}]);
  assert.equal(out.executionAllowed,false);
});
test('R04 V20 G10 evidence is exact and source-pinned',()=>{
  const g10=JSON.parse(fs.readFileSync(path.join(root,'docs/astra/G10_PARITY_RESULTS.json'),'utf8'));
  const rows=g10.results||g10.cases||[];
  const rule=rows.find(x=>x.caseId==='RULE-V20-WEIGHTED-SCORE');
  const blob=rows.find(x=>x.caseId==='CONFIG-V20-BLOB-EQUIVALENCE');
  assert.ok(rule&&blob);
  assert.equal(rule.comparisonStatus,'EXACT_MATCH');
  assert.equal(rule.fields.find(x=>x.field==='rawScore').actual,81.3);
  assert.equal(blob.fields.find(x=>x.field==='sourceBlobHash').actual,'8edd184049966a570fdfa5c0b6f84b0cfa288300d1be8bd822925af7b58c6375');
});
test('R04 bridge has no remote runtime dependency',()=>{
  const src=fs.readFileSync(path.join(root,'astra/runtime/bridges/v20-local.cjs'),'utf8');
  assert.doesNotMatch(src,/https?:\/\/|raw\.githubusercontent\.com|cdn\.jsdelivr\.net|github\.io/i);
  const cap=bridge.capability();
  assert.equal(cap.canExecuteInternally,true);
  assert.equal(cap.productionEligible,false);
});
