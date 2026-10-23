'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const {eligible,POLICY}=require('./hybrid-alpha-v1-quality-cohort.cjs');
const summarize=(rows)=>{const v=rows.map(x=>x.netReturnPct).filter(Number.isFinite),wins=v.filter(x=>x>0),loss=v.filter(x=>x<0);return {trades:v.length,wins:wins.length,winRatePct:v.length?+(wins.length/v.length*100).toFixed(2):null,meanNetReturnPct:v.length?+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(3):null,profitFactor:loss.length?+(wins.reduce((a,b)=>a+b,0)/(-loss.reduce((a,b)=>a+b,0))).toFixed(3):null};};
function audit(doc){
 const trades=(doc.trades||[]).filter(t=>t.variant==='breakout'&&/^\d{4}-\d{2}-\d{2}$/.test(t.signalDate)).sort((a,b)=>a.signalDate.localeCompare(b.signalDate)||String(a.ticker).localeCompare(String(b.ticker)));
 const dates=[...new Set(trades.map(t=>t.signalDate))].sort(),mid=Math.floor(dates.length/2);
 const cutoff=dates[mid]||null;
 const windows=[{name:'earlier',rows:trades.filter(t=>t.signalDate<cutoff)},{name:'later',rows:trades.filter(t=>t.signalDate>=cutoff)}];
 const results=windows.map(w=>{const accepted=w.rows.filter(t=>eligible(t,POLICY)===true),rejected=w.rows.filter(t=>eligible(t,POLICY)===false),missing=w.rows.filter(t=>eligible(t,POLICY)===null);return {window:w.name,startDate:w.rows[0]?.signalDate||null,endDate:w.rows.at(-1)?.signalDate||null,baseline:summarize(w.rows),accepted:summarize(accepted),rejected:summarize(rejected),missing:missing.length,acceptedVsBaselineMeanPp:accepted.length?+(summarize(accepted).meanNetReturnPct-summarize(w.rows).meanNetReturnPct).toFixed(3):null}});
 return {schemaVersion:'hybrid-alpha-frozen-chronological-1',generatedAt:new Date().toISOString(),researchOnly:true,filter:POLICY,cutoffDate:cutoff,method:'Equal count of distinct historical signal dates; filters frozen before temporal comparison, but previously assessed on pooled history. NOT genuinely untouched out-of-sample.',results,pass:results.every(x=>x.missing===0&&x.baseline.trades>0)};
}
if(require.main===module){const data=JSON.parse(fs.readFileSync(path.join(ROOT,'data/research/hybrid-alpha-v1-early-replay.json'),'utf8')),out=audit(data),target=path.join(ROOT,'data/research/hybrid-alpha-v1-chronological.json');fs.writeFileSync(target,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));if(!out.pass)process.exitCode=2;}
module.exports={audit};
