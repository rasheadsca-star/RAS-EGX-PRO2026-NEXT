#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const get=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
function audit(index,historyByTicker,truth){
 const stocks=Array.isArray(index.stocks)?index.stocks:[];
 const seen=new Set(),records=[];
 for(const stock of stocks){
  const ticker=String(stock.ticker||'').trim().toUpperCase();
  if(!ticker||seen.has(ticker))continue;
  seen.add(ticker);
  const h=historyByTicker(ticker)||{};
  const raw=Array.isArray(h.sessions)?h.sessions:[];
  const dates=new Set(),valid=[];
  for(const bar of raw){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(String(bar.date||''))||String(bar.date)>truth.expectedSession||dates.has(bar.date))continue;
   const n=['open','high','low','close','volume'].map(k=>Number(bar[k]));
   if(!n.every(Number.isFinite)||n[0]<=0||n[1]<Math.max(n[0],n[3])||n[2]>Math.min(n[0],n[3])||n[2]<=0||n[4]<0)continue;
   dates.add(bar.date);valid.push(bar);
  }
  valid.sort((a,b)=>a.date.localeCompare(b.date));
  records.push({ticker,indexHistoryAvailable:stock.historyAvailable===true,historyFilePresent:raw.length>0,
   validDistinctDatedBars:valid.length,latestBar:valid.at(-1)?.date||null,
   min20:valid.length>=20,min50:valid.length>=50,min100:valid.length>=100,min200:valid.length>=200,
   sourceSessionCurrent:valid.at(-1)?.date===truth.expectedSession,
   symbolVerified:h.symbolVerified===true,isinVerified:typeof h.isin==='string'&&h.isin.length>0&&h.symbolVerified===true,
   executable:false});
 }
 const count=k=>records.filter(x=>x[k]).length;
 return {schemaVersion:'egx-gann-history-capability-crosswalk-1',canonicalSession:truth.expectedSession,
  indexSession:index.marketDate||index.analysisSession||null,universe:records.length,indexHistoryAvailable:count('indexHistoryAvailable'),
  min20:count('min20'),min50:count('min50'),min100:count('min100'),min200:count('min200'),
  historyCurrent:count('sourceSessionCurrent'),identityVerified:count('symbolVerified'),automatedOrderEligible:0,
  dataSource:'data/history/{TICKER}.json',integrationTarget:'Astra canonical history provenance staging',
  recommendation:'Reuse existing Gann modules and historical files, independently verify identity, licensing, and source parity before G09/G11 execution',records};
}
if(require.main===module){
 try{const i=get('data/quant/market-search-index-v13-17.json'),t=get('data/stable/v15-price-truth.json');
 const r=audit(i,s=>{try{return get('data/history/'+s+'.json')}catch{return null}},t);
 const out=path.join(ROOT,'artifacts/research/gann-legacy-history-crosswalk.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify({universe:r.universe,indexHistoryAvailable:r.indexHistoryAvailable,min20:r.min20,min50:r.min50,min100:r.min100,min200:r.min200,historyCurrent:r.historyCurrent,identityVerified:r.identityVerified}));
 }catch(e){console.error(e);process.exitCode=2}
}
module.exports={audit};
