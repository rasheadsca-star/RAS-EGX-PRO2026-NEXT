#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const OUT = 'data/v17/market-session-truth.json';
const SAMPLE_LIMIT = Math.max(3, Math.min(Number(process.env.EGX_V17_SESSION_SAMPLE_LIMIT || 7), 12));
const MIN_PRICE_CONFIRMATIONS = Math.max(2, Number(process.env.EGX_V17_SESSION_MIN_CONFIRMATIONS || 2));
const MIN_RESEARCH_DATE_CONFIRMATIONS = Math.max(10, Number(process.env.EGX_V17_RESEARCH_SESSION_MIN_CONFIRMATIONS || 20));
const MIN_LIVE_PAGE_CONFIRMATIONS = Math.max(2, Number(process.env.EGX_V17_LIVE_SESSION_MIN_CONFIRMATIONS || 3));
const MIN_MARKET_ROWS = Math.max(50, Number(process.env.EGX_V17_LIVE_SESSION_MIN_ROWS || 80));
const MAX_FETCH_AGE_MINUTES = Math.max(5, Number(process.env.EGX_V17_LIVE_SESSION_MAX_FETCH_AGE_MINUTES || 45));
const REGULAR_OPEN_MINUTE = 10 * 60;
const REGULAR_CLOSE_MINUTE = 14 * 60 + 30;

