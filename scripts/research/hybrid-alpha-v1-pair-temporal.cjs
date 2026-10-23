'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {decision}=require('./hybrid-alpha-v1-filter-lab.cjs');
function metrics(rows){
 const v=rows.map(x=>x.netReturnPct).filter(Number.isFinite);
 if(!v.length)return {n:0,winRate:null,meanNet:null,profitFactor:null};
 const win=v.filter(x=>x>0),loss=v.filter(x=>x<0);
 return {n:v.length,winRate:+(win.length/v.length*100).toFixed(2),meanNet:+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(3),profitFactor:loss.length?+(win.reduce((a,b)=>a+b,0)/-loss.reduce((a,b)=>a+b,0)).toFixed(3):null};
}
function audit(doc){
 const trades=(doc.trades||[]).filter(t=>t.variant==='breakout'&&/^\d{4}-\d{2}-\d{2}$/.test(t.signalDate)).sort((a,b)=>a.signalDate.localeCompare(b.signalDate)||a.ticker.localeCompare(b.ticker));
 const unique=[...new Set(trades.map(t=>t.signalDate))],cuts=[unique[Math.floor(unique.length/3)],unique[Math.floor(2*unique.length/3)]];
 const segments=[trades.filter(t=>t.signalDate<cuts[0]),trades.filter(t=>t.signalDate>=cuts[0]&&t.signalDate<cuts[1]),trades.filter(t=>t.signalDate>=cuts[1])];
 const results=segments.map((rows,i)=>{
  const tested=rows.map(t=>({t,d:decision(t)}));
  const extension=tested.filter(x=>x.d?.extension).map(x=>x.t),pair=tested.filter(x=>x.d?.extension&&x.d?.volatility).map(x=>x.t);
  return {segment:i+1,firstDate:rows[0]?.signalDate||null,lastDate:rows.at(-1)?.signalDate||null,breakout:metrics(rows),extension:metrics(extension),extensionAtr:metrics(pair),missingFeatures:tested.filter(x=>!x.d).length};
 });
 return {schemaVersion:'hybrid-alpha-pair-temporal-diagnostic-1',generatedAt:new Date().toISOString(),method:'Fixed thirds of distinct signal dates; previously examined history, NOT out-of-sample; selection bias remains.',researchOnly:true,cutDates:cuts,results,pass:results.every(x=>x.breakout.n>0&&x.missingFeatures===0)};
}
if(require.main===module){
 const source=JSON.parse(fs.readFileSync(path.join(root,'data/research/hybrid-alpha-v1-early-replay.json'),'utf8'));
 const out=audit(source),dest=path.join(root,'data/research/hybrid-alpha-v1-pair-temporal.json');
 fs.writeFileSync(dest,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));if(!out.pass)process.exitCode=2;
}
module.exports={audit};
