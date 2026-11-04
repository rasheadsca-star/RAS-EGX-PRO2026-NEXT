#!/usr/bin/env node
'use strict';
// Fallback research watchlist derived from user-supplied official dated closing prices.
// No synthetic open/high/low for today, no identity approval, never execute trades.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const today=process.env.EGX_SESSION||new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const official=read('paper-v4/official-session-latest.json');
if(official.session!==today||!official.documentSha256||official.quotes?.length<10)throw Error('No same-session official closing evidence');
const valid=x=>x&&+x.low>0&&+x.high>=Math.max(+x.open,+x.close)&&+x.low<=Math.min(+x.open,+x.close)&&+x.volume>=0;
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const rnd=(x,n=3)=>Number(x.toFixed(n)),tick=v=>v<2?.001:.01;
const up=v=>rnd(Math.ceil((v-1e-9)/tick(v))*tick(v),3),down=v=>rnd(Math.floor((v+1e-9)/tick(v))*tick(v),3);
let rejected=[],candidates=[];
for(const quote of official.quotes){
 const ticker=quote.ticker;
 // Hard stop on cross-asset joins: never use MMAT (Marsa Marsa Alam) for MM Group (MTIE).
 if(/MM Group for Industry/i.test(String(quote.company||''))&&ticker!=='MTIE')throw Error('INSTRUMENT_IDENTITY_CONFLICT: MM Group must map to MTIE, never '+ticker);
 if(ticker==='MMAT'&&/MM Group/i.test(String(quote.company||'')))throw Error('FORBIDDEN_MM_GROUP_MMAt_JOIN');const file=path.join(root,'data/history',ticker+'.json');
 if(quote.currency!=='EGP'||!(Number(quote.close)>0)||!(Number(quote.volume)>0)){rejected.push({ticker,reason:'MISSING_OFFICIAL_CLOSE_VOLUME_EGP'});continue}
 if(!fs.existsSync(file)){rejected.push({ticker,reason:'NO_PRIOR_HISTORY'});continue}
 const history=JSON.parse(fs.readFileSync(file,'utf8'));
 const bars=(history.sessions||[]).filter(x=>x.date<today&&valid(x)).sort((a,b)=>a.date.localeCompare(b.date));
 if(bars.length<60){rejected.push({ticker,reason:'SHORT_PRIOR_HISTORY'});continue}
 const latest=bars.at(-1);const gapDays=(Date.parse(today+'T12:00:00Z')-Date.parse(latest.date+'T12:00:00Z'))/86400000;
 if(!(gapDays>=1&&gapDays<=7)){rejected.push({ticker,reason:'STALE_TECHNICAL_HISTORY',last:latest.date});continue}
 const close=Number(quote.close),volume=Number(quote.volume),prev20=bars.slice(-20),prev15=bars.slice(-15);
 const sma20=mean(prev20.map(b=>+b.close)),avgVol=mean(prev20.map(b=>+b.volume));
 if(!(avgVol>0&&sma20>0))continue;
 const high20=Math.max(...prev20.map(b=>+b.high)),low20=Math.min(...prev20.map(b=>+b.low)),support10=Math.min(...bars.slice(-10).map(b=>+b.low));
 const tr=prev15.map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-(i?prev15[i-1].close:bars.at(-16).close)),Math.abs(b.low-(i?prev15[i-1].close:bars.at(-16).close))));
 const atr=mean(tr.slice(-14)),volumeRatio=volume/avgVol,trend=close>sma20,prox=high20/close-1;
 const tech=Math.max(0,Math.min(100,(close/sma20-1)*300+50));
 const score=rnd(35*Math.max(0,Math.min(1,1-prox/.2))+25*Math.min(volumeRatio/1.5,1)+25*tech/100+15*Number(trend),1);
 function plan(strategy,rawEntry,rawStop){
  if(!(rawEntry>rawStop&&rawStop>0))return null;
  const entry=up(rawEntry),stop=down(rawStop),risk=entry-stop,riskPct=100*risk/entry;
  if(!(risk>0))return null;
  if(entry>down(Number(latest.close)*1.2)||entry<up(Number(latest.close)*.8))return {strategy,status:'REJECTED_DAILY_LIMIT',reason:'المدخل البحثي يتجاوز الحد النظري مقارنة بآخر إغلاق تاريخي مخزن',isExecutable:false};
  if(riskPct>12||riskPct<.35)return {strategy,status:'REJECTED_RISK',reason:'نسبة مخاطرة السيناريو لا تستوفي نطاق .35%–12%',riskPct:rnd(riskPct,2),isExecutable:false};
  const target1=down(entry+1.5*risk),target2=down(entry+2.5*risk);
  const rr1=(target1-entry)/risk,rr2=(target2-entry)/risk;
  if(!(stop<entry&&entry<target1&&target1<target2&&rr1>=1.45&&rr2>=2.45))return {strategy,status:'REJECTED_REWARD_RISK',reason:'فشل نسبة العائد للمخاطرة بعد تقريب السعر',isExecutable:false};
  return {strategy,status:'WAIT_CONFIRMATION',reason:strategy==='BREAKOUT'?'مراقبة اختراق قمة 20 جلسة؛ غياب OHLC موثوق لليوم يمنع تأكيد شمعة الاختراق':'مراقبة ارتداد دعم 10 جلسات؛ لا يُعتمد دون شمعة تأكيد موثوقة',
   entry,stop,target1,target2,riskPct:rnd(riskPct,2),rewardRisk1:rnd(rr1),rewardRisk2:rnd(rr2),
   currency:'EGP',isExecutable:false,priceBasis:'OFFICIAL_EGX_CLOSE_WITH_UNCERTIFIED_HISTORICAL_OHLC',
   executionGuards:{tickSizeConfirmed:false,instrumentPriceLimitConfirmed:false,feesAndSlippageConfirmed:false,isinConfirmed:false},
   trigger:strategy==='BREAKOUT'?'إغلاق لاحق فوق المقاومة وحجم تداول داعم مع تأكيد البيانات':'شمعة ارتداد لاحقة فوق الدعم مع تأكيد السيولة'};
 }
 const breakoutEntry=high20*1.002,breakoutStop=Math.max(support10,breakoutEntry-1.5*atr);
 const bounceEntry=Math.max(support10*1.01,close*.995),bounceStop=Math.min(support10*.992,bounceEntry-1.2*atr);
 const scenarios=[plan('BREAKOUT',breakoutEntry,breakoutStop),plan('SUPPORT_BOUNCE',bounceEntry,bounceStop)].filter(Boolean);
 if(!scenarios.length){rejected.push({ticker,reason:'NO_SCENARIO'});continue}
 candidates.push({ticker,company:quote.company,rank:0,close:rnd(close),changePct:Number(quote.changePct)||0,volumeRatio20:rnd(volumeRatio,2),resistance20:rnd(high20),support20:rnd(low20),support10:rnd(support10),indicativeTrigger:up(high20*1.002),atr14:rnd(atr),relativeResearchScore:score,
  abovePriorSMA20:trend,technicalSession:latest.date,sourceSession:today,priceSource:'OFFICIAL_REPORT_CLOSE_RESEARCH_ONLY',officialCloseVerified:false,
  closeFromDatedOfficialPdf:true,closeOnlySession:true,officialQuoteOhlcStatus:quote.ohlcStatus,identityApproved:false,
  recommendation:'WATCH_ONLY',decisionStatus:'RESEARCH_WATCH',note:'إغلاق 4 نوفمبر من التقرير الرسمي؛ OHLC اليوم غير مستخدم؛ مستويات المراقبة محسوبة من تاريخ سابق غير معتمد بالكامل',scenarios,preferredScenario:scenarios.find(x=>x.status==='WAIT_CONFIRMATION')?.strategy||null});
}
candidates.sort((a,b)=>b.relativeResearchScore-a.relativeResearchScore);
const rows=candidates.slice(0,25).map((r,i)=>({...r,rank:i+1}));
const result={schemaVersion:'2.4',generatedAt:new Date().toISOString(),session:today,mode:'OFFICIAL_CLOSE_SECONDARY_HISTORY_RESEARCH_WATCH',sampleUniverse:rows.length,qualifiedTradeCount:0,
 source:{provider:'USER_PROVIDED_EGX_DAILY_REPORT_CLOSE_AND_UNCERTIFIED_HISTORY',marketRows:official.quotes.length,sessionMatchedRows:official.quotes.length,historyFilesExamined:fs.readdirSync(path.join(root,'data/history')).filter(x=>x.endsWith('.json')).length,officialSessionVerified:false,officialCloseEvidencePresent:true,isinIndependentlyCertified:false,documentSha256:official.documentSha256},
 comparisonModel:{strategy:'breakout_research_proximity_volume_trend',status:'RESEARCH_ONLY'},rankingFormula:'35% resistance proximity +25% volume ratio +25% relative SMA20 trend +15% above SMA20; no calibrated success probability',
 exclusions:{count:rejected.length,samples:rejected},limitations:['Only the 16 curated mapped closing quotes from official PDF, NOT all listed companies.','Identity crosswalk is provisional; neither historical OHLC nor same-session open/high/low is certified.','Risk levels are provisional and no entry is executable or confirmed.','Share corporate actions may make prior levels unadjusted.'],
 rows};
fs.writeFileSync(path.join(root,'paper-v4/latest-ranking.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({session:today,rows:rows.length,excluded:rejected,officialCloses:official.quotes.length}));
if(!rows.length)process.exitCode=2;
