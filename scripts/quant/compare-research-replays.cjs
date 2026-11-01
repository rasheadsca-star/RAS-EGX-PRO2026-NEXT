'use strict';
// Read-only fixed-trade comparison. No new prices or signals are written to history.
const fs=require('node:fs'),path=require('node:path');
function compare(dir='research-artifacts'){
 const rows=[],residual=[],symbols=new Set();
 for(const amount of [20000,100000])for(const scenario of ['low','medium','high']){
  const id=amount+'-'+scenario;
  const base=JSON.parse(fs.readFileSync(path.join(dir,'portfolio-'+id+'.json'),'utf8'));
  const evidence=JSON.parse(fs.readFileSync(path.join(dir,'evidence-portfolio-'+id+'.json'),'utf8'));
  if(base.accepted!==evidence.accepted||base.rejected!==evidence.rejected||
    Math.abs(base.endingEquityEgp-evidence.endingEquityEgp)>0.01)throw Error('Fixed trade cohort changed '+id);
  for(const m of evidence.missingMarkDetails||[]){residual.push({...m,scenario:id});symbols.add(m.ticker+'|'+m.date);}
  rows.push({scenario:id,accepted:base.accepted,baseMissingMarks:base.missingMarks,
    researchMissingMarks:evidence.missingMarks,marksResolved:base.missingMarks-evidence.missingMarks,
    researchEvidenceUses:evidence.researchMarkCount||0,baseMaxDrawdownPct:base.maxDrawdownPct,
    researchMaxDrawdownPct:evidence.maxDrawdownPct,endingEquityEgp:evidence.endingEquityEgp});
 }
 const result={schemaVersion:'1.0',researchOnly:true,productionPricesModified:0,cohortFixed:true,scenarios:rows,
  residualMarkCount:residual.length,residualUniqueTickerDates:symbols.size,residualDetails:residual,
  warning:'Multi-source nonofficial historical close is used only for research interim portfolio valuation; fees and fills remain simulated.'};
 fs.writeFileSync(path.join(dir,'evidence-replay-comparison.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({scenarios:rows.length,remainingMarks:residual.length,remainingKeys:symbols.size,marksResolved:rows.reduce((a,r)=>a+r.marksResolved,0)}));
 return result;
}
if(require.main===module)compare(process.argv[2]||'research-artifacts');
module.exports={compare};
