'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {candle}=require('./egx-central-history-cross-repo-inventory-v1.cjs');
const {isTradingSession,confirmedClosures}=require('../ops/egx-session-math.cjs');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function loadResearchOnlyCentral(base=path.join(root,'sources/central-ledger'),closed=confirmedClosures(root)){
 const qualityPath=path.join(base,'raw-long-history-quality.json');
 if(!fs.existsSync(qualityPath))throw Error('Central raw-long-history quality report missing: fail closed');
 const report=JSON.parse(fs.readFileSync(qualityPath,'utf8'));
 if(report.schemaVersion!=='egx-central-long-history-restore-quality-1')throw Error('Unexpected central source quality version');
 const universe={},audit={centralBranch:'egx-research-ledger',storedSymbols:report.stocks.length,qualityCandidates:0,usableSymbols:0,notPresent:0,invalidBars:0,closedSessionBars:0,zeroVolumeReferenceBars:0,duplicateConflictDates:0,suppressed:[],rawSource:'existing V17 Yahoo 10-year collector',researchOnly:true,noLivePromotion:true};
 for(const item of report.stocks){
  if(item.researchHistoryCandidate!==true){audit.suppressed.push({ticker:item.ticker,reason:'QUARANTINED_BY_RECONCILIATION'});continue}
  audit.qualityCandidates++;
  const filename=path.join(base,'raw-long-history-gzip',item.ticker+'.json.gz');
  if(!fs.existsSync(filename)){audit.notPresent++;audit.suppressed.push({ticker:item.ticker,reason:'RAW_GZIP_MISSING'});continue}
  let doc;try{doc=JSON.parse(zlib.gunzipSync(fs.readFileSync(filename)).toString('utf8'))}catch{audit.suppressed.push({ticker:item.ticker,reason:'CORRUPT_GZIP_OR_JSON'});continue}
  if(doc.ticker!==item.ticker||doc.dataQualityStatus!=='VALID'||doc.symbolIdentity?.verified!==true||doc.source!=='YAHOO_CHART_API'){audit.suppressed.push({ticker:item.ticker,reason:'ORIGINAL_PROVENANCE_MISMATCH'});continue}
  const dates=new Map(),blocked=new Set();
  for(const raw of doc.sessions||[]){
   const b=candle(raw);if(!b){audit.invalidBars++;continue}
   if(!isTradingSession(b.date,closed)){audit.closedSessionBars++;continue}
   if(dates.has(b.date)){
    const p=dates.get(b.date);
    if([p.open,p.high,p.low,p.close,p.volume].join('|')!==[b.open,b.high,b.low,b.close,b.volume].join('|')){blocked.add(b.date);audit.duplicateConflictDates++}
    continue;
   }
   dates.set(b.date,{...b,adjustedClose:Number(raw.adjustedClose)||null,executable:b.volume>0,
    priceProvenance:'YAHOO_CHART_API_V17_LONG_HISTORY_UNCERTIFIED_CORPORATE_ACTIONS'});
   if(b.volume===0)audit.zeroVolumeReferenceBars++;
  }
  const clean=[...dates.values()].filter(b=>!blocked.has(b.date)).sort((a,b)=>a.date.localeCompare(b.date));
  if(clean.filter(b=>b.executable).length<250){audit.suppressed.push({ticker:item.ticker,reason:'INSUFFICIENT_250_CLEAN_CANDLES_AFTER_CLOSURES'});continue}
  universe[item.ticker]=clean;audit.usableSymbols++;
 }
 return {universe,audit,productionEligible:false,strictAQMEligible:false,limitations:['Research-only source subset selected after examining current and historical prices, not a point-in-time universe','Unverified official corporate actions and exchange parity; never treat as live-tradable','Missing/corrected OHLCV bars are dropped, never synthesized','No EGX30 point-in-time history or financial/event certification']};
}
if(require.main===module){const r=loadResearchOnlyCentral();const first=Object.keys(r.universe)[0];console.log(JSON.stringify({audit:{...r.audit,suppressedSample:r.audit.suppressed.slice(0,15),suppressed:undefined},example:first?{ticker:first,validBars:r.universe[first].length,first:r.universe[first][0].date,last:r.universe[first].at(-1).date}:null},null,2))}
module.exports={loadResearchOnlyCentral};
