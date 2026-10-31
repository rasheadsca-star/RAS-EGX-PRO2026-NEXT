'use strict';
const fs=require('node:fs'),path=require('node:path');
const folder=process.argv[2]||'research-artifacts';
const values=[20000,100000],scenarios=['low','medium','high'];
let failures=[],rows=[];
for(const amount of values)for(const scenario of scenarios){
 const file=path.join(folder,'breakout-'+amount+'-'+scenario+'.json');
 if(!fs.existsSync(file)){failures.push('missing '+file);continue;}
 const row=JSON.parse(fs.readFileSync(file,'utf8'));
 if(row.executionReady!==false||row.performanceCertified!==false)failures.push('unsafe flags '+file);
 if(row.amountEgp!==amount||row.scenario!==scenario)failures.push('mismatched identity '+file);
 if(row.actualPolicy?.orderValueEgp!==amount||row.actualPolicy?.slippageScenario!==scenario||row.actualPolicy?.costModel!=='thndr_invoice_2026_10_21'||row.actualPolicy?.liveExecutionEnabled!==false)failures.push('actual policy not proven '+file);
 if(!row.metrics||!Number.isFinite(row.metrics.closedTrades)||!Number.isFinite(row.metrics.averageR))failures.push('missing metrics '+file);
 rows.push(row);
}
const out={status:failures.length?'FAILED_INCOMPLETE':'RESEARCH_ONLY_UNCERTIFIED',validationErrors:failures,
 scenarios:rows.map(r=>({amountEgp:r.amountEgp,scenario:r.scenario,closedTrades:r.metrics?.closedTrades??null,averageR:r.metrics?.averageR??null,profitFactor:r.metrics?.profitFactor??null,latestMarketSession:r.latestMarketSession,performanceCertified:false}))};
fs.writeFileSync(path.join(folder,'comparison-summary.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
if(failures.length)process.exit(1);
