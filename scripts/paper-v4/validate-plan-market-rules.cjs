#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const data=JSON.parse(fs.readFileSync(path.join(root,'paper-v4/latest-ranking.json'),'utf8'));
const report={schemaVersion:'1.0',checkedAt:new Date().toISOString(),session:data.session,rows:data.rows?.length||0,
  source:data.source?.provider||'unknown',status:'RESEARCH_ONLY_NOT_EXECUTION_APPROVED',checks:{},counts:{},failures:[],warnings:[],
  referenceSources:[
    'https://tg.efghermes.com/Market/GetById/1103',
    'https://support.thndr.app/en/articles/638561-what-determines-the-execution-price-of-a-stock-order-in-egx'
  ],verifiedRules:'Indicative tick 0.001 for price < 2 EGP; 0.01 for price >= 2 EGP. Main market theoretical day band ±20%. SME market may be ±10%; category unverified.',
  blockedExecutionReasons:['Instrument identity/ISIN not independently certified','Board-specific session price limits not independently certified','Broker commission and slippage not certified','No tested/signed-off strategy']};
const n=(k)=>report.counts[k]=(report.counts[k]||0)+1;
const eqGrid=v=>{const tick=v<2?.001:.01;return Math.abs(Math.round(v/tick)*tick-v)<1e-7};
if(data.qualifiedTradeCount!==0||!String(data.mode).includes('RESEARCH'))report.failures.push('Unsafe trading readiness declaration');
if(!Array.isArray(data.rows)||!data.rows.length)report.failures.push('No research rows');
for(const row of data.rows||[]){
  if(row.recommendation!=='WATCH_ONLY')report.failures.push(row.ticker+': unauthorized recommendation');
  if(row.sourceSession!==data.session)report.failures.push(row.ticker+': stale session');
  if(!Array.isArray(row.scenarios)||row.scenarios.length===0)report.failures.push(row.ticker+': missing plans');
  for(const plan of row.scenarios||[]){
    n(plan.status||'UNKNOWN');
    if(plan.isExecutable!==false)report.failures.push(row.ticker+': trade execution enabled');
    if(!Number.isFinite(plan.entry)){
      if(!String(plan.status).startsWith('REJECTED_'))report.failures.push(row.ticker+': missing prices in accepted plan');
      continue;
    }
    const {entry,stop,target1,target2}=plan;
    for(const k of ['entry','stop','target1','target2'])if(!eqGrid(plan[k]))report.failures.push(row.ticker+': '+k+' not on EGX reference tick grid');
    if(!(stop<entry&&entry<target1&&target1<target2))report.failures.push(row.ticker+': invalid price ordering');
    const risk=entry-stop;
    if(risk/entry>.12000001||risk/entry<.00349999)report.failures.push(row.ticker+': research risk budget violation');
    if(Math.abs((target1-entry)/risk-plan.rewardRisk1)>.0011||Math.abs((target2-entry)/risk-plan.rewardRisk2)>.0011)
      report.failures.push(row.ticker+': R/R inconsistent with tick-rounded prices');
    if(plan.executionGuards?.isinConfirmed!==false||plan.executionGuards?.instrumentPriceLimitConfirmed!==false)
      report.failures.push(row.ticker+': unjustified execution certification');
    const histFile=path.join(root,'data/history',row.ticker+'.json');
    if(fs.existsSync(histFile)){
      const hist=JSON.parse(fs.readFileSync(histFile,'utf8'));
      const prev=hist.sessions?.filter(s=>s.date<data.session).sort((a,b)=>b.date.localeCompare(a.date))[0];
      if(prev?.close>0 && entry>prev.close*1.2+.005)report.failures.push(row.ticker+': theoretical 20% band violated');
      if(hist.currency&&hist.currency!=='EGP')report.failures.push(row.ticker+': unsupported currency '+hist.currency);
    }
    n('NUMERIC_SCENARIOS');
  }
}
report.checks={tickGridAndRiskChecked:true,previousClose20PercentScreenChecked:true,
 SME10PercentBoardNotVerified:true,actualTradingCertification:false,officialCloseVerified:false};
if(report.failures.length){report.status='FAILED_RESEARCH_RULES_AUDIT'}
fs.writeFileSync(path.join(root,'paper-v4/market-rules-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,session:report.session,rows:report.rows,counts:report.counts,failures:report.failures.slice(0,20)}));
if(report.failures.length)process.exit(2);
