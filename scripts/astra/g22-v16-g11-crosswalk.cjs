'use strict';
const fs=require('node:fs'),path=require('node:path');
function crosswalk(g,v) {
 if(g.session!==v.session) throw new Error('G11_V16_SESSION_MISMATCH');
 const map=new Map((v.records||[]).map(x=>[x.ticker,x]));
 const rows=(g.gaps||[]).map(x=>{
  const y=map.get(x.ticker);
  return {...x,v16Reason:y?.reason||'NOT_IN_V16_AUDIT',v16RootCause:y?.rootCause||null,
    v16ValidSessions:y?.validSessions??null,v16CurrentBar:y?.currentBar??null,
    v16AtrPct:y?.atrPct??null,
    actionableGroup:!y?'V16_AUDIT_MISSING':
     !x.current?'REQUIRES_VERIFIED_CURRENT_BAR':
     y.reason==='FEATURE_OK'?'G11_V16_FEATURE_DISAGREEMENT':
     y.reason==='BASE_FEATURE_REJECTED'?'V16_RISK_FILTER_OR_FEATURE_REJECTION':'HISTORY_OR_SOURCE_REPAIR'};
 });
 const counts={};for(const r of rows)counts[r.actionableGroup]=(counts[r.actionableGroup]||0)+1;
 return {schemaVersion:'g22-v16-g11-exclusion-crosswalk-1',session:g.session,universeG11:g.counts?.active,
  universeV16:v.active,counts,rows,automaticPromotion:false,sourceStatus:'DIAGNOSTIC_ONLY'};
}
function run(gPath,vPath,out){
 const g=JSON.parse(fs.readFileSync(gPath,'utf8')),v=JSON.parse(fs.readFileSync(vPath,'utf8'));
 const result=crosswalk(g,v);fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log('G22_V16_G11_CROSSWALK '+JSON.stringify({session:result.session,counts:result.counts,g11:result.universeG11,v16:result.universeV16}));
}
if(require.main===module)run(process.argv[2],process.argv[3],process.argv[4]);
module.exports={crosswalk};
