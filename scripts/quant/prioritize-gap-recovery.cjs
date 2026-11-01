'use strict';
// Rank distinct instrument/date evidence gaps by repeated missing marks across paper stress scenarios.
// Research triage only. Scores never alter price data or trade recommendations.
const fs=require('node:fs'),path=require('node:path');
function rank(rows,marks){
 const freq=new Map(),scenarios=new Map();
 for(const m of marks){const k=m.ticker+'|'+m.date;freq.set(k,(freq.get(k)||0)+1);if(!scenarios.has(k))scenarios.set(k,new Set());scenarios.get(k).add(m.scenario);}
 return rows.map(r=>{
  const k=r.ticker+'|'+r.date;
  const n=freq.get(k)||0,s=scenarios.get(k)?.size||0;
  const category=r.status==='UNRESOLVED'?'UNRESOLVED':r.actionRisk===true?'CORPORATE_ACTION_REVIEW':'SECONDARY_CLOSE_REVIEW';
  return {ticker:r.ticker,date:r.date,category,markFrequency:n,scenarioCount:s,priorityScore:n*10+s*4+(category==='UNRESOLVED'?60:category==='CORPORATE_ACTION_REVIEW'?45:0),noProductionPriceFill:true};
 }).sort((a,b)=>b.priorityScore-a.priorityScore||a.ticker.localeCompare(b.ticker)||a.date.localeCompare(b.date));
}
if(require.main===module){
 const [rowsFile,marksFile,outFile='research-artifacts/gap-recovery-priority.json']=process.argv.slice(2);
 if(!rowsFile||!marksFile)throw Error('usage: node prioritize-gap-recovery.cjs gaps.json missing-marks.json [output.json]');
 const gaps=JSON.parse(fs.readFileSync(rowsFile,'utf8')),marks=JSON.parse(fs.readFileSync(marksFile,'utf8'));
 const result=rank(Array.isArray(gaps)?gaps:gaps.rows||gaps.pairs,Array.isArray(marks)?marks:marks.rows||marks.missingMarkDetails||[]);
 fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,JSON.stringify({schemaVersion:1,researchOnly:true,ranking:result},null,2)+'\n');
 console.log(JSON.stringify({ranked:result.length,highest:result.slice(0,5)}));
}
module.exports={rank};
