'use strict';
const fs=require('node:fs'),path=require('node:path');
function prioritize(a){
 const out=(a.rows||[]).map(r=>{
  let group,action,priority;
  if(r.actionableGroup==='G11_V16_FEATURE_DISAGREEMENT'){
   group='P1_VERIFIED_FEATURE_PARITY';action='Compare validated OHLCV and V16 feature vector from identical certified workspace';priority=1;
  } else if(r.actionableGroup==='REQUIRES_VERIFIED_CURRENT_BAR'){
   group='P2_CURRENT_SESSION_VERIFICATION';action='Verify same-session OHLCV and independent session evidence; never forward-fill';priority=2;
  } else if(r.actionableGroup==='V16_RISK_FILTER_OR_FEATURE_REJECTION'){
   group='P3_RISK_DOMAIN_REVIEW';action='Preserve ATR and price-jump risk limits; review only source anomaly if evidence supports';priority=3;
  } else {
   group='P4_HISTORY_OR_IDENTITY_REVIEW';action='Review source history depth and verified ticker identity';priority=4;
  }
  return{ticker:r.ticker,priority,group,action,g11Reason:r.reason,
   v16Reason:r.v16Reason,v16RootCause:r.v16RootCause||null,
   currentBar:r.current,validHistorySessions:r.validSessions||0,
   v16ValidSessions:r.v16ValidSessions??null,latestSession:r.lastSession||null,
   productionStatus:r.productionCriticalStatus,productionReason:r.productionCriticalReason,
   provisionalOnly:true};
 }).sort((a,b)=>a.priority-b.priority||a.ticker.localeCompare(b.ticker));
 const counts={};for(const v of out)counts[v.group]=(counts[v.group]||0)+1;
 return{schemaVersion:'g22-recovery-priority-list-1',session:a.session,universeG11:a.universeG11,
  counts,records:out,approvedPriceRepairs:0,certifiedDecisionReady:false,
  restrictions:'No synthetic OHLCV, no automatic security promotion, no lowering 90% or 80% gates'};
}
function run(inp,out){
 const j=JSON.parse(fs.readFileSync(inp,'utf8'));const p=prioritize(j);
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(p,null,2)+'\n');
 console.log('G22_RECOVERY_PRIORITIES '+JSON.stringify({session:p.session,counts:p.counts,records:p.records.length}));
}
if(require.main===module)run(process.argv[2],process.argv[3]);
module.exports={prioritize};
