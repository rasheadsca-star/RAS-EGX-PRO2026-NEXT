#!/usr/bin/env node
'use strict';
// DirectFN public website independent date-specific research probe.
// Page data is for discovery only; no automatic promotion, no source timestamp inference.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {focusFromPersistent}=require('./egx-recovery-focus.cjs');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.resolve(process.env.EGX_RECOVERY_OUT||path.join(ROOT,'artifacts/history-recovery'));
const URL='https://www.directfn.com.eg/tradingData.aspx';
const strip=s=>String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
 .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')
 .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
function dateFromHeader(html){
 const text=strip(html).slice(0,2500);
 const m=text.match(/\b([0-3]?\d)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d\d)\b/i);
 if(!m)return null;
 const n=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase().slice(0,3))+1;
 return n?m[3]+'-'+String(n).padStart(2,'0')+'-'+String(Number(m[1])).padStart(2,'0'):null;
}
function parse(html,expected){
 const headerDate=dateFromHeader(html),header=strip(html).slice(0,1000),marketClosed=/\b(?:EGX\s+)?Closed\b/i.test(header),attempt=[];
 const trs=String(html).match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
 for(const tr of trs){
  const cells=(tr.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi)||[]).map(strip);
  if(cells.length<9)continue;
  const sym=/^[A-Z0-9]{2,7}$/.test(cells[1]||'')?1:cells.findIndex(c=>/^[A-Z0-9]{2,7}$/.test(c));
  // DirectFN published table: Company, Symbol, Open, Last, High, Low, Change, Change %, Volume, Turnover
  if(sym<0||sym+7>=cells.length)continue;
  const ticker=cells[sym];const vals=cells.slice(sym+1,sym+8).map(s=>Number(s.replace(/,/g,'').replace('%','')));
  const [open,close,high,low,change,changePct,volume]=vals;
  if(![open,close,high,low,volume].every(Number.isFinite))continue;
  const validOHLC=open>0&&close>0&&high>=Math.max(open,close)&&low<=Math.min(open,close)
     &&Number.isInteger(volume)&&volume>=0;
  attempt.push({ticker,open,high,low,close,volume,change,changePct,
    sourceDate:headerDate,expectedSession:expected,
    status:headerDate!==expected?'STALE_OR_WRONG_SESSION':!marketClosed?'UNFINALIZED_SOURCE_STATUS':validOHLC?'RESEARCH_VALID_CANDLE':'INVALID_OHLCV',
    source:URL,promotionApproved:false});
 }
 const found=new Map();for(const row of attempt)if(!found.has(row.ticker))found.set(row.ticker,row);
 return {sourceDate:headerDate,expectedSession:expected,sourceMarketClosed:marketClosed,exactSession:headerDate===expected&&marketClosed,
  parsedRows:attempt.length,validExactSession:[...found.values()].filter(x=>x.status==='RESEARCH_VALID_CANDLE').length,
  rows:[...found.values()]};
}
async function run(){
 const expected=JSON.parse(fs.readFileSync(path.join(ROOT,'data/stable/v15-price-truth.json'),'utf8')).expectedSession;
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);
 let result;
 try{
  const res=await fetch(URL,{signal:ctl.signal,headers:{'Accept':'text/html','User-Agent':'EGX-PRO-Research-Data-Integrity/1.0'}});
  if(!res.ok)throw Error('HTTP '+res.status);
  const body=await res.text();
  if(body.length>1500000)throw Error('Unusually large response');
  const parsed=parse(body,expected),hash=crypto.createHash('sha256').update(body).digest('hex');
  const latestTruth=JSON.parse(fs.readFileSync(path.join(ROOT,'data/stable/v15-price-truth.json'),'utf8'));
  const hist=JSON.parse(fs.readFileSync(path.join(ROOT,'data/history-summary.json'),'utf8'));
  const symbols=JSON.parse(fs.readFileSync(path.join(ROOT,'data/symbol-map.json'),'utf8'));
  const focus=new Set(focusFromPersistent({truth:latestTruth,historySummary:hist,symbolMap:symbols,expectedSession:expected}).map(x=>x.ticker));
  result={schemaVersion:'egx-directfn-exact-session-research-1',checkedAt:new Date().toISOString(),
   source:URL,httpStatus:res.status,finalUrl:res.url,sha256:hash,bodyBytes:body.length,
   ...parsed,focus:parsed.rows.filter(x=>focus.has(x.ticker)),
   noAutoPromotion:true,authority:'THIRD_PARTY_PUBLIC_DELAYED_DATA_NOT_OFFICIAL_EGX',
   limitation:'Current-page table only, potentially cached, not point-in-time corporate-action-certified'};
 }catch(e){result={schemaVersion:'egx-directfn-exact-session-research-1',checkedAt:new Date().toISOString(),
  source:URL,expectedSession:expected,noAutoPromotion:true,status:'FETCH_FAILED',error:String(e.message).slice(0,250)}}
 finally{clearTimeout(timer)}
 fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'directfn-exact-session-probe.json'),JSON.stringify(result,null,2)+'\n');
 console.log('EGX_DIRECTFN_PROBE',JSON.stringify({date:result.sourceDate,closed:result.sourceMarketClosed,expected:result.expectedSession,
  http:result.httpStatus||null,rows:result.parsedRows||0,valid:result.validExactSession||0,
  focus:result.focus?.map(x=>x.ticker)||[],error:result.error||null}));
 return result;
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
module.exports={parse,dateFromHeader,run};
