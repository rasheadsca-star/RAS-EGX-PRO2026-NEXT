'use strict';
// Read-only provenance audit. Never upgrades, reconstructs, or approves a price bar.
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.GITHUB_WORKSPACE||process.cwd();
const {strictProvenance}=require('./walkforward-backtest.cjs');
const {historicalBarValid,validIsin}=require('./egx-independent-paper.cjs');
const {copiedBarReasons}=require('./stale-bar-detector.cjs');
function audit(rootDir=root){
 const price=JSON.parse(fs.readFileSync(path.join(rootDir,'data/stable/v15-price-truth.json'),'utf8'));
 const historyDir=path.join(rootDir,'data/history');
 const session=String(price.expectedSession||'').slice(0,10);
 const files=fs.readdirSync(historyDir).filter(x=>/^[A-Za-z0-9]{2,12}\.json$/.test(x)).sort();
 const output={schemaVersion:'egx-history-provenance-audit-v1',session,priceGate:{
  ready:price.ready===true,executionGrade:price.executionGrade===true,
  acceptedRows:price.acceptedRows??null,minimumExecutionRows:price.minimumExecutionRows??null,
  independentMinimumRows:190
 },totals:{symbols:0,identityVerified:0,datedCurrent:0,cleanLast60:0,with60Bars:0,duplicatedSessionSymbols:0,staleCopiedLast60:0},
  symbols:[]};
 for(const file of files){
  let h;try{h=JSON.parse(fs.readFileSync(path.join(historyDir,file),'utf8'))}catch{continue}
  const ticker=file.slice(0,-5);
  const bars=(Array.isArray(h.sessions)?h.sessions:[]).slice().sort((a,b)=>String(a.date||a.sessionDate||'').localeCompare(String(b.date||b.sessionDate||'')));
  const lookback=bars.filter(x=>String(x.date||x.sessionDate||'').slice(0,10)<=session).slice(-60);
  const latest=lookback.at(-1);
  const dates=lookback.map(x=>String(x.date||x.sessionDate||'').slice(0,10));
  const clean=lookback.filter(x=>strictProvenance(x,historicalBarValid)).length;
  const identity=h.symbolVerified===true&&validIsin(h.isin)&&String(h.ticker||'').toUpperCase()===ticker;
  const current=String(latest?.date||latest?.sessionDate||'').slice(0,10)===session;
  const duplicates=new Set(dates).size!==dates.length;
  const copied=copiedBarReasons(lookback).length>0;
  const row={ticker,identityVerified:identity,latestSession:String(latest?.date||latest?.sessionDate||'').slice(0,10),
   lookbackBars:lookback.length,verifiedProvenanceBars:clean,unverifiedProvenanceBars:lookback.length-clean,
   duplicateSessions:duplicates,staleCopiedBars:copied,cleanLast60:identity&&current&&lookback.length===60&&clean===60&&!duplicates&&!copied};
  output.symbols.push(row);output.totals.symbols++;
  if(identity)output.totals.identityVerified++;
  if(current)output.totals.datedCurrent++;
  if(lookback.length===60)output.totals.with60Bars++;
  if(row.cleanLast60)output.totals.cleanLast60++;
  if(duplicates)output.totals.duplicatedSessionSymbols++;
  if(copied)output.totals.staleCopiedLast60++;
 }
 output.symbols.sort((a,b)=>Number(b.cleanLast60)-Number(a.cleanLast60)||a.ticker.localeCompare(b.ticker));
 return output;
}
if(require.main===module){
 const out=audit();
 const dest=path.join(root,'unified-console/history-provenance-audit.json');
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.writeFileSync(dest,JSON.stringify(out,null,2)+'\n');
 console.log('EGX_HISTORY_PROVENANCE_AUDIT '+JSON.stringify(out.totals));
}
module.exports={audit};
