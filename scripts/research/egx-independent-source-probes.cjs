#!/usr/bin/env node
'use strict';
// Conservative source discovery. Yahoo full OHLCV is staged as UNVERIFIED RESEARCH evidence;
// EGX/Mubasher URLs are availability probes, never assumed to provide validated historic candles.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fetchHistory}=require('../history/adapters/yahoo-history-adapter.cjs');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const OUT=path.resolve(process.env.EGX_RECOVERY_OUT||path.join(ROOT,'artifacts/history-recovery'));
const read=(p,d)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return d}};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function pageProbe(url){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
 try{
  const x=await fetch(url,{signal:ctl.signal,redirect:'follow',headers:{'User-Agent':'EGX-History-Research/1.0 (public-source-review)','Accept':'text/html'}});
  await x.body?.cancel();
  return {url,status:x.status,ok:x.ok,finalUrl:x.url,interpretation:'ACCESS_ONLY_NOT_DATED_OHLCV'};
 }catch(e){return{url,ok:false,error:String(e.message).slice(0,140),interpretation:'NOT_VERIFIED'}}finally{clearTimeout(timer)}
}
async function probe(){
 const universe=read('data/symbol-map.json',{}),truth=read('data/stable/v15-price-truth.json',{});
 const chosen=String(process.env.EGX_RECOVERY_SYMBOLS||'BONY,TANM,KRDI,CEFM').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9._-]{2,15}$/.test(x)).slice(0,6);
 const output={schemaVersion:'egx-research-source-probe-1',generatedAt:new Date().toISOString(),
  expectedSession:truth.expectedSession||null,mode:'NETWORK_RESEARCH_ONLY_NO_AUTO_PROMOTION',records:[]};
 fs.mkdirSync(path.join(OUT,'yahoo-stage'),{recursive:true});
 for(const t of chosen){
  const entry=universe[t]||{ticker:t,currency:'EGP',exchange:'EGX',yahooSymbol:t+'.CA'};
  const record={ticker:t,providers:[],promotionApproved:false};
  const yahooSymbol=entry.yahooSymbol||t+'.CA';
  try{
   const result=await fetchHistory(entry,{range:'1y',timeoutMs:12000,maxAttempts:1});
   const valid=result.sessions.filter(x=>x.date&&Number(x.close)>0).filter(x=>x.date<=String(truth.expectedSession||'9999-12-31'));
   const body={ticker:t,source:'YAHOO_CHART_RESEARCH_NOT_OFFICIAL',requestedSymbol:result.requestedSymbol,
    identity:result.identity,retrievedAt:new Date().toISOString(),expectedSession:truth.expectedSession||null,
    disclaimer:'No corporate-action certification, not executable without independent same-session review',
    sessions:valid};
   const bytes=JSON.stringify(body,null,2)+'\n';
   fs.writeFileSync(path.join(OUT,'yahoo-stage',t+'.json'),bytes);
   record.providers.push({id:'YAHOO_CHART',status:'STAGED_NOT_APPROVED',identityVerified:result.identity?.verified===true,
    rows:valid.length,latest:valid.at(-1)?.date||null,sha256:sha(bytes),sourceSymbol:yahooSymbol});
  }catch(e){record.providers.push({id:'YAHOO_CHART',status:'UNRESOLVED',error:String(e.message).slice(0,250)})}
  record.providers.push({id:'EGX_OFFICIAL_PUBLIC_PAGE',...await pageProbe('https://www.egx.com.eg/en/Stock_Trading.aspx?code='+encodeURIComponent(t))});
  record.providers.push({id:'MUBASHER_EGX_PAGE',...await pageProbe('https://english.mubasher.info/markets/EGX/stocks/'+encodeURIComponent(t)+'/')});
  output.records.push(record);
  console.log('EGX_PROBE',JSON.stringify({ticker:t,providers:record.providers.map(x=>({id:x.id,status:x.status||x.statusCode||x.ok,rows:x.rows||0}))}));
 }
 fs.writeFileSync(path.join(OUT,'source-probes.json'),JSON.stringify(output,null,2)+'\n');
 return output;
}
if(require.main===module)probe().catch(e=>{console.error(e);process.exitCode=1});
module.exports={probe,pageProbe};
