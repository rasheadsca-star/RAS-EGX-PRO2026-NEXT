'use strict';
const fs=require('node:fs');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function audit(app,handoff,quant){
 const a=app?.sourceDecision?.session,h=handoff?.sessionDate,q=quant?.sessionId;
 const checks={
  astraHandoffSessionMatch:typeof a==='string'&&a===h,
  handoffExpectedSessionMatch:h===handoff?.expectedSession,
  quantHandoffSessionMatch:q===h,
  handoffFinal:handoff?.final===true&&handoff?.pagesPublished===true,
  minimumAcceptedRows:Number(handoff?.acceptedRows)>=200,
  evidenceCoverage:Number(handoff?.sourceSessionEvidenceCoveragePct)>=90
 };
 return {schemaVersion:'egx-source-alignment-audit-1',sessions:{astra:a||null,handoff:h||null,quant:q||null},acceptedRows:handoff?.acceptedRows??null,evidenceCoveragePct:handoff?.sourceSessionEvidenceCoveragePct??null,checks,status:Object.values(checks).every(Boolean)?'PASS':'BLOCKED'};
}
if(require.main===module){const result=audit(read('astra-prod/app/data.json'),read('data/ops/g22-main-app-handoff.json'),read('data/quant/daily-recommendations.json'));process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.status!=='PASS')process.exitCode=2;}
module.exports={audit};
