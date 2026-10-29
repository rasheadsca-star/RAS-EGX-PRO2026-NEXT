'use strict';
const fs=require('node:fs');
function audit(s){
 const rows=Array.isArray(s.symbols)?s.symbols:Object.values(s.symbols||{});
 const details=rows.map(x=>{
  const warnings=Array.isArray(x.warnings)?x.warnings:[];
  const conflicts=warnings.map(w=>/^latest_close_conflict:([0-9.]+)%$/.exec(w)).filter(Boolean).map(m=>Number(m[1]));
  const peak=conflicts.length?Math.max(...conflicts):null;
  const investigation=peak===null?'NO_CROSS_SOURCE_MISMATCH_RECORDED':peak>20?'HIGH_SEVERITY_REVIEW_CORPORATE_ACTION_AND_PRICE_SCALE':peak>2?'SOURCE_CLOSE_RECONCILIATION_REQUIRED':'WITHIN_2_PCT_TOLERANCE';
  const sufficientDepth=Number(x.availableSessions)>=100;
  const current=x.currentSessionMatched===true&&x.sessionLagged!==true&&x.staleData!==true;
  const blockers=[...(!sufficientDepth?['LESS_THAN_100_HISTORY_SESSIONS']:[]),...(!current?['HISTORY_NOT_CURRENT']:[]),...(peak!==null&&peak>2?['LATEST_CLOSE_SOURCE_CONFLICT_GT_2_PCT']:[]),...(x.officiallyVerifiedLatestSession!==true?['OFFICIAL_SESSION_UNVERIFIED']:[]),...(!x.symbolVerified?['SYMBOL_IDENTITY_UNVERIFIED']:[])];
  return {ticker:x.ticker,availableSessions:x.availableSessions,lastSession:x.lastSession,primarySource:x.primarySource||null,staleData:x.staleData===true,latestCloseConflictPct:peak,investigation,warnings,blockers,nominal100Sessions:sufficientDepth,eligibleForTrading:false};
 });
 return {schemaVersion:'egx-history-discrepancy-audit-1',marketSession:s.latestMarketSession||null,count:details.length,nominal100:details.filter(x=>x.nominal100Sessions).length,latestCloseConflictGt2:details.filter(x=>x.blockers.includes('LATEST_CLOSE_SOURCE_CONFLICT_GT_2_PCT')).length,highSeverityGt20:details.filter(x=>x.investigation==='HIGH_SEVERITY_REVIEW_CORPORATE_ACTION_AND_PRICE_SCALE').length,officiallyVerifiedLatest:rows.filter(x=>x.officiallyVerifiedLatestSession===true).length,certifiedTradingRows:0,note:'Discrepancies may reflect source errors, adjusted-vs-raw closes, corporate actions or scale changes; investigate before editing. Not OHLCV certification. No ticker is approved for execution.',priority:details.filter(x=>x.latestCloseConflictPct!==null).sort((a,b)=>b.latestCloseConflictPct-a.latestCloseConflictPct||a.ticker.localeCompare(b.ticker)).slice(0,10),remediationQueue:details.filter(x=>x.latestCloseConflictPct!==null&&x.latestCloseConflictPct>2).sort((a,b)=>b.latestCloseConflictPct-a.latestCloseConflictPct||a.ticker.localeCompare(b.ticker)).map(x=>({ticker:x.ticker,latestCloseConflictPct:x.latestCloseConflictPct,primarySource:x.primarySource,staleData:x.staleData,historySessions:x.availableSessions,lastSession:x.lastSession,action:x.latestCloseConflictPct>20?'VERIFY_CORPORATE_ACTION_AND_PRICE_UNITS':'RECONCILE_LATEST_CLOSE_WITH_INDEPENDENT_SOURCE',approval:'MANUAL_VERIFICATION_REQUIRED'})),symbols:details};
}
if(require.main===module){const report=audit(JSON.parse(fs.readFileSync('data/history-summary.json','utf8')));const out=process.argv[2];if(out){fs.mkdirSync(require('node:path').dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify({...report,symbols:undefined},null,2));if(report.latestCloseConflictGt2>0)process.exitCode=2;}
module.exports={audit};
