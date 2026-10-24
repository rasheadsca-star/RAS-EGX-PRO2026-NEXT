'use strict';
const fs=require('node:fs'),path=require('node:path');
if(process.env.EGX_ENABLE_LIVE_TRADING==='true')throw Error('Restoration research only');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {loadUniverse}=require('./egx-strategy-challengers-v1.cjs');
const {candle}=require('./egx-central-history-cross-repo-inventory-v1.cjs');
function verifyDoc(doc,mainRows=[]){
 const sessions=Array.isArray(doc.sessions)?doc.sessions:[];
 const byDate=new Map(),problems=[];
 let adjustedMissing=0,synthetic=0;
 for(const r of sessions){
  const bar=candle(r);if(!bar){problems.push('INVALID_OR_INCOMPLETE_OHLCV');continue}
  if(!byDate.has(bar.date))byDate.set(bar.date,[]);
  byDate.get(bar.date).push(bar);
  if(!(Number(r.adjustedClose)>0))adjustedMissing++;
  if((r.warnings||[]).some(x=>/reconstruct|snapshot_ohlc_derived|fabricat/i.test(String(x))))synthetic++;
 }
 const conflicts=[...byDate.values()].filter(rows=>new Set(rows.map(v=>[v.open,v.high,v.low,v.close,v.volume].join(':'))).size>1).length;
 if(conflicts)problems.push('DUPLICATE_PRICE_CONFLICT');
 if(adjustedMissing)problems.push('MISSING_ADJUSTED_CLOSE');
 if(synthetic)problems.push('RECONSTRUCTED_CANDLES');
 if(!doc.symbolIdentity?.verified)problems.push('IDENTITY_UNVERIFIED');
 if(doc.dataQualityStatus!=='VALID')problems.push('LONG_HISTORY_SOURCE_REQUIRES_REVIEW');
 if(!doc.sourceSymbol||!String(doc.sourceSymbol).toUpperCase().endsWith('.CA'))problems.push('SYMBOL_NOT_EGX_CA');
 const mainByDate=new Map(mainRows.map(v=>[v.date,v])),overlap=[];
 for(const [date,bars]of byDate){const main=mainByDate.get(date);if(main&&bars[0].close>0)overlap.push({date,relativeCloseDiffPct:100*Math.abs(main.close-bars[0].close)/bars[0].close})}
 const largeMismatch=overlap.filter(x=>x.relativeCloseDiffPct>2);
 if(largeMismatch.length)problems.push('RECONCILE_MAIN_CLOSE_PRICE_MISMATCH');
 if(byDate.size<250)problems.push('INSUFFICIENT_250_DAILY_CANDLES');
 // This remains research-only even when structurally valid: official CA evidence and source licensing are not established.
 return {ticker:doc.ticker,status:doc.dataQualityStatus,sourceSymbol:doc.sourceSymbol,source:doc.source,
  rawDailyRows:sessions.length,uniqueValidDays:byDate.size,firstDate:[...byDate.keys()].sort()[0]||null,lastDate:[...byDate.keys()].sort().at(-1)||null,
  overlapCount:overlap.length,overlapLargeMismatchCount:largeMismatch.length,largestMismatchPct:overlap.length?+Math.max(...overlap.map(x=>x.relativeCloseDiffPct)).toFixed(3):null,
  adjustedMissing,synthetic,duplicateConflicts:conflicts,problems:[...new Set(problems)],
  researchHistoryCandidate:!problems.length,fullProductionCertification:false,
  sampleMismatch:largeMismatch.slice(0,6),
  rawFilePreserved:true};
}
function inspect(rootDir=root){
 const dir=path.join(rootDir,'data/v17/historical-recovery/history'),{universe}=loadUniverse();
 const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>x.endsWith('.json')):[];
 const stocks=files.map(f=>{const doc=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));return verifyDoc(doc,universe[doc.ticker]||[])}).sort((a,b)=>a.ticker.localeCompare(b.ticker));
 const summary={examined:stocks.length,retrievedWith250Bars:stocks.filter(x=>x.uniqueValidDays>=250).length,
  structurallyCandidate:stocks.filter(x=>x.researchHistoryCandidate).length,
  rejectedOrReview:stocks.filter(x=>!x.researchHistoryCandidate).length,
  distinctDaysMax:Math.max(0,...stocks.map(x=>x.uniqueValidDays)),
  mainOverlapMismatchSymbols:stocks.filter(x=>x.overlapLargeMismatchCount>0).length};
 return {schemaVersion:'egx-central-long-history-restore-quality-1',generatedAt:new Date().toISOString(),researchOnly:true,
  source:'Existing V17 10y ingester; actual raw daily files archived read-only in CI artifacts',summary,stocks,
  writeMainOHLCV:false,autoPromote:false,productionEnabled:false,
  missingOfficialCorporateActionCertification:true,
  note:'This restores RAW long-history candles rather than compact statistical summaries. Research candidate is NOT live or independently certified, and previous observed historical dates cannot count as unseen holdout.'};
}
if(require.main===module){const r=inspect(),dest=path.join(root,'data/research/egx-central-long-history-restoration-quality-v1.json');fs.writeFileSync(dest,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2))}
module.exports={verifyDoc,inspect};
