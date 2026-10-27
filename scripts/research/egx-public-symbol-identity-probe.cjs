#!/usr/bin/env node
'use strict';
// Bounded secondary-public-source discovery. NEVER certifies current EGX listing or OHLCV.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.resolve(process.env.EGX_RECOVERY_OUT||path.join(ROOT,'artifacts/history-recovery'));
const read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'))}catch{return fallback}};
function plain(raw){return String(raw||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
 .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
 .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim()}
function parsePage(html,ticker){
 const header=(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'';
 const heading=plain(header),text=plain(html).slice(0,25000);
 const reg=new RegExp('(?:\\(|\\b)'+ticker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\)|\\b)','i');
 const identityHeadingMatches=Boolean(heading&&reg.test(heading));
 const currency=((text.match(/Trading Currency\s+(US Dollar|Egyptian Pound|Euro)/i)||[])[1]||null);
 const lastUpdate=((text.match(/Last update:\s*([^\.]{1,90}market time)/i)||[])[1]||null);
 return {heading:heading.slice(0,160),identityHeadingMatches,tradingCurrencyPublicPage:currency,
  displayedMarketTime:lastUpdate,
  status:identityHeadingMatches?'PUBLIC_HEADING_SYMBOL_MATCH_REVIEW_ONLY':'NO_EXPLICIT_TICKER_HEADING_MATCH',
  warning:'Public third-party page is not official listing proof and cannot verify any EOD candle'};
}
function targets(map,history,search){
 const index=new Set((search.stocks||[]).map(x=>String(x.ticker||'').toUpperCase()));
 const by=new Map((history.symbols||[]).map(x=>[String(x.ticker).toUpperCase(),x]));
 const output=[];
 for(const e of Object.values(map||{})){
  if(!e?.ticker||e.active===false)continue;
  const t=String(e.ticker).toUpperCase(),h=by.get(t)||{};
  const noIndex=!index.has(t),yahoo404=String(h.lastUpdateError||'').includes('HTTP 404');
  if(noIndex||yahoo404)output.push({ticker:t,noIndex,yahoo404,mappedCurrency:e.currency||null,
   companyName:e.companyNameEn||e.companyNameAr||null,discoverySources:e.discoverySources||[]});
 }
 return output.sort((a,b)=>Number(b.noIndex)-Number(a.noIndex)||Number(b.yahoo404)-Number(a.yahoo404)||a.ticker.localeCompare(b.ticker)).slice(0,65);
}
async function fetchOne(row){
 const url='https://english.mubasher.info/markets/EGX/stocks/'+encodeURIComponent(row.ticker)+'/';
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),11000);
 try{
  const res=await fetch(url,{signal:ctrl.signal,redirect:'follow',headers:{'Accept':'text/html','User-Agent':'EGX-PRO-Research/1.0'}});
  if(!res.ok)return {...row,url,httpStatus:res.status,status:'SOURCE_HTTP_REJECTED',automaticallyPromoted:false};
  const html=await res.text();if(html.length>2e6)throw Error('Oversized HTML response');
  return {...row,url,httpStatus:res.status,bytes:html.length,...parsePage(html,row.ticker),automaticallyPromoted:false};
 }catch(e){return {...row,url,status:'SOURCE_UNAVAILABLE',error:String(e.message).slice(0,150),automaticallyPromoted:false}}
 finally{clearTimeout(timer)}
}
async function run(){
 const map=read('data/symbol-map.json',{}),history=read('data/history-summary.json',{}),search=read('data/quant/market-search-index-v13-17.json',{});
 const queue=targets(map,history,search);
 const results=new Array(queue.length);let pos=0;
 async function worker(){while(pos<queue.length){const i=pos++;results[i]=await fetchOne(queue[i])}}
 await Promise.all(Array.from({length:3},worker));
 const summary={selected:queue.length,publicHeadingMatches:results.filter(x=>x.identityHeadingMatches).length,
  unavailable:results.filter(x=>x.status==='SOURCE_HTTP_REJECTED'||x.status==='SOURCE_UNAVAILABLE').length,
  currencyConflicts:results.filter(x=>x.identityHeadingMatches&&x.tradingCurrencyPublicPage&&((x.mappedCurrency==='EGP'&&x.tradingCurrencyPublicPage!=='Egyptian Pound')||(x.mappedCurrency==='USD'&&x.tradingCurrencyPublicPage!=='US Dollar'))).map(x=>({ticker:x.ticker,mapCurrency:x.mappedCurrency,publicCurrency:x.tradingCurrencyPublicPage}))};
 const report={schemaVersion:'egx-public-symbol-identity-research-1',checkedAt:new Date().toISOString(),provider:'Mubasher public pages',
  readOnly:true,automaticallyPromoted:0,source:'secondary reference NOT EGX listing authority',
  summary,records:results};
 fs.mkdirSync(OUT,{recursive:true});
 fs.writeFileSync(path.join(OUT,'public-symbol-identity-probe.json'),JSON.stringify(report,null,2)+'\n');
 console.log('EGX_PUBLIC_SYMBOL_REFERENCE_PROBE',JSON.stringify(summary));
 return report;
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
module.exports={plain,parsePage,targets,run};
