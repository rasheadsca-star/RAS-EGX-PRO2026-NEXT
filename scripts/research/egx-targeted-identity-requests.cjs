#!/usr/bin/env node
'use strict';
// Exact-session security identity reconciliation requests; no claim of official verification.
const fs=require('node:fs'),path=require('node:path');
function build(truth,mapping,history){
 if(!Array.isArray(truth?.missingHistoryFiles))throw Error('NO_MISSING_SYMBOLS_EVIDENCE');
 const historic=new Map((history?.symbols||[]).map(x=>[x.ticker,x]));
 const records=[],seen=new Set();
 for(const ticker of truth.missingHistoryFiles){
  if(seen.has(ticker)||!/^[A-Z0-9._-]{2,15}$/.test(ticker))throw Error('INVALID_OR_DUPLICATE_TICKER');
  seen.add(ticker);
  const m=mapping[ticker],h=historic.get(ticker);
  if(!m||m.active!==true)throw Error('UNMAPPED_OR_INACTIVE_TICKER:'+ticker);
  records.push({ticker,companyNameAr:m.companyNameAr||null,companyNameEn:m.companyNameEn||null,
   mappedCurrency:m.currency||null,mappedISIN:m.isin||null,verifiedISIN:null,
   yahooSymbol:m.yahooSymbol||null,mubasherTicker:m.mubasherTicker||null,
   historyBars:h?.availableSessions??null,lastHistorySession:h?.lastSession||null,
   currentSymbolVerified:m.symbolVerified===true,
   officialIdentityStatus:'REQUIRES_OFFICIAL_ISIN_AND_SHARE_CLASS',
   requestedEvidence:['EGX_or_licensed_provider_ISIN','security_name','ticker','share_class','currency','exchange','validity_dates','dated_OHLCV_at_least_120_sessions','corporate_actions'],
   permittedAutomaticPromotion:false});
 }
 const byName=new Map();
 for(const r of records){const key=(r.companyNameEn||r.companyNameAr||'').trim().toUpperCase();if(key){const a=byName.get(key)||[];a.push(r);byName.set(key,a)}}
 const identityConflicts=[];
 for(const [name,rs] of byName)if(rs.length>1){
  const currencies=[...new Set(rs.map(r=>r.mappedCurrency))];
  identityConflicts.push({companyName:name,tickers:rs.map(r=>r.ticker),currencies,
   status:'VERIFY_DISTINCT_SHARE_CLASSES_AND_ISINS_DO_NOT_MERGE'});
 }
 return {schemaVersion:'egx-gap-identity-reconciliation-1',expectedSession:truth.expectedSession,
  generatedAt:new Date().toISOString(),requested:records.length,officiallyVerified:0,
  unverified:records.length,identityConflicts,records,productionPromotion:false};
}
function csvField(v){const s=String(v??'');return '"'+s.replace(/"/g,'""')+'"'}
function toCsv(doc){const cols=['ticker','companyNameAr','companyNameEn','mappedCurrency','mappedISIN','verifiedISIN','yahooSymbol','mubasherTicker','historyBars','lastHistorySession','officialIdentityStatus'];
 return [cols.join(','),...doc.records.map(r=>cols.map(c=>csvField(r[c])).join(','))].join('\n')+'\n'}
if(require.main===module){
 try{
  const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
  const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
  const doc=build(read('data/stable/v15-price-truth.json'),read('data/symbol-map.json'),read('data/history-summary.json'));
  const out=path.join(root,'artifacts/history-recovery/targeted-21');
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'security-identity-requests.json'),JSON.stringify(doc,null,2)+'\n');
  fs.writeFileSync(path.join(out,'security-identity-requests.csv'),toCsv(doc));
  console.log(JSON.stringify({requested:doc.requested,officiallyVerified:doc.officiallyVerified,identityConflicts:doc.identityConflicts}));
 }catch(e){console.error(e);process.exitCode=2}
}
module.exports={build,toCsv};
