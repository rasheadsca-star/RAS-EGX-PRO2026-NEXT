#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=process.env.GITHUB_WORKSPACE||process.cwd(),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function diagnose(marker,truth,astra){
 const required=200,accepted=Number(truth.acceptedRows)||0;
 const session=truth.expectedSession||null,decision=astra?.decisionSnapshot?.sessionDate||null;
 return {schemaVersion:'egx-g22-data-coverage-blocker-1',sourceSession:session,astraDecisionSession:decision,
  acceptedRows:accepted,g22RequiredAcceptedRows:required,additionalCertifiedRowsNeeded:Math.max(0,required-accepted),
  missingHistoryTickers:Array.isArray(truth.missingHistoryFiles)?truth.missingHistoryFiles:[],
  markerSession:marker.sessionDate||null,minimumCoverageGatePassed:accepted>=required,
  astraCurrent:session===decision,action:'RESTORE_VERIFIED_COVERAGE_WITHOUT_LOWERING_G22_THRESHOLD',
  executionEnabled:false};
}
if(require.main===module){try{const result=diagnose(read('data/ops/g22-main-app-handoff.json'),read('data/stable/v15-price-truth.json'),read('astra-prod/app/data.json'));
 const out=path.join(root,'unified-console/g22-coverage-status.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log('G22_COVERAGE_DIAGNOSIS',JSON.stringify(result));}catch(e){console.error(e);process.exitCode=2}}
module.exports={diagnose};