function read(rel, fallback = {}) { try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; } }
function write(rel, value) { const file=P(rel); fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.tmp`; fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,'utf8'); JSON.parse(fs.readFileSync(tmp,'utf8')); fs.renameSync(tmp,file); }
function rowsOf(value){ if(Array.isArray(value))return value; for(const key of ['rows','items','data'])if(Array.isArray(value?.[key]))return value[key]; return []; }
function cairoClock(now=new Date()){ const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,x.value])); return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),minute:Number(parts.minute),minuteOfDay:Number(parts.hour)*60+Number(parts.minute)}; }
function cairoToday(){ return cairoClock().date; }
function inferYear(month,day){ const today=cairoToday(),year=Number(today.slice(0,4)); let candidate=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; const futureDays=(new Date(`${candidate}T12:00:00Z`)-new Date(`${today}T12:00:00Z`))/86400000; if(futureDays>7) candidate=`${year-1}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; return candidate; }
function normalizeDigits(value){ const digits='٠١٢٣٤٥٦٧٨٩'; return String(value??'').replace(/[٠-٩]/g,d=>String(digits.indexOf(d))); }
function isoDate(value){
  const text=normalizeDigits(value).trim();
  const direct=text.match(/\b(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)\b/); if(direct)return `${direct[1]}-${String(Number(direct[2])).padStart(2,'0')}-${String(Number(direct[3])).padStart(2,'0')}`;
  const months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  const arMonths={'يناير':1,'فبراير':2,'مارس':3,'أبريل':4,'ابريل':4,'مايو':5,'يونيو':6,'يوليو':7,'أغسطس':8,'اغسطس':8,'سبتمبر':9,'أكتوبر':10,'اكتوبر':10,'نوفمبر':11,'ديسمبر':12};
  let m=text.match(/\b([0-3]?\d)\s+([A-Za-z]{3,9})\s+(20\d{2})\b/); if(m&&months[m[2].toLowerCase()])return `${m[3]}-${String(months[m[2].toLowerCase()]).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`;
  m=text.match(/\b([A-Za-z]{3,9})\s+([0-3]?\d),?\s+(20\d{2})\b/); if(m&&months[m[1].toLowerCase()])return `${m[3]}-${String(months[m[1].toLowerCase()]).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}`;
  m=text.match(/\b([0-3]?\d)\s+([A-Za-z]{3,9})\b/); if(m&&months[m[2].toLowerCase()])return inferYear(months[m[2].toLowerCase()],Number(m[1]));
  m=text.match(/\b([A-Za-z]{3,9})\s+([0-3]?\d)\b/); if(m&&months[m[1].toLowerCase()])return inferYear(months[m[1].toLowerCase()],Number(m[2]));
  m=text.match(/(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)(?:\s+(20\d{2}))?/i); if(m&&arMonths[m[2]])return m[3]?`${m[3]}-${String(arMonths[m[2]]).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`:inferYear(arMonths[m[2]],Number(m[1]));
  m=text.match(/\b([0-3]?\d)[\/-]([01]?\d)[\/-](20\d{2})\b/); if(m){const a=Number(m[1]),b=Number(m[2]);if(a>12&&b<=12)return `${m[3]}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`;}
  return null;
}
function isRegularTradingWeekday(date){ if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return false; const day=new Date(`${date}T12:00:00Z`).getUTCDay(); return day>=0&&day<=4; }
function plain(html){ return String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim(); }
function extractLastUpdateDate(html){ const text=plain(html); const match=text.match(/Last update:\s*([^\.]{0,220}?market time)/i)||text.match(/Last update:\s*([^|]{0,220})/i)||text.match(/آخر تحديث:\s*(.*?)\s*بتوقيت السوق/i); return match?isoDate(match[1]):null; }
function extractMarketTime(text){
  const s=normalizeDigits(text);
  let m=s.match(/Last update:\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*market time/i)||s.match(/آخر تحديث:\s*(\d{1,2}):(\d{2})\s*(ص|م)\s*بتوقيت السوق/i);
  if(!m)return null;
  let hour=Number(m[1]),minute=Number(m[2]); const marker=String(m[3]).toUpperCase();
  if(marker==='PM'||marker==='م'){if(hour<12)hour+=12;} else if(hour===12)hour=0;
  if(hour>23||minute>59)return null;
  return {text:m[0],hour,minute,minuteOfDay:hour*60+minute};
}
function majority(values){ const counts=new Map(); for(const value of values.filter(Boolean))counts.set(value,(counts.get(value)||0)+1); const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||b[0].localeCompare(a[0])); const [date,count]=ranked[0]||[null,0]; return{date,count,total:values.filter(Boolean).length,counts:Object.fromEntries(ranked)}; }
function majorityFromSummary(rows){
  const normalized=rowsOf(rows).map(row=>({date:isoDate(row?.session||row?.date),count:Number(row?.count||0)})).filter(row=>row.date&&row.count>0);
  normalized.sort((a,b)=>b.count-a.count||b.date.localeCompare(a.date));
  const top=normalized[0]||{date:null,count:0};
  const total=normalized.reduce((sum,row)=>sum+row.count,0);
  return{date:top.date,count:top.count,total,counts:Object.fromEntries(normalized.map(row=>[row.date,row.count]))};
}
function ageMinutes(value,now=new Date()){ const t=Date.parse(String(value||'')); return Number.isFinite(t)?Math.max(0,(now.getTime()-t)/60000):Infinity; }
async function fetchWithTimeout(url,timeoutMs=12000){ const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),timeoutMs); try{ const response=await fetch(url,{signal:ctrl.signal,redirect:'follow',headers:{accept:'text/html,*/*','accept-language':'en-US,en;q=0.9,ar;q=0.7','cache-control':'no-cache','user-agent':'Mozilla/5.0 EGX-Pro-V17-Session-Truth/1.4'}}); if(!response.ok)throw new Error(`HTTP_${response.status}`); return await response.text(); }finally{clearTimeout(timer);} }
async function verifyPricePages(marketRows){
  const urls=[...new Set(marketRows.map(row=>row?.sourceUrl).filter(url=>/^https?:\/\//.test(String(url||''))))].slice(0,SAMPLE_LIMIT),results=[];
  for(const url of urls){
    try{
      const html=await fetchWithTimeout(url),text=plain(html),date=extractLastUpdateDate(html),marketTime=extractMarketTime(text),duringMarketSessionDisclaimer=/15\s*minutes?\s+(?:late|delayed)\s+during\s+market\s+session/i.test(text);
      results.push({url,ok:Boolean(date||marketTime),sourceSessionDate:date,marketTime:marketTime?.text||null,marketMinuteOfDay:marketTime?.minuteOfDay??null,duringMarketSessionDisclaimer,reason:date?'EXPLICIT_DATE_PARSED':marketTime?'MARKET_TIME_PARSED':'LAST_UPDATE_NOT_PARSED'});
    }catch(error){results.push({url,ok:false,sourceSessionDate:null,marketTime:null,duringMarketSessionDisclaimer:false,reason:String(error?.name||error?.message||error).slice(0,100)});}
  }
  return results;
}
function mutateSession(rel,sessionDate,evidence){ const value=read(rel,null); if(!value||typeof value!=='object')return false; value.sessionDate=sessionDate; value.lastSession=sessionDate; value.sourceSessionDate=sessionDate; value.sessionTruth=evidence; write(rel,value); return true; }

(async()=>{
  const now=new Date(),clock=cairoClock(now),market=read('data/market.json',{rows:[]}),marketRows=rowsOf(market),fetchReport=read('data/source-fetch-report.json',{}),direct=read('data/mubasher-support-resistance-direct.json',{rows:[]}),enrichment=read('data/stable/v16-mubasher-session-evidence-enrichment.json',{});
  const nativeDates=marketRows.map(row=>isoDate(row?.sourceSessionDate||row?.sessionDate||row?.tradingDate||row?.sourceMarketTime)).filter(Boolean),pageSamples=await verifyPricePages(marketRows),pageDates=pageSamples.map(row=>row.sourceSessionDate).filter(Boolean),directDates=rowsOf(direct).map(row=>isoDate(row?.sourceSessionDate||row?.sessionDate||row?.date||row?.updatedAtText)).filter(Boolean);
  const nativeMajority=majority(nativeDates),pageMajority=majority(pageDates),directMajority=majority(directDates),priceEvidenceMajority=pageMajority.date?pageMajority:nativeMajority,explicitCompletedMajority=majorityFromSummary(enrichment.byExplicitSourceSession||[]);
  const verifiedSessionDate=priceEvidenceMajority.date||null;
  const priceSourceVerified=Boolean(verifiedSessionDate&&priceEvidenceMajority.count>=MIN_PRICE_CONFIRMATIONS&&priceEvidenceMajority.count/Math.max(1,priceEvidenceMajority.total)>=0.6);
  const verifiedCalendarValid=isRegularTradingWeekday(verifiedSessionDate);
  const executionSafe=Boolean(priceSourceVerified&&verifiedCalendarValid&&verifiedSessionDate===clock.date);

  const inRegularSession=Boolean(isRegularTradingWeekday(clock.date)&&clock.minuteOfDay>=REGULAR_OPEN_MINUTE&&clock.minuteOfDay<=REGULAR_CLOSE_MINUTE);
  const marketFetchAgeMinutes=ageMinutes(market.generatedAt||market.updatedAt,now);
  const freshCollectorRun=Boolean(fetchReport.realFetch===true&&marketRows.length>=MIN_MARKET_ROWS&&marketFetchAgeMinutes<=MAX_FETCH_AGE_MINUTES);
  const livePageRows=pageSamples.filter(row=>row.marketTime&&row.duringMarketSessionDisclaimer);
  const livePageRatio=pageSamples.length?livePageRows.length/pageSamples.length:0;
  const volumeMismatchCount=Number(enrichment?.statusCounts?.VOLUME_MISMATCH||0);
  const previousCompletedDate=explicitCompletedMajority.date&&explicitCompletedMajority.date<clock.date&&isRegularTradingWeekday(explicitCompletedMajority.date)?explicitCompletedMajority.date:null;
  const liveIntradayResearchVerified=Boolean(
    inRegularSession&&freshCollectorRun&&
    livePageRows.length>=MIN_LIVE_PAGE_CONFIRMATIONS&&livePageRatio>=0.6&&
    previousCompletedDate&&explicitCompletedMajority.count>=MIN_RESEARCH_DATE_CONFIRMATIONS&&
    volumeMismatchCount>=MIN_RESEARCH_DATE_CONFIRMATIONS
  );
  const completedResearchSession=Boolean(explicitCompletedMajority.date&&explicitCompletedMajority.count>=MIN_RESEARCH_DATE_CONFIRMATIONS&&explicitCompletedMajority.count/Math.max(1,explicitCompletedMajority.total)>=0.6&&isRegularTradingWeekday(explicitCompletedMajority.date))?explicitCompletedMajority.date:null;
  const researchSessionDate=liveIntradayResearchVerified?clock.date:completedResearchSession;
  const researchSessionVerified=Boolean(liveIntradayResearchVerified||completedResearchSession);
  const selectedSessionDate=executionSafe?verifiedSessionDate:(researchSessionDate||verifiedSessionDate||null);
  const calendarValid=isRegularTradingWeekday(selectedSessionDate);
  const directConflict=Boolean(directMajority.date&&selectedSessionDate&&directMajority.date!==selectedSessionDate);
  const selectionMode=executionSafe?'EXECUTION_VERIFIED_PRICE_SESSION':liveIntradayResearchVerified?'LIVE_INTRADAY_RESEARCH_SESSION':completedResearchSession?'COMPLETED_EXPLICIT_DATE_RESEARCH_SESSION':'UNVERIFIED_PRICE_SESSION_FALLBACK';
  const evidence={
    engine:'V17_PRICE_SOURCE_SESSION_TRUTH',verifiedAt:new Date().toISOString(),selectedSessionDate,verifiedSessionDate,researchSessionDate,researchSessionVerified,selectionMode,priceSourceVerified,calendarValid,verifiedCalendarValid,directValidationConflict:directConflict,executionSafe,
    priceEvidence:{source:pageMajority.date?'LIVE_PRICE_PAGE_EXPLICIT_DATE':nativeMajority.date?'NATIVE_MARKET_ROW_SESSION':'LIVE_PRICE_PAGE_MARKET_CLOCK',majority:priceEvidenceMajority,minimumConfirmations:MIN_PRICE_CONFIRMATIONS,samples:pageSamples},
    liveIntradayResearchEvidence:{eligible:liveIntradayResearchVerified,cairoDate:clock.date,cairoMinuteOfDay:clock.minuteOfDay,regularSessionWindow:{open:'10:00',close:'14:30',timeZone:'Africa/Cairo'},inRegularSession,freshCollectorRun,marketFetchAgeMinutes:Number.isFinite(marketFetchAgeMinutes)?Number(marketFetchAgeMinutes.toFixed(2)):null,marketRows:marketRows.length,minimumMarketRows:MIN_MARKET_ROWS,livePageConfirmations:livePageRows.length,totalPageSamples:pageSamples.length,livePageRatio:Number(livePageRatio.toFixed(3)),minimumLivePageConfirmations:MIN_LIVE_PAGE_CONFIRMATIONS,previousCompletedDate,completedDateConfirmations:explicitCompletedMajority.count,volumeMismatchCount,rule:'CURRENT_CAIRO_TRADING_DAY + FRESH_REAL_FETCH + MULTI_PAGE_MARKET_CLOCK + PRIOR_COMPLETED_DATE + CURRENT_VOLUME_DIVERGENCE'},
    completedSessionEvidence:{source:'MUBASHER_VOLUME_STATISTICS_EXPLICIT_DATE',majority:explicitCompletedMajority,latestCompletedSourceSession:completedResearchSession,volumeMatchRequiredForExecutionVerification:true},
    directValidation:{role:'VALIDATION_ONLY_NOT_HARD_DEPENDENCY',majority:directMajority,sessionConflict:directConflict,conflictBlocksPriceSessionTruth:false},
    policy:{workflowRunDateAloneIsNeverTradingSessionEvidence:true,liveIntradayResearchRequiresCurrentTradingWindowAndFreshSourceEvidence:true,liveIntradayResearchNeverQualifiesExecution:true,fridaySaturdayNeverAcceptedAsRegularTradingSession:true,executionRequiresVerifiedPriceSourceSession:true,volumeMismatchNeverQualifiesExecutionVerification:true,completedVolumeStatisticsMayDefinePriorCompletedResearchSession:true,directMubasherSrDoesNotDefinePriceTruth:true,externalValidationMismatchDoesNotInvalidatePriceSessionTruth:true}
  };
  if(executionSafe){
    mutateSession('data/market.json',verifiedSessionDate,evidence);mutateSession('data/source-health.json',verifiedSessionDate,evidence);mutateSession('data/fetch-status.json',verifiedSessionDate,evidence);if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,`EGX_SESSION_DATE=${verifiedSessionDate}\n`,'utf8');
  }else{
    evidence.researchOnly=researchSessionVerified;
    evidence.blockingReason=researchSessionVerified?'EXECUTION_SOURCE_SESSION_NOT_VERIFIED':!verifiedSessionDate?'PRICE_SOURCE_SESSION_UNAVAILABLE':!priceSourceVerified?'PRICE_SOURCE_SESSION_NOT_SUFFICIENTLY_VERIFIED':'SOURCE_DATE_IS_NOT_REGULAR_EGX_TRADING_WEEKDAY';
  }
  write(OUT,evidence);
  console.log(JSON.stringify({selectedSessionDate,verifiedSessionDate,researchSessionDate,researchSessionVerified,selectionMode,pageMajority,directMajority,explicitCompletedMajority,liveIntradayResearchVerified,livePageConfirmations:livePageRows.length,volumeMismatchCount,marketFetchAgeMinutes,priceSourceVerified,calendarValid,directConflict,executionSafe},null,2));
})().catch(error=>{write(OUT,{engine:'V17_PRICE_SOURCE_SESSION_TRUTH',verifiedAt:new Date().toISOString(),selectedSessionDate:null,verifiedSessionDate:null,researchSessionDate:null,researchSessionVerified:false,priceSourceVerified:false,executionSafe:false,blockingReason:'SESSION_TRUTH_EXCEPTION',error:String(error?.stack||error?.message||error)});console.error(error);process.exitCode=1;});
