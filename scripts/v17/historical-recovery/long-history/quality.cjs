'use strict';
const round = (v,d=4)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
function inspectSessions(sessions){
  const reasons=[]; const anomalies=[]; const actions=[]; let missingAdjusted=0;
  for(let i=0;i<sessions.length;i++){
    const row=sessions[i];
    if(!(Number(row.adjustedClose)>0)) missingAdjusted++;
    if(i===0) continue;
    const prev=sessions[i-1]; const raw=(Number(row.close)/Number(prev.close)-1)*100; const adj=(Number(row.adjustedClose)/Number(prev.adjustedClose)-1)*100;
    const pf=Number(prev.adjustedClose)/Number(prev.close), cf=Number(row.adjustedClose)/Number(row.close); const factorChange=pf>0?(cf/pf-1)*100:null;
    if(Number.isFinite(factorChange)&&Math.abs(factorChange)>=10) actions.push({date:row.date,rawChangePct:round(raw),adjustedChangePct:round(adj),adjustmentFactorBefore:round(pf,8),adjustmentFactorAfter:round(cf,8),status:Math.abs(adj)<=25?'ADJUSTED_DISCONTINUITY_RESOLVED':'REVIEW_REQUIRED'});
    if(Number.isFinite(adj)&&Math.abs(adj)>=35) anomalies.push({date:row.date,adjustedChangePct:round(adj),reason:'ADJUSTED_PRICE_DISCONTINUITY'});
  }
  const coverage=sessions.length?((sessions.length-missingAdjusted)/sessions.length*100):0;
  if(sessions.length<200) reasons.push('INSUFFICIENT_52_WEEK_COVERAGE');
  if(missingAdjusted) reasons.push(`MISSING_ADJUSTED_CLOSE:${missingAdjusted}`);
  if(anomalies.length) reasons.push(`CORPORATE_ACTION_REVIEW_REQUIRED:${anomalies.length}`);
  return {status:reasons.length?'REVIEW_REQUIRED':'VALID',reasons,adjustedCloseCoveragePct:round(coverage),missingAdjustedSessions:missingAdjusted,corporateActionConfidence:anomalies.length?'REVIEW_REQUIRED':actions.length?'MEDIUM_ADJUSTED_SOURCE_NOT_AUTHORITATIVE':'HIGH_NO_DETECTED_DISCONTINUITY_SOURCE_NOT_AUTHORITATIVE',detectedCorporateActions:actions,anomalies};
}
module.exports={inspectSessions};
