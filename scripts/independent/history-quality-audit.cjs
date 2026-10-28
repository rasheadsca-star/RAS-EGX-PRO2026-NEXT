'use strict';
// Reproducible, read-only OHLCV audit. Research evidence, NOT trade certification.
// "Consecutive" means adjacent entries in the repository's observed-session
// calendar, which is NOT an independently certified EGX trading calendar.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validIsin,historicalBarValid}=require('./egx-independent-paper.cjs');
const {strictProvenance}=require('./walkforward-backtest.cjs');
const {copiedBarReasons}=require('./stale-bar-detector.cjs');
const ROOT=process.env.GITHUB_WORKSPACE||process.cwd();
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const day=r=>r?.date||r?.sessionDate;
const count=(items)=>items.reduce((a,x)=>(a[x]=(a[x]||0)+1,a),{});
const median=a=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);return (b[Math.floor((b.length-1)/2)]+b[Math.floor(b.length/2)])/2};
function structural(r){
 if(!iso(day(r)))return false;
 const x=['open','high','low','close','volume'].map(k=>r?.[k]);
 return x.every(v=>typeof v==='number'&&Number.isFinite(v))&&
  r.open>0&&r.close>0&&r.low>0&&r.high>=Math.max(r.open,r.close)&&
  r.low<=Math.min(r.open,r.close)&&r.volume>=0;
}
function streak(rows,ok,calendar,target){
 const indexes=new Map(calendar.map((d,i)=>[d,i]));
 let longest=0,trailing=0,current=0,last=-2,lastDay=null;
 for(const r of rows){
  const d=day(r),idx=indexes.get(d);
  if(!ok(r)||idx===undefined){current=0;last=-2;continue}
  // A duplicate date is already quarantined by the caller.
  const consecutive=idx===last+1;
  current=consecutive?current+1:1;
  longest=Math.max(longest,current);
  last=idx;lastDay=d;
 }
 if(lastDay===target)trailing=current;
 return {longest,trailing};
}
function auditTicker(ticker,meta,history,calendar,actions=[],rawSha=null,target=null){
 const entries=Array.isArray(history?.sessions)?history.sessions:[];
 const ordered=entries.map((r,i)=>({...r,__auditIndex:i}))
  .sort((a,b)=>String(day(a)||'').localeCompare(String(day(b)||''))||a.__auditIndex-b.__auditIndex);
 const mapIsin=String(meta?.isin||'').toUpperCase();
 const fileIsin=String(history?.isin||'').toUpperCase();
 const identity={mappedIsin:mapIsin||null,historyIsin:fileIsin||null,
  isinChecksumValid:validIsin(fileIsin),
  symbolVerified:history?.symbolVerified===true,
  mapMatchesHistory:!!fileIsin&&(!mapIsin||mapIsin===fileIsin),
  tickerMatches:!history?.ticker||String(history.ticker).toUpperCase()===ticker,
  currencyMatches:!meta?.currency||!history?.currency||String(meta.currency).toUpperCase()===String(history.currency).toUpperCase(),
  exchangeMatches:!meta?.exchange||!history?.exchange||String(meta.exchange).toUpperCase()===String(history.exchange).toUpperCase()};
 identity.strict=identity.isinChecksumValid&&identity.symbolVerified&&identity.mapMatchesHistory&&
  identity.tickerMatches&&identity.currencyMatches&&identity.exchangeMatches;
 const licenseClaims=[history?.licenseRef,history?.licenseId,history?.usageRights,
  ...ordered.map(r=>r.licenseRef||r.licenseId||r.usageRights)].filter(Boolean);
 // A vendor URL, source name or free website is NOT evidence of reuse rights.
 const licenseStatus=licenseClaims.length?'CLAIMED_NOT_INDEPENDENTLY_VERIFIED':'NO_EXPLICIT_USAGE_RIGHTS';
 const quarantines=new Map(),flag=(i,reason)=>{
  if(!quarantines.has(i))quarantines.set(i,new Set());
  quarantines.get(i).add(reason);
 };
 const dates=new Map();
 for(let i=0;i<ordered.length;i++){
  const r=ordered[i],d=day(r);
  if(!iso(d)){flag(i,'INVALID_DATE');continue}
  if(!dates.has(d))dates.set(d,[]);
  dates.get(d).push(i);
  if(!structural(r))flag(i,'INVALID_OR_INCOMPLETE_OHLCV');
  if(/partial_ohlc|reconstruct|synthetic/i.test(String(r.validationStatus||'')+' '+(r.warnings||[]).join(' ')))
   flag(i,'PARTIAL_OR_SYNTHETIC_OHLC');
  if(!strictProvenance(r,historicalBarValid))flag(i,'SOURCE_PROVENANCE_INCOMPLETE');
  if(!calendar.includes(d))flag(i,'DATE_OUTSIDE_OBSERVED_CALENDAR');
 }
 for(const indices of dates.values())if(indices.length>1)for(const i of indices)flag(i,'DUPLICATE_SESSION');
 const copied=copiedBarReasons(ordered);
 for(const c of copied){flag(c.index,c.reason);flag(c.index-1,c.reason)}
 const pending=(Array.isArray(actions)?actions:[]).filter(a=>a?.ticker===ticker&&a.status==='review_required'&&iso(a.date));
 for(const a of pending){
  // Quarantine the first bar at/after an unresolved discontinuity. This
  // breaks any run spanning the event even if the event date has no bar.
  const i=ordered.findIndex(r=>iso(day(r))&&day(r)>=a.date);
  if(i>=0)flag(i,'CORPORATE_ACTION_REVIEW_REQUIRED');
 }
 const shapeOK=r=>structural(r)&&dates.get(day(r))?.length===1&&calendar.includes(day(r));
 const strictOK=r=>identity.strict&&shapeOK(r)&&!quarantines.has(r.__auditIndex);
 const shape=streak(ordered,shapeOK,calendar,target);
 const strict=streak(ordered,strictOK,calendar,target);
 const sortedDates=[...dates.keys()].filter(iso).sort();
 const missing=sortedDates.length?calendar.filter(d=>d>=sortedDates[0]&&d<=sortedDates.at(-1)&&!dates.has(d)):[];
 const reasons=count([...quarantines.values()].flatMap(x=>[...x]));
 const latest=sortedDates.at(-1)||null;
 const sourceNames=[...new Set(ordered.map(r=>String(r.primarySource||r.source||'')).filter(Boolean))].sort();
 return {ticker,active:meta?.active!==false,historyFilePresent:!!history,historySha256:rawSha,
  identity,license:{status:licenseStatus,claimsCount:licenseClaims.length},
  sourceNames,latestSession:latest,latestIsTarget:latest===target,
  inputRows:entries.length,uniqueDatedSessions:dates.size,
  structurallyValidRows:ordered.filter(shapeOK).length,
  strictlyAcceptedRows:ordered.filter(strictOK).length,
  partialOrSyntheticRows:ordered.filter(r=>/partial_ohlc|reconstruct|synthetic/i.test(String(r.validationStatus||'')+' '+(r.warnings||[]).join(' '))).length,
  copiedPairs:count(copied.map(c=>c.reason)),
  quarantineRows:quarantines.size,quarantineReasons:reasons,
  missingObservedSessions:missing.length,missingObservedSessionsSample:missing.slice(-12),
  longestConsecutive:{structural:shape.longest,strict:strict.longest},
  currentConsecutive:{structural:shape.trailing,strict:strict.trailing},
  eligibility:{structural60:shape.trailing>=60,structural140:shape.trailing>=140,
   strict60:strict.trailing>=60,strict140:strict.trailing>=140,
   historicalStructural60:shape.longest>=60,historicalStructural140:shape.longest>=140,
   historicalStrict60:strict.longest>=60,historicalStrict140:strict.longest>=140},
  researchOnly:true,executionReady:false};
}
function rankRecovery(rows){
 return rows.filter(x=>x.active&&x.historyFilePresent&&x.inputRows>0)
  .map(x=>({...x,recoveryScore:(x.identity.strict?10000:0)+x.currentConsecutive.strict*20+
   x.longestConsecutive.strict*5+x.currentConsecutive.structural*2+
   x.longestConsecutive.structural+(x.latestIsTarget?100:0)-
   x.quarantineRows*2}))
  .sort((a,b)=>b.recoveryScore-a.recoveryScore||a.ticker.localeCompare(b.ticker))
  .slice(0,10).map(x=>({ticker:x.ticker,score:x.recoveryScore,
   isinChecksumValid:x.identity.isinChecksumValid,strictIdentity:x.identity.strict,
   latestSession:x.latestSession,structuralTrailing:x.currentConsecutive.structural,
   strictTrailing:x.currentConsecutive.strict,strictLongest:x.longestConsecutive.strict,
   quarantined:x.quarantineRows,missingObservedSessions:x.missingObservedSessions,
   licenseStatus:x.license.status,
   action:'REQUEST_LICENSED_EOD_OHLCV_AND_ISIN_CORPORATE_ACTION_EVIDENCE',
   state:'RESEARCH_ONLY_NOT_EXECUTION_READY'}));
}
function buildAudit({symbols,histories,calendar,actions=[],target,sourceShas={},generatedAt=null,sourceCommitSha=null}){
 if(!iso(target)||!Array.isArray(calendar)||calendar.some(d=>!iso(d))||
    new Set(calendar).size!==calendar.length||calendar.some((d,i)=>i>0&&d<=calendar[i-1])||calendar.at(-1)!==target)
  throw Error('INVALID_OBSERVED_SESSION_CALENDAR');
 const names=[...new Set([...Object.keys(symbols).filter(t=>symbols[t]?.active!==false),...Object.keys(histories)])]
  .filter(t=>/^[A-Z0-9]{2,12}$/.test(t)).sort();
 const rows=names.map(t=>auditTicker(t,symbols[t],histories[t]?.data,calendar,actions,
  histories[t]?.sha||null,target));
 const withFiles=rows.filter(x=>x.historyFilePresent);
 const sum=key=>rows.filter(x=>x.eligibility[key]).length;
 const summary={symbolsAudited:rows.length,historyFiles:withFiles.length,
  rawInputRows:rows.reduce((n,x)=>n+x.inputRows,0),
  structuralAcceptedRows:rows.reduce((n,x)=>n+x.structurallyValidRows,0),
  strictAcceptedRows:rows.reduce((n,x)=>n+x.strictlyAcceptedRows,0),
  missingHistoryFiles:rows.filter(x=>!x.historyFilePresent).length,
  validHistoryIsin:withFiles.filter(x=>x.identity.isinChecksumValid).length,
  strictIdentity:withFiles.filter(x=>x.identity.strict).length,
  licensedForRedistribution:0, // no documented contract registry is connected
  medianLongestStrictConsecutive:median(withFiles.map(x=>x.longestConsecutive.strict)),
  medianLongestStructuralConsecutive:median(withFiles.map(x=>x.longestConsecutive.structural)),
  currentEligibility:{structural60:sum('structural60'),structural140:sum('structural140'),
   strict60:sum('strict60'),strict140:sum('strict140')},
  historicalEligibility:{structural60:sum('historicalStructural60'),structural140:sum('historicalStructural140'),
   strict60:sum('historicalStrict60'),strict140:sum('historicalStrict140')}};
 return {schemaVersion:'egx-history-quality-audit-v1',auditDate:target,generatedAt,
  sourceCommitSha,inputsSha256:sourceShas.inputsDigestSha256||null,
  auditLogicSha256:sourceShas.auditLogicSha256||null,
  calendar:{definition:'ADJACENT_REPOSITORY_OBSERVED_SESSIONS_NOT_CALENDAR_DAYS',
   officialExchangeCalendar:false,source:'data/session-calendar.json',
   limitations:'Union of stored validated dates; missing dates or holidays cannot be certified as exchange closures.',
   sessionCount:calendar.length,latest:calendar.at(-1)},
  policies:{structural:'Numeric OHLCV and unique observed date; partial_ohlc allowed if structurally complete',
   strict:'Structural plus ISO 6166 valid identity, dated source provenance, no partial/synthetic/copied/duplicate/corporate-action quarantine',
   license:'Unverified rights never imply permission to redistribute; no automatic vendor download',
   eligibility:'Trailing streak MUST end on auditDate; historical maximum reported separately',
   performance:'No strategy calibration or OOS certification; no trade orders'},
  summary,top10Recovery:rankRecovery(rows),tickers:rows,mode:'RESEARCH_ONLY',
  executionReady:false,performanceCertified:false,orders:[]};
}
function main(){
 const read=p=>fs.readFileSync(path.join(ROOT,p));
 const parse=p=>JSON.parse(read(p).toString('utf8'));
 const symbols=parse('data/symbol-map.json'),cal=parse('data/session-calendar.json'),
  actions=parse('data/corporate-actions.json').candidates||[];
 const dir=path.join(ROOT,'data/history'),files=fs.readdirSync(dir).filter(f=>/^[A-Z0-9]{2,12}\.json$/.test(f)).sort();
 const histories={};let dig=crypto.createHash('sha256');
 for(const p of ['data/symbol-map.json','data/session-calendar.json','data/corporate-actions.json']){
  const raw=read(p);dig.update(p).update('\0').update(raw);
 }
 for(const file of files){
  const raw=fs.readFileSync(path.join(dir,file));dig.update(file).update('\0').update(raw);
  try{histories[file.slice(0,-5)]={data:JSON.parse(raw),sha:sha(raw)}}
  catch{histories[file.slice(0,-5)]={data:{sessions:[]},sha:sha(raw),parseError:true}}
 }
 const logicSha=sha(fs.readFileSync(__filename)),inputSha=dig.digest('hex');
 const dest=path.join(ROOT,'unified-console/history-quality-audit.json');
 if(fs.existsSync(dest)){
  try{const old=JSON.parse(fs.readFileSync(dest,'utf8'));
   if(old.inputsSha256===inputSha&&old.auditLogicSha256===logicSha){
    console.log('HISTORY_QUALITY_AUDIT_UNCHANGED '+JSON.stringify(old.summary));return old;
   }
  }catch{}
 }
 const report=buildAudit({symbols,histories,calendar:cal.sessions,actions,
  target:cal.latestMarketSession,generatedAt:new Date().toISOString(),
  sourceCommitSha:process.env.GITHUB_SHA||null,
  sourceShas:{inputsDigestSha256:inputSha,auditLogicSha256:logicSha}});
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
 console.log('HISTORY_QUALITY_AUDIT '+JSON.stringify(report.summary));
 return report;
}
if(require.main===module)main();
module.exports={structural,streak,auditTicker,rankRecovery,buildAudit,main};
