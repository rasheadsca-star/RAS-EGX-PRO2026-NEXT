'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const src=path.join(root,'data/research/hybrid-alpha-v1-early-replay.json');
const out=path.join(root,'data/research/hybrid-alpha-v1-cohort-audit.json');
function summarize(rows){
 const returns=rows.map(x=>x.netReturnPct);
 const mean=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:null;
 return {trades:rows.length,wins:returns.filter(x=>x>0).length,winRatePct:rows.length?Number((100*returns.filter(x=>x>0).length/rows.length).toFixed(2)):null,meanNetReturnPct:mean===null?null:Number(mean.toFixed(3)),stopHits:rows.filter(x=>x.status==='STOP').length,targetHits:rows.filter(x=>x.status==='TARGET').length,timeExits:rows.filter(x=>x.status==='TIME_EXIT').length};
}
function analyze(doc){
 const byKey=new Map();
 for(const t of doc.trades||[]){
  const key=t.ticker+'|'+t.signalDate;
  if(!byKey.has(key))byKey.set(key,{});
  const obj=byKey.get(key);
  if(obj[t.variant])throw new Error('Duplicate variant for ticker/session: '+key+' '+t.variant);
  obj[t.variant]=t;
 }
 const accepted=[],rejected=[];
 for(const group of byKey.values()){
  if(!group.breakout)continue;
  if(group.hybrid)accepted.push(group.breakout);
  else rejected.push(group.breakout);
 }
 const a=summarize(accepted),b=summarize(rejected);
 return {schemaVersion:'hybrid-alpha-cohort-audit-1',generatedAt:new Date().toISOString(),researchOnly:true,baseline:'breakout',filter:'vcp',accepted:a,rejected:b,meanReturnUpliftPp:a.meanNetReturnPct===null||b.meanNetReturnPct===null?null:Number((a.meanNetReturnPct-b.meanNetReturnPct).toFixed(3)),interpretation:'Descriptive, in-sample cohort difference; no statistical superiority established. Overlapping strategy outcomes may be correlated.',check:{breakoutCount:(doc.variants||[]).find(x=>x.variant==='breakout')?.signals||0,partitionCount:a.trades+b.trades,pass:a.trades+b.trades===((doc.variants||[]).find(x=>x.variant==='breakout')?.signals||0)}};
}
if(require.main===module){
 const result=analyze(JSON.parse(fs.readFileSync(src,'utf8')));
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));if(!result.check.pass)process.exitCode=2;
}
module.exports={analyze};
