'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const frozen=Object.freeze({closePositionMin:0.7,maxExtensionSma20Pct:8,maxAtr14Pct:6});
function decision(t){
 const f=t.signalFeatures||{};
 if(!Number.isFinite(f.closePosition)||!Number.isFinite(f.extensionSma20Pct)||!Number.isFinite(f.atr14Pct))return null;
 return {quality:f.closePosition>=frozen.closePositionMin,extension:f.extensionSma20Pct<=frozen.maxExtensionSma20Pct,volatility:f.atr14Pct<=frozen.maxAtr14Pct};
}
function stats(a){const v=a.map(x=>x.netReturnPct),pos=v.filter(x=>x>0),neg=v.filter(x=>x<0);return {n:a.length,winRate:a.length?+(pos.length/a.length*100).toFixed(2):null,meanNet:a.length?+(v.reduce((x,y)=>x+y,0)/a.length).toFixed(3):null,profitFactor:neg.length?+(pos.reduce((x,y)=>x+y,0)/(-neg.reduce((x,y)=>x+y,0))).toFixed(3):null,targets:a.filter(x=>x.status==='TARGET').length,stops:a.filter(x=>x.status==='STOP').length};}
function audit(doc){
 const baseline=(doc.trades||[]).filter(x=>x.variant==='breakout');
 const features=['quality','extension','volatility','extension_atr','all3'],result={};
 for(const id of features){
  const accepted=[],rejected=[],unknown=[];
  for(const t of baseline){const d=decision(t);if(!d){unknown.push(t);continue}const ok=id==='all3'?d.quality&&d.extension&&d.volatility:id==='extension_atr'?d.extension&&d.volatility:d[id];(ok?accepted:rejected).push(t);}
  result[id]={accepted:stats(accepted),rejected:stats(rejected),missing:unknown.length,partitionValid:accepted.length+rejected.length+unknown.length===baseline.length};
 }
 return {schemaVersion:'hybrid-alpha-filter-lab-1',generatedAt:new Date().toISOString(),researchOnly:true,method:'Frozen exploratory point-in-time features, identical original Breakout executions; NOT an untouched OOS test.',frozenThresholds:frozen,baseline:stats(baseline),filters:result,pass:Object.values(result).every(x=>x.partitionValid&&x.missing===0)};
}
if(require.main===module){const doc=JSON.parse(fs.readFileSync(path.join(root,'data/research/hybrid-alpha-v1-early-replay.json'),'utf8'));const r=audit(doc),out=path.join(root,'data/research/hybrid-alpha-v1-filter-lab.json');fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2));if(!r.pass)process.exitCode=2;}
module.exports={decision,audit};
