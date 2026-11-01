'use strict';
// Quant price-provenance check: duplicated Yahoo/yfinance/Kaggle quotes are NOT independent evidence.
// No network requests or price imports.
const fs=require('node:fs');
function family(v){const s=String(v||'').trim().toLowerCase();if(/yahoo|yfinance|query[12]\.finance\.yahoo/.test(s))return 'YAHOO_FINANCE';return s.replace(/[^a-z0-9]/g,'_')||'UNKNOWN';}
function key(r){if(!/^[A-Z0-9]{2,8}$/.test(r.ticker)||!/^20\d\d-\d\d-\d\d$/.test(r.date))throw Error('Invalid instrument/date');return r.ticker+'|'+r.date;}
function mapRows(rows){const m=new Map();for(const r of rows){const k=key(r);if(m.has(k))throw Error('Duplicate '+k);m.set(k,r);}return m;}
function equal(a,b){return a!==undefined&&b!==undefined&&Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<=0.00001;}
function audit(seed,archive){
 const base=mapRows(archive),seen=new Set(),c={overlapPairs:0,rawCloseMatches:0,adjustedOnlyMatches:0,volumeMatches:0,ohlcvExactMatches:0,invalidSeedOverlap:0,sameSourceLineage:0,differentLineage:0,unknownLineage:0};const conflicts=[];
 for(const s of seed){const k=key(s);if(seen.has(k))throw Error('Duplicate seed '+k);seen.add(k);const a=base.get(k);if(!a)continue;c.overlapPairs++;
  const f=family(s.source),g=family(a.source);if(f==='UNKNOWN'||g==='UNKNOWN')c.unknownLineage++;else if(f===g)c.sameSourceLineage++;else c.differentLineage++;
  const raw=equal(s.close,a.close),adjusted=!raw&&equal(s.close,a.adjustedClose),vol=Number.isSafeInteger(Number(s.volume))&&Number(s.volume)===Number(a.volume);
  if(raw)c.rawCloseMatches++;else if(adjusted){c.adjustedOnlyMatches++;conflicts.push({ticker:s.ticker,date:s.date,reason:'ADJUSTED_VS_RAW_CLOSE'});}else conflicts.push({ticker:s.ticker,date:s.date,reason:'CLOSE_MISMATCH'});
  if(vol)c.volumeMatches++;if(vol&&raw&&['open','high','low'].every(p=>equal(s[p],a[p])))c.ohlcvExactMatches++;
  if(s.qualityStatus!=='VALID_STRUCTURAL')c.invalidSeedOverlap++;
 }
 return {schemaVersion:1,researchOnly:true,independentlyVerifiedRows:0,productionPriceImports:0,count:c,conflicts,note:'Same-source lineage cannot prove accuracy or market-data redistribution rights.'};
}
if(require.main===module){const [x,y,out]=process.argv.slice(2);if(!x||!y||!out)throw Error('Usage: node audit-source-lineage.cjs seed.json history.json result.json');const r=audit(JSON.parse(fs.readFileSync(x,'utf8')),JSON.parse(fs.readFileSync(y,'utf8')));fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r.count));}
module.exports={audit,family};