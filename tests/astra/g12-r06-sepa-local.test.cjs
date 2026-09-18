'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {executeLocalSepa,materializeMirror,STRATEGY_ID}=require('../../astra/runtime/bridges/sepa-local.cjs');

const SESSION='2026-09-15';
function history(){
  const out=[];
  for(let i=0;i<253;i++){
    const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
    out.push({sessionDate:d,open:100,high:102,low:99,close:101,volume:1000000,validationStatus:'VALID',migrationValidationStatus:'VALID'});
  }
  return out;
}
function input(){
  return{
    snapshot:{snapshotId:'G12-SEPA-FIXTURE',ticker:'__MARKET__',sessionDate:SESSION,validationStatus:'VALID',migrationValidationStatus:'VALID'},
    history:history(),
    regimeContext:{regime:'SIDEWAYS'},
    candidates:[
      {symbol:'AAA',status:'NEAR PIVOT',entry_readiness_score:90,final_score:77.4,eligibleForTop:false,pivot:10,risk_pct:4,reward_risk:2.4},
      {symbol:'BBB',status:'FORMING',vcp:{score:60},entry_readiness_score:55,final_score:82,eligibleForTop:false,pivot:20,risk_pct:5,reward_risk:2.2}
    ],
    generatedAt:'2026-09-15T20:00:00Z'
  };
}

test('R06 internal SEPA bridge reproduces G10 pinned selection-policy oracle',()=>{
  const r=executeLocalSepa(input());
  assert.equal(r.strategyId,STRATEGY_ID);
  assert.equal(r.strategyVersion,'bf63dc85f515e58a7be1c6de6633eed87228a021');
  assert.equal(r.eligibility,'ELIGIBLE');
  assert.equal(r.rawSignal,'NEAR_FIRST_THEN_FORMING');
  assert.equal(r.evidenceItems[0].symbol,'AAA');
});

test('R06 local mirror is Gann-adapter compatible and contains no external source URL',()=>{
  const m=materializeMirror(input());
  assert.equal(m.meta.source,'ASTRA_INTERNAL_SEPA_QVUA');
  assert.equal(m.meta.mode,'INTERNAL_LOCAL');
  assert.equal(m.meta.selectionPolicy,'NEAR_FIRST_THEN_FORMING');
  assert.equal(m.rows[0].symbol,'AAA');
  assert.equal(m.views.near[0].symbol,'AAA');
  assert.equal(JSON.stringify(m).includes('sepax-strategy-stable.vercel.app'),false);
});

test('R06 parity is tied to exact G10 source-rule evidence',()=>{
  const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../../docs/astra/G10_PARITY_RESULTS.json'),'utf8'));
  const c=p.cases.find(x=>x.caseId==='RULE-SEPA-V1');
  assert.ok(c);
  assert.equal(c.strategyId,STRATEGY_ID);
  assert.equal(c.sourceCommit,'bf63dc85f515e58a7be1c6de6633eed87228a021');
  assert.equal(c.comparisonStatus,'EXACT_MATCH');
  assert.equal(c.fields.find(x=>x.field==='rawSignal')?.actual,'NEAR_FIRST_THEN_FORMING');
  assert.equal(c.fields.find(x=>x.field==='firstTicker')?.actual,'AAA');
});

test('R06 bridge itself has no network/runtime remote primitive',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../../astra/runtime/bridges/sepa-local.cjs'),'utf8');
  for(const token of ['fetch(','http.request','https.request','sepax-strategy-stable.vercel.app','raw.githubusercontent.com','cdn.jsdelivr.net'])assert.equal(src.includes(token),false,token);
});
