'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {produce}=require('../../scripts/astra/g22-coverage-attribution.cjs');
test('coverage 200/224 is blocked at 202 without changing acceptance',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-cov-'));
 try{
  const target=path.join(dir,'evidence.json');
  const report={acceptedRows:200,sampleRejected:[{ticker:'CEFM',reason:'REPORTED_CHANGE_MISMATCH'}],missingHistoryFiles:['XYZ']};
  const before=JSON.stringify(report);
  const doc=produce({expected:'2026-10-26',activeUniverse:224,currentCanonical:200,priceTruth:report,
   secondSource:{records:{CEFM:{status:'UNRESOLVED'},ABC:{attempts:[{provider:'YAHOO_CHART',status:'NO_SESSION'}]}}},disposition:{unresolved:[{ticker:'ABC',reason:'MISSING_VERIFIED_SESSION'}],verifiedIneligible:[]},outPath:target});
  assert.equal(doc.required,202);assert.equal(doc.shortfall,2);assert.equal(doc.coveragePct,200/224*100);
  assert.equal(doc.details[0].secondary.status,'UNRESOLVED');
  assert.equal(doc.totalRejectedRows,null);
  assert.equal(doc.sampledRejectedCount,1);
  assert.equal(doc.unresolvedDispositionCount,1);
  assert.equal(doc.details.find(x=>x.ticker==='ABC').secondary.attempts[0].status,'NO_SESSION');
  assert.equal(doc.mode,'EVIDENCE_ONLY');
  assert.equal(JSON.stringify(report),before);
  assert.deepEqual(JSON.parse(fs.readFileSync(target)),doc);
 }finally{fs.rmSync(dir,{force:true,recursive:true})}
});
test('202 of 224 meets coverage and shortfall is zero',()=>assert.equal(produce({expected:'2026-10-26',activeUniverse:224,currentCanonical:202,priceTruth:{sampleRejected:[],missingHistoryFiles:[]}}).shortfall,0));
