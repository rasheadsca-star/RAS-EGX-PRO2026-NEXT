#!/usr/bin/env node
'use strict';
// Independent provenance triage. No writes to symbol-map, production or history.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const structural=new Set(['BLOCKS','BUCKETS','FOLLOW','RISK','RULES']);
const read=(p,d={})=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return d}};
function assess({map,history,search,market,truth}){
 const universe=Array.isArray(map)?map:Object.values(map||{});
 const active=universe.filter(x=>x?.active!==false&&x?.ticker);
 const indexed=new Set((search?.stocks||[]).map(x=>String(x.ticker||'').toUpperCase()));
 const marketRows=new Set((market?.rows||[]).map(x=>String(x.symbol||x.ticker||x.code||'').toUpperCase()));
 const histBy=new Map((history?.symbols||[]).map(x=>[x.ticker,x]));
 const rejected=new Set((truth?.missingHistoryFiles||[]).map(String));
 const records=active.map(entry=>{
   const t=String(entry.ticker).toUpperCase(),h=histBy.get(t)||{};
   const discovery=entry.discoverySources||[];
   const fromWatchlistOnly=discovery.length>0&&discovery.every(x=>/actionable-watchlist|final-opportunity-ranking|final-multisource-ranking/i.test(x));
   const structurallySuspicious=structural.has(t)&&!entry.companyNameEn&&!entry.companyNameAr&&!entry.isin
    &&fromWatchlistOnly&&!indexed.has(t)&&!marketRows.has(t)
    &&!h.sourceFile&&!(h.availableSessions>0);
   const categories=[];
   if(structurallySuspicious)categories.push('POSSIBLE_DISCOVERY_SCHEMA_FIELD_NOT_SECURITY');
   if(!indexed.has(t))categories.push('MARKET_SEARCH_INDEX_ABSENT');
   if(!marketRows.has(t))categories.push('MARKET_PRICE_ROW_ABSENT_NOT_DELISTING_PROOF');
   if(h.symbolVerified!==true)categories.push('NO_VERIFIED_HISTORY_IDENTITY');
   if(rejected.has(t))categories.push('SOURCE_HISTORY_GAP');
   if(h.lastSession&&truth?.expectedSession&&h.lastSession<truth.expectedSession)categories.push('CURRENT_SESSION_HISTORY_STALE');
   return {ticker:t,companyNameAr:entry.companyNameAr||null,companyNameEn:entry.companyNameEn||null,
    isin:entry.isin||null,mappedCurrency:entry.currency||null,marketRowPresent:marketRows.has(t),
    marketSearchIndexPresent:indexed.has(t),historySessions:h.availableSessions||0,
    historyLastSession:h.lastSession||null,historyIdentityVerified:h.symbolVerified===true,
    discoverySources:discovery,proposedStatus:structurallySuspicious?'MANUAL_STRUCTURAL_KEY_REVIEW':'VERIFY_IDENTITY_AND_SESSION',
    categories,automaticallyExclude:false};
 });
 const suspect=records.filter(x=>x.proposedStatus==='MANUAL_STRUCTURAL_KEY_REVIEW');
 const notIndexed=records.filter(x=>!x.marketSearchIndexPresent);
 const withoutIdentity=records.filter(x=>!x.historyIdentityVerified);
 return {schemaVersion:'egx-active-universe-identity-audit-1',generatedAt:new Date().toISOString(),
  expectedSession:truth?.expectedSession||null,readOnly:true,productionDataMutated:false,
  summary:{mappedActive:active.length,unindexedActive:notIndexed.length,unverifiedIdentity:withoutIdentity.length,
    apparentStructuralKeys:suspect.length,missingHistorySource:records.filter(x=>x.categories.includes('SOURCE_HISTORY_GAP')).length},
  structuralReview:suspect,unindexedActive:notIndexed,identityUnverified:withoutIdentity,records};
}
if(require.main===module){
 const j=assess({map:read('data/symbol-map.json'),history:read('data/history-summary.json'),search:read('data/quant/market-search-index-v13-17.json'),market:read('data/market.json'),truth:read('data/stable/v15-price-truth.json')});
 const folder=path.resolve(process.env.EGX_IDENTITY_OUT||path.join(ROOT,'artifacts/universe-identity'));
 fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'evidence.json'),JSON.stringify(j,null,2)+'\n');
 console.log('EGX_UNIVERSE_IDENTITY_AUDIT',JSON.stringify(j.summary));}
module.exports={assess,structural};
