'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {evaluation}=require('../../scripts/stable/history-quarantine-policy.cjs');
const {capture,verify}=require('../../scripts/stable/history-r8-integrity.cjs');
const {execute}=require('../../scripts/stable/history-s3-shadow-quarantine.cjs');
const rootOf=()=>fs.mkdtempSync(path.join(os.tmpdir(),'egx-r8-shadow-'));
const session='2026-10-25',SOURCE='v16_session_aware_price_truth';
function setup(){
 const root=rootOf(),h=path.join(root,'data/history');fs.mkdirSync(h,{recursive:true});fs.mkdirSync(path.join(root,'data/stable'),{recursive:true});
 const now={ticker:'GOOD',date:session,sourceSessionDate:session,source:SOURCE,fetchedAt:'2026-10-25T08:00:00Z',close:12};
 const old={ticker:'BAD',date:'2026-10-22',source:SOURCE,close:8};
 const bad={ticker:'BAD',date:session,sourceSessionDate:session,source:SOURCE,fetchedAt:'2026-10-25T08:00:00Z',close:9};
 fs.writeFileSync(path.join(h,'GOOD.json'),JSON.stringify({sessions:[now]}));
 fs.writeFileSync(path.join(h,'BAD.json'),JSON.stringify({sessions:[old,bad]}));
 fs.writeFileSync(path.join(h,'.v169-target-audit-trigger'),'unchanged');
 const report={schemaVersion:'16.3.4-session-aware-price-truth',generatedAt:'2026-10-25T08:10:00Z',expectedSession:session,ready:true,executionGrade:true,
 source:{realFetch:true,preciseSource:true,inputRows:3},acceptedRows:2,updatedHistoryFiles:1,missingHistoryFiles:['MISSING'],rejectedRows:1,
 droppedRows:0,sampleRejected:[{ticker:'BAD',reason:'SOURCE_SESSION_MISMATCH'}],sampleDropped:[]};
 fs.writeFileSync(path.join(root,'data/stable/v15-price-truth.json'),JSON.stringify(report));
 const assessment=evaluation({runId:'RUN-1',expectedSession:session,sourceEligible:true,acceptedRows:2,accepted:[now],
 rejected:[{ticker:'BAD',reason:'SOURCE_SESSION_MISMATCH'}],missingHistory:['MISSING']});
 const affected=new Set(['GOOD','BAD']);
 const run=()=>execute({root,runId:'RUN-1',startedAt:'2026-10-25T07:00:00Z',generatedAt:'2026-10-25T08:15:00Z'});
 return {root,h,old,affected,assessment,run};
}
test('R8 baseline before shadow quarantine verifies prior history and unchanged marker',()=>{
 const f=setup();try{
  const baseline=capture({root:f.root,expectedSession:session,affectedTickers:f.affected,assessment:f.assessment});
  const output=f.run();
  assert.equal(output.quarantined.length,1);
  assert.equal(output.result.acceptedRows,2);
  assert.equal(verify({root:f.root,baseline,affectedTickers:f.affected}).previousSessionsIntact,true);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('R8 rejects previously trusted candle changes after shadow',()=>{
 const f=setup();try{
  const baseline=capture({root:f.root,expectedSession:session,affectedTickers:f.affected,assessment:f.assessment});
  f.run();
  const file=path.join(f.h,'BAD.json'),doc=JSON.parse(fs.readFileSync(file));
  doc.sessions[0].close=100;fs.writeFileSync(file,JSON.stringify(doc));
  assert.throws(()=>verify({root:f.root,baseline,affectedTickers:f.affected}),/PREVIOUS_SESSIONS_CHANGED/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
