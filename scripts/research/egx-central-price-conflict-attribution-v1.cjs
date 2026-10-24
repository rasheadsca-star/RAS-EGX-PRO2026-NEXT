'use strict';
// Do not select a winner on a conflicting price date. Attribution != price certification.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {candle}=require('./egx-central-history-cross-repo-inventory-v1.cjs');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function classifyMainProvenance(bar){
 const warnings=(bar.warnings||[]).map(x=>String(x));
 if(warnings.some(x=>/reconstruct|snapshot_ohlc_derived|fabricat|synthetic/i.test(x))||/reconstructed|snapshot_ohlc_derived/i.test(String(bar.sourceQuality||'')))return 'MAIN_OHLC_RECONSTRUCTED';
 if(String(bar.validationStatus||'')==='source_conflict'||warnings.some(x=>/price_conflict|source_conflict/i.test(x)))return 'MAIN_ALREADY_CONFLICTED';
 if(/yahoo/i.test(String(bar.primarySource||bar.source||'')))return 'MAIN_YAHOO_SOURCE_NOT_INDEPENDENT';
 if(bar.officialVerified===true)return 'MAIN_CLAIMS_OFFICIAL_VERIFICATION';
 return 'MAIN_SECONDARY_OR_UNVERIFIED';
}
function suspectedStableScale(conflicts){
 const a=conflicts.filter(x=>x.sourceClose>0&&x.mainClose>0).map(x=>x.mainClose/x.sourceClose).sort((x,y)=>x-y);
 if(a.length<3)return null;
 const median=a[Math.floor(a.length/2)],p10=a[Math.floor((a.length-1)*0.1)],p90=a[Math.ceil((a.length-1)*0.9)];
 if(!(median>=2||median<=0.5))return null;
 const relativeSpread=(p90-p10)/median;
 if(relativeSpread>0.05)return null;
 return {classification:'STABLE_PRICE_SCALE_DISAGREEMENT_REQUIRES_CA_OR_IDENTITY_PROOF',
  approximateMainToSourceFactor:+median.toFixed(4),ratioRelativeSpreadPct:+(100*relativeSpread).toFixed(3),
  sampledConflictingDates:a.length,autoAdjustAllowed:false};
}
function reconcileOne(doc,mainDoc,{thresholdPct=2}={}){
 const main=new Map((mainDoc?.sessions||[]).filter(x=>x&&x.date).map(x=>[x.date,x]));
 const unique=new Map();
 let invalidHistoricalCandles=0;
 for(const raw of doc.sessions||[]){
  const parsed=candle(raw);
  if(!parsed){invalidHistoricalCandles++;continue}
  if(!unique.has(parsed.date))unique.set(parsed.date,parsed);
 }
 const conflicts=[],provenanceCounts={},reviewCounts={},overlaps=[];
 for(const [date,bar]of unique){
  const reference=main.get(date);
  if(!reference||!(Number(reference.close)>0))continue;
  const difference=100*Math.abs(reference.close-bar.close)/bar.close;
  overlaps.push(difference);
  if(difference<=thresholdPct)continue;
  const classification=classifyMainProvenance(reference);
  provenanceCounts[classification]=(provenanceCounts[classification]||0)+1;
  const category=difference>=15?'LARGE_DISLOCATION_CA_REVIEW':classification;
  reviewCounts[category]=(reviewCounts[category]||0)+1;
  conflicts.push({date,sourceClose:bar.close,mainClose:Number(reference.close),differencePct:+difference.toFixed(4),
   mainSource:String(reference.primarySource||reference.source||'UNKNOWN'),
   mainSessionValidation:String(reference.validationStatus||'UNKNOWN'),
   mainProvenanceCategory:classification,
   requiresIndependentResolution:true,originalSource:'YAHOO_CHART_API_V17_UNCERTIFIED'});
 }
 const suspected=conflicts.filter(v=>v.mainProvenanceCategory==='MAIN_OHLC_RECONSTRUCTED').length;
 return {ticker:doc.ticker,sourceQuality:doc.dataQualityStatus,
  validSourceDailyCount:unique.size,invalidHistoricalCandles,overlapDays:overlaps.length,
  conflictCount:conflicts.length,weakMainEvidenceDisagreements:suspected,
  suspectedScaleMismatch:suspectedStableScale(conflicts),
  conflictWithNonReconstructedMain:conflicts.length-suspected,
  maximumDisagreementPct:conflicts.length?Math.max(...conflicts.map(x=>x.differencePct)):0,
  byCause:provenanceCounts,byPriority:reviewCounts,conflicts:conflicts.slice(0,20),allConflicts:conflicts,
  eligibleForAutomaticPromotion:false};
}
function analyze(base=root){
 const ledger=path.join(base,'sources/central-ledger');
 const quality=JSON.parse(fs.readFileSync(path.join(ledger,'raw-long-history-quality.json'),'utf8'));
 const out=[],totals={sourceFiles:0,sourceFilesWithOverlaps:0,stocksWithConflicts:0,conflictDays:0,weakMainEvidenceDisagreements:0,conflictsWithNonReconstructedMain:0,validHistoricalCandles:0,invalidHistoricalCandles:0,causeCounts:{}};
 for(const s of quality.stocks){
  const f=path.join(ledger,'raw-long-history-gzip',s.ticker+'.json.gz');
  if(!fs.existsSync(f))continue;
  let doc;try{doc=JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'))}catch{continue}
  const mainFile=path.join(base,'data/history',s.ticker+'.json');
  let main=null;
  if(fs.existsSync(mainFile)){try{main=JSON.parse(fs.readFileSync(mainFile,'utf8'))}catch{}}
  const r=reconcileOne(doc,main);
  out.push(r);totals.sourceFiles++;totals.validHistoricalCandles+=r.validSourceDailyCount;
  totals.invalidHistoricalCandles+=r.invalidHistoricalCandles;
  if(r.overlapDays)totals.sourceFilesWithOverlaps++;
  if(r.conflictCount)totals.stocksWithConflicts++;
  totals.conflictDays+=r.conflictCount;
  totals.weakMainEvidenceDisagreements+=r.weakMainEvidenceDisagreements;
  totals.conflictsWithNonReconstructedMain+=r.conflictWithNonReconstructedMain;
  for(const [k,v]of Object.entries(r.byCause))totals.causeCounts[k]=(totals.causeCounts[k]||0)+v;
 }
 out.sort((a,b)=>b.conflictCount-a.conflictCount||a.ticker.localeCompare(b.ticker));
 totals.suspectedStableScaleMismatchSymbols=out.filter(x=>x.suspectedScaleMismatch).length;
 const reviewQueue=out.flatMap(stock=>stock.allConflicts.map(issue=>({ticker:stock.ticker,...issue,
  priority:stock.suspectedScaleMismatch?'P0_PERSISTENT_SCALE_NEEDS_IDENTITY_CA_PROOF':issue.differencePct>=15?'P1_LARGE_PRICE_DISLOCATION':'P2_DAILY_CLOSE_MISMATCH',
  requiredEvidence:stock.suspectedScaleMismatch?'OFFICIAL_CORPORATE_ACTION_AND_SECURITY_IDENTITY':issue.mainProvenanceCategory==='MAIN_OHLC_RECONSTRUCTED'?'INDEPENDENT_DATE_STAMPED_OHLCV':'EXCHANGE_CERTIFIED_CLOSE_OR_INDEPENDENT_SECONDARY_FEED',
  automaticRepairAllowed:false})))
  .sort((a,b)=>a.priority.localeCompare(b.priority)||b.differencePct-a.differencePct||a.ticker.localeCompare(b.ticker)||a.date.localeCompare(b.date));
 return {schemaVersion:'egx-central-price-conflict-attribution-v1',generatedAt:new Date().toISOString(),status:'RESEARCH_EVIDENCE_NO_PRICE_WINNER',source:'existing egx-research-ledger raw long history vs main session provenance',thresholdPct:2,totals,
  priorityStocks:out.filter(x=>x.conflictCount).slice(0,35).map(({allConflicts,...r})=>r),
  reviewQueue,allTickerAggregates:out.map(({conflicts,allConflicts,...r})=>r),
  nextAction:'Verify mismatching dates against exchange-certified or genuinely independent dated OHLCV; never auto-adjust, interpolate, or merge disputed candles',
  productionPromotionAllowed:false,researchEligibilityAutomaticallyUpgraded:false};
}
if(require.main===module){const r=analyze();const file=path.join(root,'data/research/egx-central-price-conflict-attribution-v1.json');fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({totals:r.totals,queueCount:r.reviewQueue.length,reviewPriorities:r.reviewQueue.reduce((o,x)=>(o[x.priority]=(o[x.priority]||0)+1,o),{}),priorityStocks:r.priorityStocks.slice(0,5).map(x=>({ticker:x.ticker,conflictCount:x.conflictCount,suspectedScaleMismatch:x.suspectedScaleMismatch}))},null,2))}
module.exports={classifyMainProvenance,suspectedStableScale,reconcileOne,analyze};
