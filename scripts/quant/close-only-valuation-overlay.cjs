'use strict';
// Research valuation overlay: an independently checked CLOSE may fill a daily portfolio mark
// without claiming it is a complete OHLC bar or enabling entry/exit strategies.
const fs=require('node:fs'),path=require('node:path');
function selectCloseMarks(records, opts={}){
 const accepted=[],blocked=[],seen=new Set();
 for(const r of records){
  const key=r.ticker+'|'+r.date,reasons=[];
  if(seen.has(key))reasons.push('duplicate_key');seen.add(key);
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(r.date||''))reasons.push('bad_date');
  if(!(Number.isFinite(Number(r.close))&&Number(r.close)>0&&r.close!==''&&r.close!=null))reasons.push('bad_close');
  if(r.sourceIndependentlyChecked!==true||!r.independentEvidenceUrl||!r.sourceUrl)reasons.push('unverified_independent_source');
  if(!['RAW_UNADJUSTED','ADJUSTED_WITH_VERIFIED_FACTOR'].includes(r.priceBasis))reasons.push('unresolved_price_basis');
  if(r.priceBasis==='ADJUSTED_WITH_VERIFIED_FACTOR'&&!(Number(r.adjustmentFactor)>0&&r.corporateActionEvidenceUrl))reasons.push('missing_action_factor');
  if(r.suspended===true||r.status==='UNRESOLVED')reasons.push('unresolved_or_suspended');
  if(reasons.length)blocked.push({ticker:r.ticker,date:r.date,reasons});
  else accepted.push({ticker:r.ticker,date:r.date,close:Number(r.close),priceBasis:r.priceBasis,
    sourceUrl:r.sourceUrl,independentEvidenceUrl:r.independentEvidenceUrl,
    usage:'INTERIM_MARK_TO_MARKET_ONLY',strategyBarComplete:false,productionMergeAllowed:false});
 }
 return {status:'RESEARCH_VALUATION_ONLY',accepted,blocked,acceptedCount:accepted.length,blockedCount:blocked.length,
  strategySignalApproved:0,productionMergeAllowed:false};
}
if(require.main===module){
 const [input,output='research-artifacts/close-only-valuation-overlay.json']=process.argv.slice(2);
 if(!input)throw Error('usage: node close-only-valuation-overlay.cjs <reviewed-json> [output]');
 const raw=JSON.parse(fs.readFileSync(input,'utf8'));
 const result=selectCloseMarks(Array.isArray(raw)?raw:raw.records||[]);
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({accepted:result.acceptedCount,blocked:result.blockedCount,productionMergeAllowed:false}));
}
module.exports={selectCloseMarks};
