'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {inspect}=require('../../scripts/astra/native/astra-session-alignment-diagnostic.cjs');
function make(decision='2026-10-21',session='2026-10-26'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'astra-session-check-'));
 for(const p of ['astra-prod/app','data/ops','data/stable'])fs.mkdirSync(path.join(root,p),{recursive:true});
 const write=(p,o)=>fs.writeFileSync(path.join(root,p),JSON.stringify(o));
 write('astra-prod/app/data.json',{sourceDecision:{session:decision}});
 write('data/ops/g22-main-app-handoff.json',{sessionDate:session,expectedSession:session,final:true,sourceReady:true,executionGrade:true,acceptedRows:200});
 write('data/stable/v15-price-truth.json',{expectedSession:session});
 return {root,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('stale Astra is blocked and immutable inputs remain unchanged',()=>{
 const f=make();try{
  const file=path.join(f.root,'astra-prod/app/data.json'),original=fs.readFileSync(file);
  const result=inspect(f.root);
  assert.equal(result.status,'BLOCKED_STALE_DECISION');
  assert.equal(result.recommendationDisplay,'BLOCK_STALE_RECOMMENDATIONS');
  assert.equal(result.checks.decisionMatchesHandoff,false);
  assert.match(result.action,/DO_NOT_RELABEL_OLD_DECISION/);
  assert.deepEqual(fs.readFileSync(file),original);
 }finally{f.cleanup()}
});
test('aligned verified handoff passes',()=>{
 const f=make('2026-10-26');try{assert.equal(inspect(f.root).status,'PASS');assert.equal(inspect(f.root).recommendationDisplay,'ELIGIBLE_FOR_FURTHER_CHECKS')}finally{f.cleanup()}
});
test('a newer decision does not override mismatched price evidence',()=>{
 const f=make('2026-10-26');try{
  fs.writeFileSync(path.join(f.root,'data/stable/v15-price-truth.json'),JSON.stringify({expectedSession:'2026-10-25'}));
  assert.equal(inspect(f.root).status,'BLOCKED_STALE_DECISION');
 }finally{f.cleanup()}
});
test('insufficient handoff remains blocked even if dates agree',()=>{
 const f=make('2026-10-26');try{
  const file=path.join(f.root,'data/ops/g22-main-app-handoff.json'),doc=JSON.parse(fs.readFileSync(file));
  doc.acceptedRows=199;fs.writeFileSync(file,JSON.stringify(doc));
  assert.equal(inspect(f.root).status,'BLOCKED_STALE_DECISION');
 }finally{f.cleanup()}
});
