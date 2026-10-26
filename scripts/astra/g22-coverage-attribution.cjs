'use strict';
// P1 evidence only: no acceptance changes or manual resurrection of rejected symbols.
const fs=require('node:fs'),path=require('node:path');
function produce({expected,activeUniverse,currentCanonical,priceTruth,secondSource={},outPath}){
 const rejected=Array.isArray(priceTruth?.sampleRejected)?priceTruth.sampleRejected:[];
 const missing=Array.isArray(priceTruth?.missingHistoryFiles)?priceTruth.missingHistoryFiles:[];
 const details=rejected.map(r=>({
  ticker:r.ticker,classification:'REJECTED',reason:r.reason||null,
  reportedChangePct:r.reportedChangePct??null,previousClose:r.previousClose??null,
  impliedPreviousClose:r.impliedPreviousClose??null,
  secondary:secondSource?.records?.[r.ticker]??null
 }));
 for(const ticker of missing)details.push({ticker,classification:'MISSING_HISTORY',secondary:secondSource?.records?.[ticker]??null});
 const required=Math.ceil(activeUniverse*.9);
 const doc={schemaVersion:1,mode:'EVIDENCE_ONLY',expectedSession:expected,
  activeUniverse,currentCanonical,required,shortfall:Math.max(0,required-currentCanonical),
  coveragePct:activeUniverse?100*currentCanonical/activeUniverse:null,
  sourceAcceptedRows:priceTruth?.acceptedRows??null,
  rejectedCount:rejected.length,missingHistoryCount:missing.length,
  details};
 if(outPath){fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(doc,null,2)+'\n');}
 return doc;
}
module.exports={produce};
