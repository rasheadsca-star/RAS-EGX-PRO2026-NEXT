#!/usr/bin/env node
/* Daily RESEARCH-ONLY ranking from existing repo market/history.
 * Never turns secondary-market bars into certified official bars or buy orders.
 * Missing/stale source => explicit no-current-ranking status.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'paper-v4/latest-ranking.json');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const cairo=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const tradingDay=s=>{const day=new Date(s+'T12:00:00Z').getUTCDay();return day!==5&&day!==6};
const quality=r=>r&&Number.isFinite(+r.open)&&Number.isFinite(+r.high)&&Number.isFinite(+r.low)&&Number.isFinite(+r.close)&&Number.isFinite(+r.volume)&&r.low>0&&r.high>=Math.max(r.open,r.close)&&r.low<=Math.min(r.open,r.close)&&r.volume>=0;
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const round=(x,n=2)=>Number(x.toFixed(n));
function build(){
 const today=process.env.EGX_SESSION||cairo();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!tradingDay(today))throw Error('invalid or non-trading EGX session');
 const feed=read('data/market.json');
 const source=Array.isArray(feed.rows)?feed.rows:[];
 const snapshotRows=source.filter(r=>r.sourceSessionDate===today&&quality(r));
 const historyDir=path.join(ROOT,'data/history');
 const market=new Map(snapshotRows.map(r=>[String(r.symbol||'').toUpperCase(),r]));
 const candidates=[],excluded=[];
 const officialBaseline=read('paper-v4/preliminary-ranking-2026-11-03.json');
 const officialByTicker=new Map(officialBaseline.rows.map(r=>[r.ticker,r.close]));
 for(const file of fs.readdirSync(historyDir)){
  if(!/^[A-Z0-9_-]+\.json$/.test(file))continue;
  const ticker=path.basename(file,'.json'),m=market.get(ticker);
  if(!m)continue;
  let h;try{h=JSON.parse(fs.readFileSync(path.join(historyDir,file),'utf8'))}catch{continue}
  const bars=(h.sessions||[]).filter(quality).sort((a,b)=>a.date.localeCompare(b.date));
  const previous=bars.filter(x=>x.date<today);
  if(previous.length<60){excluded.push({ticker,reason:'INSUFFICIENT_HISTORY'});continue}
  if(h.isin==null){/* identity still unapproved; still research */}
  const close=Number(m.price||m.last), open=+m.open,high=+m.high,low=+m.low,volume=+m.volume;
  if(!Number.isFinite(close)||close<=0){excluded.push({ticker,reason:'BAD_PRICE'});continue}
  if(Math.abs(close-(+m.close||close))>0.01){excluded.push({ticker,reason:'CLOSE_CONFLICT'});continue}
  // Identify direct official-report conflicts when a known official baseline exists.
  if(today===officialBaseline.session&&officialByTicker.has(ticker)&&Math.abs(close-officialByTicker.get(ticker))>Math.max(.01,.001*close)){
   excluded.push({ticker,reason:'OFFICIAL_SECONDARY_CLOSE_CONFLICT'});continue
  }
  const recent=previous.slice(-20),sma20=mean(recent.map(x=>+x.close)),avgVol=mean(recent.map(x=>+x.volume));
  const resistance=Math.max(...recent.map(x=>+x.high)),support=Math.min(...recent.map(x=>+x.low));
  if(!Number.isFinite(resistance)||resistance<=0||avgVol<=0)continue;
  const volumeRatio=volume/avgVol,dist=resistance/close-1;
  const trend20=close>sma20;
  const tech=Math.max(0,Math.min(100,(close/sma20-1)*300+50));
  const score=round(35*Math.max(0,Math.min(1,1-dist/.2))+25*Math.min(volumeRatio/1.5,1)+25*tech/100+15*Number(trend20),1);
  const nearBreakout=dist>=-.01&&dist<=.06;
  const status=nearBreakout&&volumeRatio>=1.2&&trend20?'CONDITIONAL_BREAKOUT_WATCH':'RESEARCH_WATCH';
  candidates.push({ticker,close:round(close,3),changePct:round(+m.changePct||0),volumeRatio20:round(volumeRatio,2),resistance20:round(resistance,3),support20:round(support,3),indicativeTrigger:round(resistance*1.002,3),relativeResearchScore:score,abovePriorSMA20:trend20,note: status==='CONDITIONAL_BREAKOUT_WATCH'?'قريب من الاختراق مع حجم نسبي داعم؛ إشارة مراقبة وليست أمر شراء':volumeRatio<.8?'السيولة دون المتوسط، يلزم تأكيد':'قيد المراقبة إلى حين تأكيد الاتجاه والاختراق',recommendation:'WATCH_ONLY',technicalSession:previous.at(-1).date,sourceSession:today,priceSource:'SECONDARY_PUBLIC',identityApproved:false,officialCloseVerified:false,decisionStatus:status});
 }
 candidates.sort((a,b)=>b.relativeResearchScore-a.relativeResearchScore);
 const top=candidates.slice(0,25).map((x,i)=>({...x,rank:i+1}));
 const officialAvailable=false; // No durable, verified PDF/ISIN crosswalk connected to this scheduled process.
 return {
 schemaVersion:'2.0',generatedAt:new Date().toISOString(),session:today,mode:'AUTOMATED_SECONDARY_RESEARCH_WATCH',sampleUniverse:top.length,qualifiedTradeCount:0,
 source:{provider:feed.source||'secondary',marketRows:source.length,sessionMatchedRows:snapshotRows.length,historyFilesExamined:fs.readdirSync(historyDir).filter(x=>x.endsWith('.json')).length,officialSessionVerified:officialAvailable,isinIndependentlyCertified:false},
 comparisonModel:{strategy:'breakout_research_proximity_volume_trend',status:'RESEARCH_ONLY'},
 rankingFormula:'35% resistance proximity +25% volume ratio +25% relative SMA20 trend +15% above SMA20; not a calibrated win probability',
 exclusions:{count:excluded.length,samples:excluded.slice(0,30)},
 limitations:['Generated only from same-date secondary rows; not equivalent to official EGX EOD certification.','No broker orders, no investment-grade targets/stops, no ISIN certification.','Conflict with preserved user-provided official reference triggers exclusion.','Stale or missing data must produce empty current ranking, never reuse previous ranking.'],
 rows:top};
}
const output=build();
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({session:output.session,ranked:output.rows.length,marketRows:output.source.sessionMatchedRows,excluded:output.exclusions.count,sha256:crypto.createHash('sha256').update(fs.readFileSync(OUT)).digest('hex')}));
if(output.rows.length===0)process.exitCode=2;
