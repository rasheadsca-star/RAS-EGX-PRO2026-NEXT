'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {produce}=require('../../scripts/astra/g22-coverage-attribution.cjs');
test('coverage 200/224 is blocked at 202 without changing acceptance',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-cov-'));
 try{
  const target=path.join(dir,'evidence.json');
  const report={acceptedRows:200,sampleRejected:[{ticker:'CEFM',reason:'REPORTED_CHANGE_MISMATCH'}],missingHistoryFiles:['XYZ']};
  const before=JSON.stringify(report);
  const doc=produce({expected:'2026-10-26',activeUniverse:224,currentCanonical:200,pipelineReady:116,priceTruth:report,
   secondSource:{records:{CEFM:{status:'UNRESOLVED'},ABC:{attempts:[{provider:'YAHOO_CHART',status:'NO_SESSION'}]}}},disposition:{unresolved:[{ticker:'ABC',reason:'MISSING_VERIFIED_SESSION'}],verifiedIneligible:[]},readinessIssues:[{severity:'HIGH',code:'CURRENT_SESSION_GAP',ticker:'ABC',message:'No verified current session'},{severity:'HIGH',code:'CURRENT_SESSION_GAP',ticker:'XYZ'}],pipelineDiagnostics:[{code:'NOT_READY',ticker:'ABC'}],strategyReadiness:{productionCritical:{readySecurities:116,globalTrainingSessions:51,globalTrainingRows:3100,minimumSourceSessions:50,minimumSourceUniverse:60},rows:[{ticker:'ABC',productionCritical:true,status:'INSUFFICIENT_HISTORY',reason:'MINIMUM_BARS_56',validHistorySessions:12},{ticker:'XYZ',productionCritical:true,status:'READY',reason:'DATA_REQUIREMENTS_SATISFIED',validHistorySessions:80}]},outPath:target});
  assert.equal(doc.required,202);assert.equal(doc.shortfall,2);assert.equal(doc.coveragePct,200/224*100);
  assert.equal(doc.details[0].secondary.status,'UNRESOLVED');
  assert.equal(doc.pipelineRequired,180);
  assert.equal(doc.pipelineShortfall,64);
  assert.equal(doc.pipelineCoverageGate,'BLOCKED');
  assert.equal(doc.readinessIssueCount,2);
  assert.equal(doc.readinessIssuesByCode.CURRENT_SESSION_GAP,2);
  assert.equal(doc.pipelineDiagnostics[0].ticker,'ABC');
  assert.equal(doc.productionReadiness.readySecurities,116);
  assert.equal(doc.productionReadiness.globalTrainingSessions,51);
  assert.equal(doc.productionReadiness.blockedReasons.MINIMUM_BARS_56,1);
  assert.equal(doc.productionReadiness.records.find(x=>x.ticker==='ABC').validHistorySessions,12);
  assert.equal(doc.canonicalCoverageGate,'BLOCKED');
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

test('canonical coverage passes but pipeline failure remains visible',()=>{
 const d=produce({expected:'2026-10-27',activeUniverse:224,currentCanonical:203,pipelineReady:170,priceTruth:{sampleRejected:[],missingHistoryFiles:[]}});
 assert.equal(d.canonicalCoverageGate,'PASS');
 assert.equal(d.pipelineCoverageGate,'BLOCKED');
 assert.equal(d.pipelineShortfall,10);
});
test('pipeline readiness must not be invented when omitted',()=>{
 const d=produce({expected:'2026-10-27',activeUniverse:224,currentCanonical:203,priceTruth:{sampleRejected:[],missingHistoryFiles:[]}});
 assert.equal(d.pipelineCoverageGate,'NOT_MEASURED');
 assert.equal(d.pipelineShortfall,null);
});
