'use strict';
/* Research overlay; source-observed close and volume only; NEVER an OHLCV trading signal */
function buildResearchCloseMap(dataset){
 if(dataset?.status!=='RESEARCH_ONLY_NO_PRODUCTION_MERGE'||dataset?.noAutomaticMarketHistoryModification!==true)
  throw Error('Research evidence manifest is not production-safe');
 const out=new Map();
 for(const x of dataset.observations||[]){
  if(x.permittedUse!=='RESEARCH_MARK_TO_MARKET_ONLY'||x.productionMergeAllowed!==false||
     x.completeOhlcvCertified!==false||x.sourceLicensedForRedistribution!==false||
     !(Number.isFinite(x.closeEgp)&&x.closeEgp>0&&Number.isSafeInteger(x.volumeShares)&&x.volumeShares>0)||
     !/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!Array.isArray(x.finalCloseEvidence)||x.finalCloseEvidence.length<2||
     x.finalCloseEvidence.some(s=>!s.url?.startsWith('https://')||Math.abs(s.quoteCloseEgp-x.closeEgp)>0.0001))
   throw Error('Incomplete provenance for '+x.ticker+' '+x.date);
  const k=x.ticker+'|'+x.date;if(out.has(k))throw Error('Duplicate evidence key: '+k);
  out.set(k,{close:x.closeEgp,volume:x.volumeShares,sourceGrade:'MULTI_SOURCE_RESEARCH',priceBasis:x.priceBasis});
 }
 return out;
}
module.exports={buildResearchCloseMap};
