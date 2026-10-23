'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
function audit(){
 const plan=read('data/research/hybrid-alpha-v1-policy.json');
 const registry=read('docs/astra/STRATEGY_RECONSTRUCTION_MATRIX.json').strategies;
 const closed=new Set(read('data/egx-exchange-closures.json').closures.filter(x=>x.status==='confirmed_exchange_closure'&&x.source).map(x=>x.date));
 const dir=path.join(ROOT,'data/history');
 const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json'));
 const symbols=[];
 for(const file of files){let doc;try{doc=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'))}catch{continue}
  if(!Array.isArray(doc.sessions))continue;
  const rows=doc.sessions.filter(x=>x.date&&!closed.has(x.date)&&Number(x.close)>0&&x.validationStatus!=='source_conflict');
  symbols.push({ticker:doc.ticker||file.slice(0,-5),eligibleBars:rows.length,lastSession:rows.at(-1)?.date||null});
 }
 const families=plan.candidateFamilies.map(f=>{
  const original=registry.find(x=>x.strategyId===f.id);
  const bars=Number(f.minBars||original?.minimumBars||0);
  const count=bars>0?symbols.filter(s=>s.eligibleBars>=bars).length:null;
  return {strategyId:f.id,minimumBars:bars,symbolsWithMinimumBars:count,algorithmRecoverability:original?.algorithmRecoverability||null,parityReadiness:original?.parityReadiness||null,needsIndependentReplay:true,executionAllowed:false};
 });
 return {schemaVersion:'hybrid-alpha-coverage-audit-1',generatedAt:new Date().toISOString(),researchOnly:true,historyFiles:files.length,usableSymbols:symbols.length,verifiedClosureDays:closed.size,strategies:families,candidateComparisons:plan.comparisons.length,backtestResultsProduced:false,note:'Coverage audit only. It does not calculate forward returns, rank champions, or certify strategies.'};
}
if(require.main===module){const out=audit(),dest=path.join(ROOT,'data/research/hybrid-alpha-v1-coverage.json');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));}
module.exports={audit};
