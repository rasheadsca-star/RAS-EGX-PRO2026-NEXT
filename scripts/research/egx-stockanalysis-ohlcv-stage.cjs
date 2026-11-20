#!/usr/bin/env node
'use strict';
// Research-only independent external OHLCV staging. Not licensed for redistribution
// or production use until provider rights, corporate actions, identity and dates are verified.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.join(ROOT,'artifacts/history-recovery/stockanalysis-stage');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const clean=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/,/g,'').trim();
const number=s=>{let n=Number(clean(s));return Number.isFinite(n)?n:null};
function parse(html,ticker){
 const heading=clean((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'');
 const content=String(html).match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
 const rows=[],rejects=[];
 for(const tr of content){
  const cells=[...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>clean(m[1]));
  if(cells.length<7||!/[A-Za-z]{3}\s+\d{1,2},?\s+202\d/.test(cells[0]))continue;
  const d=new Date(cells[0].replace(/,/g,'')+' UTC');
  if(!Number.isFinite(d.getTime()))continue;
  const date=d.toISOString().slice(0,10),[open,high,low,close]=cells.slice(1,5).map(number);
  const volume=number(cells.at(-1));
  const reason=!([open,high,low,close,volume].every(Number.isFinite))?'NOT_NUMERIC':high<Math.max(open,close)||low>Math.min(open,close)||volume<0?'OHLCV_INCONSISTENT':null;
  const item={ticker,date,open,high,low,close,volume,source:'STOCKANALYSIS_PUBLIC_S_AND_P_ATTRIBUTED',eligibleForTrading:false};
  if(reason)rejects.push({date,reason});else rows.push(item);
 }
 return {heading,rows,rejects,htmlTableRows:content.length};
}
async function one(ticker,expected){
 const url='https://stockanalysis.com/quote/egx/'+encodeURIComponent(ticker)+'/history/';
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),13000);
 try{
  const resp=await fetch(url,{signal:ctrl.signal,headers:{'User-Agent':'Mozilla/5.0 (compatible; EGXResearchAudit/1.0)','Accept':'text/html'}});
  if(!resp.ok)return {ticker,url,httpStatus:resp.status,rows:0,status:'SOURCE_HTTP_FAILED'};
  const html=await resp.text();const parsed=parse(html,ticker);
  const rows=parsed.rows.filter(r=>r.date<=expected);
  const record={ticker,url,httpStatus:resp.status,parsedRows:rows.length,discardedRows:parsed.rejects.length,latestDate:rows.at(0)?.date||null,status:rows.length?'RESEARCH_OHLCV_STAGED_NOT_VERIFIED':'NO_PARSEABLE_OHLCV',heading:parsed.heading,invalid:parsed.rejects,productionPromotion:false};
  if(rows.length){fs.writeFileSync(path.join(OUT,ticker+'.json'),JSON.stringify({ticker,sourceUrl:url,sourceAttribution:'S&P Global Market Intelligence via stockanalysis.com',retrievedAt:new Date().toISOString(),expectedSession:expected,rightsAndOfficialIdentityUnverified:true,corporateActionParityUnverified:true,sessions:rows},null,2)+'\n')}
  return record;
 }catch(e){return {ticker,url,status:'SOURCE_UNAVAILABLE',error:String(e.message).slice(0,140),productionPromotion:false}}finally{clearTimeout(timer)}
}
async function run(){
 const truth=read('data/stable/v15-price-truth.json'),symbols=truth.missingHistoryFiles;
 if(!Array.isArray(symbols)||symbols.length===0)throw Error('NO_EXPLICIT_GAP_QUEUE');
 fs.mkdirSync(OUT,{recursive:true});
 const results=[];for(let i=0;i<symbols.length;i+=4){results.push(...await Promise.all(symbols.slice(i,i+4).map(t=>one(t,truth.expectedSession))))}
 const output={schemaVersion:'egx-stockanalysis-independent-staging-1',session:truth.expectedSession,checked:results.length,
  withParseableBars:results.filter(r=>r.parsedRows>0).length,stagedBars:results.reduce((s,r)=>s+(r.parsedRows||0),0),
  automaticallyPromoted:0,productionApproval:false,records:results};
 fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({checked:output.checked,withParseableBars:output.withParseableBars,stagedBars:output.stagedBars,automaticallyPromoted:0}));
 return output;
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=2});
module.exports={parse};
