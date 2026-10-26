'use strict';
// Read-only audit: never rewrite sessions or force an invalid Astra handoff.
const fs=require('node:fs'),path=require('node:path');
function inspect(root){
 const app=JSON.parse(fs.readFileSync(path.join(root,'astra-prod/app/data.json'),'utf8'));
 const handoff=JSON.parse(fs.readFileSync(path.join(root,'data/ops/g22-main-app-handoff.json'),'utf8'));
 const price=JSON.parse(fs.readFileSync(path.join(root,'data/stable/v15-price-truth.json'),'utf8'));
 const actual=app?.sourceDecision?.session||null,expected=handoff?.sessionDate||null;
 const checks={
  decisionMatchesHandoff:actual===expected,
  handoffInternallyConsistent:handoff?.expectedSession===expected,
  priceReportMatchesHandoff:price?.expectedSession===expected,
  handoffEligible:handoff?.final===true&&handoff?.sourceReady===true&&handoff?.executionGrade===true&&Number(handoff?.acceptedRows)>=200
 };
 return {schemaVersion:1,mode:'READ_ONLY',status:Object.values(checks).every(Boolean)?'PASS':'BLOCKED_STALE_DECISION',
  decisionSession:actual,handoffSession:expected,priceReportSession:price?.expectedSession||null,
  checks,action:checks.decisionMatchesHandoff?'NONE':'REBUILD_DECISION_FROM_VERIFIED_SESSION;DO_NOT_RELABEL_OLD_DECISION'};
}
if(require.main===module){
 const result=inspect(path.resolve(process.argv[2]||'.'));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result.status!=='PASS')process.exitCode=2;
}
module.exports={inspect};
