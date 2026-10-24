'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadUniverse}=require('./egx-strategy-challengers-v1.cjs');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const SOURCE_SPECS=[
 {id:'MAIN_SNAPSHOTS',file:'data/history.json',kind:'OHLCV'},
 {id:'MAIN_HISTORY_50',file:'data/history-50.json',kind:'OHLCV'},
 {id:'LEGACY_V01_HISTORY',file:'sources/legacy-01/data/history.json',kind:'OHLCV'},
 {id:'LEGACY_V01_HISTORY_50',file:'sources/legacy-01/data/history-50.json',kind:'OHLCV'},
 {id:'LEGACY_V01_TECHNICAL',file:'sources/legacy-01/data/v20/technical-history.json',kind:'CANDIDATE_TECHNICAL'},
 {id:'LEGACY_PRO2026_HISTORY',file:'sources/legacy-pro2026/data/history.json',kind:'OHLCV'},
 {id:'LEGACY_PRO2026_POSTCLOSE',file:'sources/legacy-pro2026/data/postclose/history-v13-14.json',kind:'EVENT_LOG_NOT_DAILY_SERIES'},
 {id:'LONG_HORIZON_SUMMARY',file:'data/v17/historical-recovery/long-history/compact-market.json',kind:'SUMMARY_ONLY'},
 {id:'CENTRAL_QUARANTINE_MANIFEST',file:'sources/central-ledger/manifest.json',kind:'RESEARCH_EVIDENCE_MANIFEST'}
];
function isDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))}
function candle(raw){
 if(!raw||typeof raw!=='object')return null;
 const date=String(raw.date||raw.sessionDate||raw.timestamp||'').slice(0,10);
 if(!isDate(date)||!['open','high','low','close','volume'].every(k=>raw[k]!==undefined))return null;
 const b={date,open:Number(raw.open),high:Number(raw.high),low:Number(raw.low),close:Number(raw.close),volume:Number(raw.volume)};
 if(!Object.values(b).slice(1).every(Number.isFinite)||b.low<=0||b.open<=0||b.close<=0||b.volume<0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close))return null;
 return b;
}
function auditArray(value,ticker,source){
 let valid=0,suspect=0,quarantine=0,zero=0;
 const seen=new Map(),suspicionCounts={};let first=null,last=null;
 for(const raw of value){
  const b=candle(raw);if(!b)continue;
  valid++;
  if(!first||b.date<first)first=b.date;if(!last||b.date>last)last=b.date;
  if(!seen.has(b.date))seen.set(b.date,[]);
  seen.get(b.date).push({b,raw});
 }
 let researchUsable=0,conflictDates=0;
 for(const entries of seen.values()){
  const signatures=new Set(entries.map(e=>[e.b.open,e.b.high,e.b.low,e.b.close,e.b.volume].join('|')));
  if(signatures.size>1){conflictDates++;quarantine++;continue}
  const {b,raw}=entries[0];
  const caution=String(raw.sourceQuality||raw.source||raw.primarySource||'')+'|'+String(raw.validationStatus||'')+'|'+JSON.stringify(raw.warnings||[]);
  const reasons=[];
  if(b.volume===0){zero++;reasons.push('ZERO_VOLUME')}
  if(/snapshot_ohlc_derived|recovered_from_repository_snapshot_using_git_commit_date|partial_ohlc_reconstructed|reconstructed|synthetic/i.test(caution))reasons.push('DERIVED_OR_RECONSTRUCTED');
  if(/source_conflict|price_conflict|under_review|quarantine/i.test(caution))reasons.push('SOURCE_CONFLICT_OR_REVIEW');
  if(reasons.length){suspect++;for(const r of reasons)suspicionCounts[r]=(suspicionCounts[r]||0)+1}
  else researchUsable++;
 }
 return {ticker,source,validRows:valid,uniqueDates:seen.size,researchUsable,referenceOrReview:suspect,conflictDates,zeroVolumeDates:zero,firstDate:first,lastDate:last,suspicionCounts};
}
function collectArrays(doc){
 const found=[],seen=new Set();
 function visit(value,trail=[],depth=0){
  if(!value||typeof value!=='object'||depth>7||found.length>=100000||seen.has(value))return;
  seen.add(value);
  if(Array.isArray(value)){
   if(value.some(x=>candle(x))){const ticker=trail.slice().reverse().find(x=>/^[A-Z]{3,7}(\.CA)?$/.test(x))||null;
    if(ticker)found.push({ticker:ticker.replace(/\.CA$/,''),rows:value,trail:trail.join('/')});
    return}
   // Skip generic event logs or research signals; only descend if nontrivial possible nested symbol containers
   if(value.length>4000)return;
   for(let i=0;i<value.length;i++)if(typeof value[i]==='object')visit(value[i],trail.concat(String(i)),depth+1);
   return;
  }
  for(const [k,v] of Object.entries(value)){
   if(k==='horizons'||k==='features'||k==='indicators'||k==='signals'||k==='statistics')continue;
   visit(v,trail.concat(k),depth+1)
  }
 }
 visit(doc);return found;
}
function summarizeSource(spec,base=root){
 const filename=path.join(base,spec.file);
 if(!fs.existsSync(filename))return {...spec,status:'NOT_PRESENT_IN_CHECKOUT',arrays:0,stocks:0,maximumUsableDates:0};
 let doc;
 try{doc=JSON.parse(fs.readFileSync(filename,'utf8'))}catch(e){return {...spec,status:'UNREADABLE',error:String(e).slice(0,200),arrays:0,stocks:0,maximumUsableDates:0}}
 if(spec.kind==='SUMMARY_ONLY')return {...spec,status:'SUMMARY_ONLY_NO_DAILY_OHLCV',claimedSessionDistribution:doc.summary?.maximumDrawdownPct?{coveredStocks:doc.summary.successfullyCoveredEquities,validHistoricalData:doc.summary.validHistoricalData,sampleSessions:doc.results?.[0]?.sessionCount}:null,arrays:0,stocks:0,maximumUsableDates:0};
 if(spec.kind==='RESEARCH_EVIDENCE_MANIFEST')return {...spec,status:'QUARANTINED_NOT_AUTO_PROMOTED',rows:doc.count||null,tradingEligible:doc.trading_eligible===true,arrays:0,stocks:0,maximumUsableDates:0};
 if(spec.kind==='EVENT_LOG_NOT_DAILY_SERIES')return {...spec,status:'EVENT_LOG_NOT_CANDLE_INPUT',runs:doc.runs?.length||0,arrays:0,stocks:0,maximumUsableDates:0};
 const arrays=collectArrays(doc),groups=new Map();
 for(const {ticker,rows,trail} of arrays){const a=auditArray(rows,ticker,spec.id),g=groups.get(ticker);
  // Keep max usable array; do not add snapshot windows as if different days without reconciliation.
  if(!g||a.researchUsable>g.researchUsable)groups.set(ticker,{...a,path:trail});
 }
 const arr=[...groups.values()].sort((a,b)=>b.researchUsable-a.researchUsable);
 const sum=k=>arr.reduce((v,x)=>v+(x[k]||0),0);
 return {...spec,status:'AUDITED_NOT_PROMOTED',arrays:arrays.length,stocks:arr.length,
  stocksAtLeast120:arr.filter(x=>x.researchUsable>=120).length,
  stocksAtLeast250:arr.filter(x=>x.researchUsable>=250).length,
  stocksAtLeast500:arr.filter(x=>x.researchUsable>=500).length,
  maximumUsableDates:arr[0]?.researchUsable||0,totalUnverifiedCandles:sum('researchUsable'),
  referenceOrReview:sum('referenceOrReview'),conflictDates:sum('conflictDates'),
  topSymbols:arr.slice(0,12).map(x=>({ticker:x.ticker,researchUsable:x.researchUsable,firstDate:x.firstDate,lastDate:x.lastDate})),
  limitations:'Unverified dates, aliases, corporate actions, official settlement and cross-source conflicts prevent automatic price promotion'};
}
function build(base=root){
 const {universe}=loadUniverse(),main=Object.values(universe).map(rows=>rows.filter(x=>x.executable!==false&&x.volume>0).length);
 const sources=SOURCE_SPECS.map(spec=>summarizeSource(spec,base));
 const depth={stocks:main.length,atLeast120:main.filter(n=>n>=120).length,atLeast250:main.filter(n=>n>=250).length,atLeast500:main.filter(n=>n>=500).length,maximum:Math.max(...main)};
 return {schemaVersion:'egx-central-history-cross-repo-source-inventory-1',generatedAt:new Date().toISOString(),researchOnly:true,
  mainArchiveExecutableDepth:depth,sources,
  centralDatabaseExists:true,
  historicalRevalidationNeeded:true,
  promotionDecision:'BLOCKED_PENDING_CANDLE_PROVENANCE_AND_CROSS_SOURCE_RECONCILIATION',
  certifiedForBacktest: false,productionEnabled:false,
  findings:['Previous 0 stocks with 250 sessions describes current main/data/history executable stream only, NOT all repositories',
   'Historic long-horizon coverage reports summarize up to 10 years but do not contain corresponding raw daily OHLCV rows',
   'An existing SQLite evidence ledger is quarantined; it cannot be merged into an executable price stream by count alone',
   'No missing daily candle will be fabricated or imported from a summary statistic'],
  nextGate:'Identify source with >=250 real daily OHLCV bars per ticker, verify identity/adjustments/conflicts, then write append-only canonical history with provenance and run clean portfolio simulations'};
}
if(require.main===module){
 const report=build(),out=path.join(root,'data/research/egx-central-history-cross-repo-inventory-v1.json');
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({mainArchiveExecutableDepth:report.mainArchiveExecutableDepth,
  sources:report.sources.map(x=>({id:x.id,status:x.status,stocks:x.stocks,atLeast250:x.stocksAtLeast250,atLeast500:x.stocksAtLeast500,maximumUsableDates:x.maximumUsableDates,referenceOrReview:x.referenceOrReview,conflictDates:x.conflictDates}))},null,2));
}
module.exports={candle,auditArray,collectArrays,summarizeSource,build};
