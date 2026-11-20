'use strict';
// Exclude known USD-denominated EGX instruments from research; do not guess currency from price ratios.
const fs=require('node:fs'),path=require('node:path');
const POLICY={schemaVersion:'egx-egp-only-universe-policy-v1',baseCurrency:'EGP',
 excluded:[{ticker:'SEIGA',currency:'USD',reason:'USD_DENOMINATED_INSTRUMENT_RESEARCH_EXCLUSION',evidenceStatus:'SECONDARY_IDENTITY_LEAD_PENDING_OFFICIAL_CONFIRMATION'}]};
function loadPolicy(file=path.join(__dirname,'../../data/research/egx-egp-only-universe-policy-v1.json')){
 const p=JSON.parse(fs.readFileSync(file,'utf8'));
 if(p.schemaVersion!==POLICY.schemaVersion||p.baseCurrency!=='EGP'||!Array.isArray(p.excluded))throw Error('Invalid currency universe policy');
 const seen=new Set();
 for(const x of p.excluded){
  if(!/^[A-Z0-9._-]+$/.test(x.ticker)||x.currency!=='USD'||seen.has(x.ticker))throw Error('Invalid or duplicate exclusion');
  seen.add(x.ticker);
 }
 return p;
}
function excludedTicker(ticker,policy=POLICY){return policy.excluded.some(x=>x.ticker===ticker)}
module.exports={POLICY,loadPolicy,excludedTicker};
