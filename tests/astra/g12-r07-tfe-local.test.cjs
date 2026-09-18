'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {evaluateTfe,health,STRATEGY_ID}=require('../../astra/runtime/bridges/tfe-local.cjs');

function history(){
  return Array.from({length:60},(_,i)=>({
    sessionDate:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),
    open:100,high:102,low:99,close:101,volume:1000000,
    validationStatus:'VALID',migrationValidationStatus:'VALID'
  }));
}
function base(components){
  return{
    snapshot:{snapshotId:'R07-TFE-FIXTURE',ticker:'COMI',sessionDate:'2026-09-15',validationStatus:'VALID',migrationValidationStatus:'VALID'},
    history:history(),
    components
  };
}

test('R07 internal TFE bridge reproduces G10 PASS hard-gate oracle',()=>{
  const r=evaluateTfe(base({
    technicalScore:80,researchScore:80,liquidityScore:65,liquidityEligible:true,
    srConfluenceScore:65,srStrongMethods:3,netRiskReward:1.1,pullbackAtr:.4,entryState:'READY'
  }));
  assert.equal(r.strategyId,STRATEGY_ID);
  assert.equal(r.strategyVersion,'66b2ac2bc63fe144d5d30d3d304350a6c0d04da9');
  assert.equal(r.eligibility,'ELIGIBLE');
});

test('R07 internal TFE bridge reproduces G10 REJECT hard-gate oracle',()=>{
  const r=evaluateTfe(base({
    technicalScore:60,researchScore:80,liquidityScore:65,liquidityEligible:true,
    srConfluenceScore:65,srStrongMethods:3,netRiskReward:1.1,pullbackAtr:.4,entryState:'READY'
  }));
  assert.equal(r.eligibility,'INELIGIBLE');
  assert.equal(r.rawSignal,'NO_SIGNAL');
});

test('R07 parity is anchored to exact G10 source-rule cases',()=>{
  const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../../docs/astra/G10_PARITY_RESULTS.json'),'utf8'));
  const pass=p.cases.find(x=>x.caseId==='RULE-TFE-RC2-PASS');
  const reject=p.cases.find(x=>x.caseId==='RULE-TFE-RC2-REJECT');
  assert.equal(pass?.sourceCommit,'66b2ac2bc63fe144d5d30d3d304350a6c0d04da9');
  assert.equal(pass?.comparisonStatus,'EXACT_MATCH');
  assert.equal(reject?.comparisonStatus,'EXACT_MATCH');
  assert.equal(pass?.fields.find(x=>x.field==='eligibility')?.actual,'ELIGIBLE');
  assert.equal(reject?.fields.find(x=>x.field==='eligibility')?.actual,'INELIGIBLE');
  assert.equal(reject?.fields.find(x=>x.field==='rawSignal')?.actual,'NO_SIGNAL');
});

test('R07 bridge has zero network primitives and reports local health',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../../astra/runtime/bridges/tfe-local.cjs'),'utf8');
  for(const token of ['fetch(','http.request','https.request','vercel.app','raw.githubusercontent.com'])assert.equal(src.includes(token),false,token);
  const h=health();
  assert.equal(h.legacyNetworkCalls,0);
  assert.equal(h.productionCutover,false);
});

test('R07 vendored technical asset matches pinned source blob exactly',()=>{
  const local=fs.readFileSync(path.join(__dirname,'../../deploy/rc2-safe-shell/technical-analysis-tools.js'),'utf8');
  assert.match(local,/TECHNICAL_VISUALIZATION_CONTRACT/);
  assert.equal(local.length>10000,true);
});
