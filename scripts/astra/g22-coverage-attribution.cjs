'use strict';
// P1 evidence only: no acceptance changes or manual resurrection of rejected symbols.
const fs=require('node:fs'),path=require('node:path');
function produce({expected,activeUniverse,currentCanonical,pipelineReady=null,priceTruth,secondSource={},disposition={},outPath}){
 const rejected=Array.isArray(priceTruth?.sampleRejected)?priceTruth.sampleRejected:[];
 const missing=Array.isArray(priceTruth?.missingHistoryFiles)?priceTruth.missingHistoryFiles:[];
 const details=rejected.map(r=>({
  ticker:r.ticker,classification:'REJECTED',reason:r.reason||null,
  reportedChangePct:r.reportedChangePct??null,previousClose:r.previousClose??null,
  impliedPreviousClose:r.impliedPreviousClose??null,
  secondary:secondSource?.records?.[r.ticker]??null
 }));
 for(const ticker of missing)details.push({ticker,classification:'MISSING_HISTORY',secondary:secondSource?.records?.[ticker]??null});
 const observed=new Set(details.map(x=>x.ticker));
 for(const r of (Array.isArray(disposition?.unresolved)?disposition.unresolved:[])){
  if(r?.ticker&&!observed.has(r.ticker)){details.push({ticker:r.ticker,classification:'UNRESOLVED_DISPOSITION',reason:r.reason||null,secondary:secondSource?.records?.[r.ticker]??null});observed.add(r.ticker)}
 }
 for(const r of (Array.isArray(disposition?.verifiedIneligible)?disposition.verifiedIneligible:[])){
  if(r?.ticker&&!observed.has(r.ticker)){details.push({ticker:r.ticker,classification:'VERIFIED_INELIGIBLE',reason:r.reason||null,secondary:secondSource?.records?.[r.ticker]??null});observed.add(r.ticker)}
 }
 const required=Math.ceil(activeUniverse*.9);
 const pipelineRequired=Math.ceil(activeUniverse*.8);
 const hasPipeline=Number.isFinite(pipelineReady)&&pipelineReady>=0;
 const doc={schemaVersion:1,mode:'EVIDENCE_ONLY',expectedSession:expected,
  activeUniverse,currentCanonical,required,shortfall:Math.max(0,required-currentCanonical),
  coveragePct:activeUniverse?100*currentCanonical/activeUniverse:null,
  canonicalCoverageGate:currentCanonical>=required?'PASS':'BLOCKED',
  pipelineReady:hasPipeline?pipelineReady:null,pipelineRequired,
  pipelineShortfall:hasPipeline?Math.max(0,pipelineRequired-pipelineReady):null,
  pipelineCoveragePct:hasPipeline&&activeUniverse?100*pipelineReady/activeUniverse:null,
  pipelineCoverageGate:hasPipeline?(pipelineReady>=pipelineRequired?'PASS':'BLOCKED'):'NOT_MEASURED',
  sourceAcceptedRows:priceTruth?.acceptedRows??null,
  sampledRejectedCount:rejected.length,totalRejectedRows:priceTruth?.rejectedRows??null,missingHistoryCount:missing.length,
  unresolvedDispositionCount:Array.isArray(disposition?.unresolved)?disposition.unresolved.length:null,
  verifiedIneligibleCount:Array.isArray(disposition?.verifiedIneligible)?disposition.verifiedIneligible.length:null,
  details};
 if(outPath){fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(doc,null,2)+'\n');}
 return doc;
}
module.exports={produce};
