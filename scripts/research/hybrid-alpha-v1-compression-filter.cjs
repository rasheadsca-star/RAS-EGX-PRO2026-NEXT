'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {decision}=require('./hybrid-alpha-v1-filter-lab.cjs');
const THRESHOLD=5; // percent range over 5 completed sessions before signal, precommitted exploratory bound
function stats(rows){const v=rows.map(x=>x.netReturnPct).filter(Number.isFinite),p=v.filter(x=>x>0),n=v.filter(x=>x<0);return {n:v.length,winRate:v.length?+(100*p.length/v.length).toFixed(2):null,meanNet:v.length?+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(3):null,profitFactor:n.length?+(p.reduce((a,b)=>a+b,0)/(-n.reduce((a,b)=>a+b,0))).toFixed(3):null};}
function audit(doc){
 const base=(doc.trades||[]).filter(x=>x.variant==='breakout');
 const eligible=[],ineligible=[],missing=[],pair=[];
 for(const t of base){
  const d=decision(t),r=t.signalFeatures?.preBreakoutRange5Pct;
  if(!d||!Number.isFinite(r)){missing.push(t);continue}
  if(!(d.extension&&d.volatility))continue;
  pair.push(t);(r<=THRESHOLD?eligible:ineligible).push(t);
 }
 return {schemaVersion:'hybrid-alpha-pair-plus-compression-1',generatedAt:new Date().toISOString(),researchOnly:true,thresholdPct:THRESHOLD,method:'Compare identical historical trades accepted by extension+ATR; third filter is prior 5-session high-low range / prior 5-session average close, <=5%. Exploratory; no untouched OOS.',baseline:stats(base),pair:stats(pair),triple:stats(eligible),pairRejectedByThird:stats(ineligible),missingFeatures:missing.length,pass:eligible.length+ineligible.length===pair.length&&missing.length===0};
}
if(require.main===module){const doc=JSON.parse(fs.readFileSync(path.join(root,'data/research/hybrid-alpha-v1-early-replay.json'),'utf8')),r=audit(doc);fs.writeFileSync(path.join(root,'data/research/hybrid-alpha-v1-compression-filter.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2));if(!r.pass)process.exitCode=2;}
module.exports={audit};
