'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const load=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
function inspect(doc,closed){
 const dates=new Set(),bars=[];
 for(const r of doc.sessions||[]){
  const day=(r.date||r.sessionDate||'').slice(0,10),o=Number(r.open),h=Number(r.high),l=Number(r.low),c=Number(r.close),v=Number(r.volume);
  if(!validDate(day)||closed.has(day)||dates.has(day)||[o,h,l,c].some(x=>!Number.isFinite(x)||x<=0)||h<Math.max(o,c,l)||l>Math.min(o,c,h)||r.validationStatus==='source_conflict'||(r.warnings||[]).some(w=>/price_conflict/i.test(String(w))))continue;
  dates.add(day);bars.push({date:day,volumeValid:Number.isFinite(v)&&v>=0});
 }
 bars.sort((a,b)=>a.date.localeCompare(b.date));
 return {bars:bars.length,volumeBars:bars.filter(x=>x.volumeValid).length,lastDate:bars.at(-1)?.date||null,firstDate:bars[0]?.date||null};
}
function run(){
 const plan=load('data/research/hybrid-alpha-v1-policy.json'),closed=new Set(load('data/egx-exchange-closures.json').closures.filter(x=>x.status==='confirmed_exchange_closure'&&x.source).map(x=>x.date));
 const matrix=load('docs/astra/STRATEGY_RECONSTRUCTION_MATRIX.json').strategies;
 const dir=path.join(ROOT,'data/history');
 const universe=fs.readdirSync(dir).filter(x=>x.endsWith('.json')).map(f=>{try{const doc=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));return {ticker:doc.ticker||f.slice(0,-5),...inspect(doc,closed)}}catch{return null}}).filter(Boolean);
 const strategies=plan.candidateFamilies.map(f=>{
  const spec=matrix.find(x=>x.strategyId===f.id),minimumBars=Math.max(f.minBars||0,spec?.minimumBars||0),eligible=universe.filter(s=>s.bars>=minimumBars&&s.bars>0);
  return {id:f.id,minimumBars,eligibleSymbols:eligible.length,universeSymbols:universe.length,historyRequirementVerified:minimumBars>0,parity:spec?.parityReadiness||'UNKNOWN',productionEligible:spec?.productionEligibility===true,readyToBacktest:false,blockers:['UNRECONCILED_POINT_IN_TIME_UNIVERSE','PARITY_NOT_CERTIFIED','EXECUTION_RULES_NOT_REPLAYED',...(minimumBars===0?['NO_VERIFIED_HISTORY_MINIMUM']:[])]};
 });
 return {schemaVersion:'hybrid-alpha-coverage-v2',asOf:new Date().toISOString(),dataUniverse:universe.length,verifiedClosureDates:closed.size,strategies,crossFamilyBacktestStatus:'NOT_RUN',researchOnly:true};
}
if(require.main===module){const r=run(),p=path.join(ROOT,'data/research/hybrid-alpha-v1-coverage-v2.json');fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2));}
module.exports={inspect,run};
