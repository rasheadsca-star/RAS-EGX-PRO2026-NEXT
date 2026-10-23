'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const POLICY=Object.freeze({minVolumeRatio:1.8,minMomentum20Pct:2,minAverageTurnover20Egp:100000,requireAboveSma50:true});
const sum=rows=>{
 const r=rows.map(x=>x.netReturnPct).filter(Number.isFinite),wins=r.filter(x=>x>0),loss=r.filter(x=>x<0);
 return {trades:rows.length,wins:wins.length,winRatePct:r.length?+(100*wins.length/r.length).toFixed(2):null,meanNetReturnPct:r.length?+(r.reduce((a,b)=>a+b,0)/r.length).toFixed(3):null,profitFactor:loss.length?+(wins.reduce((a,b)=>a+b,0)/-loss.reduce((a,b)=>a+b,0)).toFixed(3):null,stopHits:rows.filter(x=>x.status==='STOP').length,targetHits:rows.filter(x=>x.status==='TARGET').length};
};
function eligible(t,p=POLICY){
 const f=t.signalFeatures;
 if(!f||!Number.isFinite(f.volumeRatio)||!Number.isFinite(f.momentum20Pct)||!Number.isFinite(f.avgTurnover20)||typeof f.aboveSma50!=='boolean')return null;
 return f.volumeRatio>=p.minVolumeRatio&&f.momentum20Pct>=p.minMomentum20Pct&&f.avgTurnover20>=p.minAverageTurnover20Egp&&(!p.requireAboveSma50||f.aboveSma50);
}
function audit(doc,p=POLICY){
 const breakout=(doc.trades||[]).filter(t=>t.variant==='breakout');
 const accepted=[],rejected=[],unavailable=[];
 for(const t of breakout){const e=eligible(t,p);if(e===null)unavailable.push(t);else(e?accepted:rejected).push(t);}
 const a=sum(accepted),b=sum(rejected);
 return {schemaVersion:'hybrid-alpha-quality-cohort-1',researchOnly:true,generatedAt:new Date().toISOString(),filterDefinition:p,scope:'Identical original Breakout trades, classified by indicators at signal close; not a new portfolio simulation.',baseline:sum(breakout),accepted:a,rejected:b,unavailable:sum(unavailable),upliftMeanNetPp:a.meanNetReturnPct!==null&&b.meanNetReturnPct!==null?+(a.meanNetReturnPct-b.meanNetReturnPct).toFixed(3):null,pass:a.trades+b.trades+unavailable.length===breakout.length};
}
if(require.main===module){
 const input=JSON.parse(fs.readFileSync(path.join(ROOT,'data/research/hybrid-alpha-v1-early-replay.json'),'utf8'));
 const report=audit(input),dest=path.join(ROOT,'data/research/hybrid-alpha-v1-quality-cohort.json');
 fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 if(!report.pass||report.unavailable.trades)process.exitCode=2;
}
module.exports={audit,eligible,POLICY};
