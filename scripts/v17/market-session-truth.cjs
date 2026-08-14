#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const OUT = 'data/v17/market-session-truth.json';
const SAMPLE_LIMIT = Math.max(3, Math.min(Number(process.env.EGX_V17_SESSION_SAMPLE_LIMIT || 7), 12));
const MIN_PRICE_CONFIRMATIONS = Math.max(2, Number(process.env.EGX_V17_SESSION_MIN_CONFIRMATIONS || 2));

function read(rel, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function write(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function rowsOf(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['rows', 'items', 'data']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}
function isoDate(value) {
  const text = String(value || '').trim();
  const direct = text.match(/\b(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)\b/);
  if (direct) return `${direct[1]}-${String(Number(direct[2])).padStart(2, '0')}-${String(Number(direct[3])).padStart(2, '0')}`;
  const months = {
    jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,
    aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12,
  };
  let m=text.match(/\b([0-3]?\d)\s+([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if(m&&months[m[2].toLowerCase()]) return `${m[3]}-${String(months[m[2].toLowerCase()]).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`;
  m=text.match(/\b([A-Za-z]{3,9})\s+([0-3]?\d),?\s+(20\d{2})\b/);
  if(m&&months[m[1].toLowerCase()]) return `${m[3]}-${String(months[m[1].toLowerCase()]).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}`;
  m=text.match(/\b([0-3]?\d)[\/-]([01]?\d)[\/-](20\d{2})\b/);
  if(m){const a=Number(m[1]),b=Number(m[2]);if(a>12&&b<=12)return `${m[3]}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`;}
  return null;
}
function isRegularTradingWeekday(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return false;const day=new Date(`${date}T12:00:00Z`).getUTCDay();return day>=0&&day<=4;}
function plain(html){return String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();}
function extractLastUpdateDate(html){const text=plain(html);const match=text.match(/Last update:\s*([^\.]{0,220}?market time)/i)||text.match(/Last update:\s*([^|]{0,220})/i);return match?isoDate(match[1]):null;}
function majority(values){const counts=new Map();for(const value of values.filter(Boolean))counts.set(value,(counts.get(value)||0)+1);const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const [date,count]=ranked[0]||[null,0];return{date,count,total:values.filter(Boolean).length,counts:Object.fromEntries(ranked)};}
async function fetchWithTimeout(url,timeoutMs=12000){const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeoutMs);try{const response=await fetch(url,{signal:ctrl.signal,redirect:'follow',headers:{accept:'text/html,*/*','accept-language':'en-US,en;q=0.9','cache-control':'no-cache','user-agent':'Mozilla/5.0 EGX-Pro-V17-Session-Truth/1.1'}});if(!response.ok)throw new Error(`HTTP_${response.status}`);return await response.text();}finally{clearTimeout(timer);}}
async function verifyPricePages(marketRows){const urls=[...new Set(marketRows.map(row=>row?.sourceUrl).filter(url=>/^https?:\/\//.test(String(url||''))))].slice(0,SAMPLE_LIMIT);const results=[];for(const url of urls){try{const html=await fetchWithTimeout(url);const date=extractLastUpdateDate(html);results.push({url,ok:Boolean(date),sourceSessionDate:date,reason:date?'LAST_UPDATE_PARSED':'LAST_UPDATE_DATE_NOT_PARSED'});}catch(error){results.push({url,ok:false,sourceSessionDate:null,reason:String(error?.name||error?.message||error).slice(0,100)});}}return results;}
function mutateSession(rel,sessionDate,evidence){const value=read(rel,null);if(!value||typeof value!=='object')return false;value.sessionDate=sessionDate;value.lastSession=sessionDate;value.sourceSessionDate=sessionDate;value.sessionTruth=evidence;write(rel,value);return true;}

(async()=>{
  const market=read('data/market.json',{rows:[]});
  const marketRows=rowsOf(market);
  const direct=read('data/mubasher-support-resistance-direct.json',{rows:[]});
  const nativeDates=marketRows.map(row=>isoDate(row?.sourceSessionDate||row?.sessionDate||row?.tradingDate)).filter(Boolean);
  const pageSamples=await verifyPricePages(marketRows);
  const pageDates=pageSamples.map(row=>row.sourceSessionDate).filter(Boolean);
  const directDates=rowsOf(direct).map(row=>isoDate(row?.sourceSessionDate||row?.sessionDate||row?.date)).filter(Boolean);
  const nativeMajority=majority(nativeDates),pageMajority=majority(pageDates),directMajority=majority(directDates);
  const priceEvidenceMajority=pageMajority.date?pageMajority:nativeMajority;
  const selectedSessionDate=priceEvidenceMajority.date||null;
  const priceSourceVerified=Boolean(selectedSessionDate&&priceEvidenceMajority.count>=MIN_PRICE_CONFIRMATIONS&&priceEvidenceMajority.count/Math.max(1,priceEvidenceMajority.total)>=0.6);
  const calendarValid=isRegularTradingWeekday(selectedSessionDate);
  const directConflict=Boolean(directMajority.date&&selectedSessionDate&&directMajority.date!==selectedSessionDate);
  // Validation/comparison sources must never define price-session truth. A mismatch
  // is retained as a warning/conflict signal for downstream governance, not as a hard dependency.
  const executionSafe=Boolean(priceSourceVerified&&calendarValid);
  const evidence={
    engine:'V17_PRICE_SOURCE_SESSION_TRUTH',verifiedAt:new Date().toISOString(),selectedSessionDate,priceSourceVerified,calendarValid,directValidationConflict:directConflict,executionSafe,
    priceEvidence:{source:pageMajority.date?'LIVE_PRICE_PAGE_LAST_UPDATE':nativeMajority.date?'NATIVE_MARKET_ROW_SESSION':'UNAVAILABLE',majority:priceEvidenceMajority,minimumConfirmations:MIN_PRICE_CONFIRMATIONS,samples:pageSamples},
    directValidation:{role:'VALIDATION_ONLY_NOT_HARD_DEPENDENCY',majority:directMajority,sessionConflict:directConflict,conflictBlocksPriceSessionTruth:false},
    policy:{workflowRunDateIsNeverTradingSessionEvidence:true,fridaySaturdayNeverAcceptedAsRegularTradingSession:true,executionRequiresVerifiedPriceSourceSession:true,directMubasherSrDoesNotDefinePriceTruth:true,externalValidationMismatchDoesNotInvalidatePriceSessionTruth:true},
  };
  if(executionSafe){mutateSession('data/market.json',selectedSessionDate,evidence);mutateSession('data/source-health.json',selectedSessionDate,evidence);mutateSession('data/fetch-status.json',selectedSessionDate,evidence);if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,`EGX_SESSION_DATE=${selectedSessionDate}\n`,'utf8');}
  else evidence.blockingReason=!selectedSessionDate?'PRICE_SOURCE_SESSION_UNAVAILABLE':!priceSourceVerified?'PRICE_SOURCE_SESSION_NOT_SUFFICIENTLY_VERIFIED':'SOURCE_DATE_IS_NOT_REGULAR_EGX_TRADING_WEEKDAY';
  write(OUT,evidence);
  console.log(JSON.stringify({selectedSessionDate,pageMajority,directMajority,priceSourceVerified,calendarValid,directConflict,executionSafe},null,2));
})().catch(error=>{write(OUT,{engine:'V17_PRICE_SOURCE_SESSION_TRUTH',verifiedAt:new Date().toISOString(),selectedSessionDate:null,priceSourceVerified:false,executionSafe:false,blockingReason:'SESSION_TRUTH_EXCEPTION',error:String(error?.stack||error?.message||error)});console.error(error);});
