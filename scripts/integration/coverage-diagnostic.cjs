'use strict';
const fs=require('node:fs');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function audit(fetchStatus,history,health,handoff){
const safe=x=>Number.isFinite(Number(x))?Number(x):null;
const accepted=safe(fetchStatus?.currentSessionRows), input=safe(fetchStatus?.inputRows), rejected=safe(fetchStatus?.rejectedCurrentSessionRows);
const marker=safe(handoff?.acceptedRows), target=200, conditional=190;
const checks={
 verifiedSameSession:fetchStatus?.expectedSession===handoff?.sessionDate,
 acceptedCountsAgree:accepted!==null&&accepted===marker,
 inputReconciles:input!==null&&accepted!==null&&rejected!==null&&input===accepted+rejected,
 conditionalFloorMet:marker!==null&&marker>=conditional,
 fullTargetMet:marker!==null&&marker>=target,
 historicDepth100:safe(history?.symbolsComplete100),
 historicalFailed:safe(history?.symbolsFailed),
 availableHistoryCurrentSession:safe(history?.symbolsCurrentSession),
 marketHealthDelayed:health?.delayed===true
};
return {schemaVersion:'egx-coverage-diagnostic-1',sourceSession:fetchStatus?.expectedSession||null,handoffSession:handoff?.sessionDate||null,counts:{sourceRows:input,acceptedRows:accepted,rejectedRows:rejected,handoffAcceptedRows:marker,conditionalMinimum:conditional,fullTarget:target,conditionalDeficit:marker===null?null:Math.max(0,conditional-marker),fullTargetDeficit:marker===null?null:Math.max(0,target-marker)},historical:{complete100:checks.historicDepth100,failed:checks.historicalFailed,currentSession:checks.availableHistoryCurrentSession},checks,productionReady:checks.verifiedSameSession&&checks.acceptedCountsAgree&&checks.inputReconciles&&checks.conditionalFloorMet&&health?.delayed!==true};
}
if(require.main===module){const result=audit(read('data/fetch-status.json'),read('data/history-summary.json'),read('data/source-health.json'),read('data/ops/g22-main-app-handoff.json'));console.log(JSON.stringify(result,null,2));if(!result.productionReady)process.exitCode=2}
module.exports={audit};
