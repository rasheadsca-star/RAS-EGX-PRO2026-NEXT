#!/usr/bin/env node
'use strict';
// Broader historical screen: never represents last historical close as a certified current EGX close.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),DIR=path.join(ROOT,'data/history');
const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const good=b=>b&&iso(b.date)&&['open','high','low','close','volume'].every(k=>Number.isFinite(Number(b[k])))&&Number(b.low)>0&&Number(b.high)>=Math.max(Number(b.open),Number(b.close))&&Number(b.low)<=Math.min(Number(b.open),Number(b.close))&&Number(b.volume)>=0;
const avg=a=>a.reduce((p,c)=>p+c,0)/a.length,fix=(n,d=3)=>Number(n.toFixed(d));
function build({root=ROOT,asOf=process.env.EGX_SESSION||null}={}){
 if(asOf!==null&&!iso(asOf))throw Error('INVALID_AS_OF');
 const dir=path.join(root,'data/history'),files=fs.readdirSync(dir).filter(f=>/^[A-Z0-9_-]+\.json$/.test(f)).sort();
 const rows=[],excluded=[];
 for(const file of files){
  const ticker=path.basename(file,'.json');let doc;
  try{doc=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'))}catch{excluded.push({ticker,reason:'INVALID_JSON'});continue}
  const raw=Array.isArray(doc.sessions)?doc.sessions:[],dates=new Set();let duplicate=false;
  for(const b of raw){if(!iso(b?.date))continue;if(dates.has(b.date))duplicate=true;dates.add(b.date)}
  if(duplicate){excluded.push({ticker,reason:'DUPLICATE_DATED_BAR'});continue}
  const bars=raw.filter(b=>good(b)&&(!asOf||b.date<=asOf)).sort((a,b)=>a.date.localeCompare(b.date));
  if(bars.length<60){excluded.push({ticker,reason:'INSUFFICIENT_VALID_BARS',observed:bars.length});continue}
  const last=bars.at(-1),prior=bars.at(-2),recent=bars.slice(-20),close=Number(last.close);
  const ma20=avg(recent.map(x=>Number(x.close))),v20=avg(recent.map(x=>Number(x.volume)));
  if(!(ma20>0&&v20>0)){excluded.push({ticker,reason:'INVALID_MA_OR_VOLUME'});continue}
  const resistance=Math.max(...bars.slice(-21,-1).map(x=>Number(x.high)));
  const support=Math.min(...bars.slice(-21,-1).map(x=>Number(x.low)));
  const volRatio=Number(last.volume)/v20,dist=resistance/close-1,trend=close>ma20;
  const tech=Math.max(0,Math.min(100,(close/ma20-1)*300+50));
  const score=35*Math.max(0,Math.min(1,1-dist/.2))+25*Math.min(volRatio/1.5,1)+25*tech/100+15*Number(trend);
  rows.push({ticker,latestBarDate:last.date,asOfRequested:asOf,calendarDaysBehindAsOf:asOf?Math.max(0,Math.floor((Date.parse(asOf+'T12:00:00Z')-Date.parse(last.date+'T12:00:00Z'))/86400000)):null,close:fix(close),previousClose:fix(Number(prior.close)),volume:Number(last.volume),volumeRatio20:fix(volRatio,2),sma20:fix(ma20),resistance20:fix(resistance),support20:fix(support),return5Pct:fix(100*(close/Number(bars.at(-6).close)-1),2),return20Pct:fix(100*(close/Number(bars.at(-21).close)-1),2),relativeResearchScore:fix(score,1),validHistoricalBars:bars.length,currency:doc.currency||null,identityApproved:false,currentSessionVerified:false,corporateActionsAdjustedVerified:false,recommendation:'HISTORICAL_RESEARCH_ONLY',isExecutable:false});
 }
 rows.sort((a,b)=>b.relativeResearchScore-a.relativeResearchScore||a.ticker.localeCompare(b.ticker));rows.forEach((r,i)=>r.rank=i+1);
 const dates={};for(const r of rows)dates[r.latestBarDate]=(dates[r.latestBarDate]||0)+1;
 const counts={historyFiles:files.length,screened:rows.length,excluded:excluded.length};
 if(counts.screened+counts.excluded!==counts.historyFiles)throw Error('UNIVERSE_RECONCILIATION_FAILED');
 return {schemaVersion:'1.0',generatedAt:new Date().toISOString(),mode:'HISTORICAL_CROSS_SECTION_RESEARCH_ONLY',asOfRequested:asOf,qualifiedTradeCount:0,marketWideCurrentSessionVerified:false,counts,latestBarDateDistribution:dates,source:{type:'REPOSITORY_HISTORY_UNCERTIFIED',identityApproved:false,ohlcvOfficiallyCertified:false,sourceSessionVerified:false},limitations:['Per-ticker historical dates are not proof of current EGX trading-session quotes.','Corporate actions, ISIN identity and full OHLCV are not independently verified.','No buy recommendation, calibrated success probability or broker orders.'],excluded,rows};
}
function write(result,out=path.join(ROOT,'paper-v4/broad-history-research.json')){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');return crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex')}
if(require.main===module){const result=build();const sha256=write(result);console.log(JSON.stringify({counts:result.counts,latestBarDateDistribution:result.latestBarDateDistribution,sha256}))}
module.exports={build,write,good};
