'use strict';
const fs=require('node:fs'),path=require('node:path');
const {confirmedClosures,isTradingSession}=require('../ops/egx-session-math.cjs');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function build(rootDir=root){
 const dir=path.join(rootDir,'data/history'),closed=confirmedClosures(rootDir),universe={},audit={files:0,eligible:0,discarded:0,invalidBars:0,conflictingDuplicateDates:0,quarantinedBars:0,zeroVolumeReferenceBars:0,source:'data/history/*.json',centralEvidencePromoted:false,rejectionReasons:{},quarantineReasons:{},reviewSamples:[]};
 const note=(bucket,reason,ticker,date)=>{audit[bucket][reason]=(audit[bucket][reason]||0)+1;if(audit.reviewSamples.length<100)audit.reviewSamples.push({ticker,date,reason})};
 for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
  audit.files++;let doc;try{doc=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'))}catch{audit.discarded++;continue}
  if(!Array.isArray(doc.sessions)){audit.discarded++;continue}
  const perDate=new Map();
  for(const x of doc.sessions){
   const b={date:String(x.date||x.sessionDate||'').slice(0,10),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume)};
   const rejected=x.validationStatus==='source_conflict'||(x.warnings||[]).some(w=>/price_conflict/i.test(String(w)));
   const valid=/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&isTradingSession(b.date,closed)&&[b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)&&b.volume>=0&&b.low>0&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close,b.high);
   if(!valid){audit.invalidBars++;const reason=!/^\d{4}-\d{2}-\d{2}$/.test(b.date)?'INVALID_DATE':!isTradingSession(b.date,closed)?'NON_TRADING_DATE':![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)?'NON_FINITE_OHLCV':!(b.volume>0)?'NON_POSITIVE_VOLUME':!(b.low>0)?'NON_POSITIVE_LOW':'OHLC_INCONSISTENT';note('rejectionReasons',reason,doc.ticker||name.slice(0,-5),b.date);continue}
   if(rejected){audit.quarantinedBars++;note('quarantineReasons',x.validationStatus==='source_conflict'?'SOURCE_CONFLICT':'PRICE_CONFLICT_WARNING',doc.ticker||name.slice(0,-5),b.date);continue}
   if(!perDate.has(b.date))perDate.set(b.date,[]);
   perDate.get(b.date).push(b);
  }
  const clean=[];
  for(const [date,entries] of perDate){
   const unique=new Set(entries.map(b=>[b.open,b.high,b.low,b.close,b.volume].join('|')));
   if(unique.size>1){audit.conflictingDuplicateDates++;note('quarantineReasons','DUPLICATE_DIFFERENT_OHLCV',doc.ticker||name.slice(0,-5),date);continue}
   const bar=entries[0];bar.executable=bar.volume>0;if(!bar.executable)audit.zeroVolumeReferenceBars++;clean.push(bar);
  }
  clean.sort((a,b)=>a.date.localeCompare(b.date));
  if(clean.filter(x=>x.executable).length<65){audit.discarded++;continue}
  const ticker=doc.ticker||name.slice(0,-5);
  if(universe[ticker]){audit.discarded++;continue}
  universe[ticker]=clean;audit.eligible++;
 }
 return {universe,audit};
}
function enforceCentralGate(report){
 if(!report||!report.centralEvidence)return {allowed:false,reason:'NO_CENTRAL_EVIDENCE_REPORT'};
 if(report.centralEvidence.quarantineOnly||!report.canUseCentralForExecutableBacktest)return {allowed:false,reason:'CENTRAL_EVIDENCE_NOT_PROMOTED'};
 return {allowed:true,reason:'CENTRAL_REPORT_ELIGIBLE_REQUIRES_CANDLE_PROVENANCE_CHECK'};
}
module.exports={build,enforceCentralGate};
