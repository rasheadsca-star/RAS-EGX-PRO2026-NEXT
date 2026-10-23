'use strict';
// Read-only retrospective audit. Never changes raw market candles.
// Run: node scripts/ops/audit-egx-holidays.cjs
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function audit(sessionCalendar,closures){
  const dateSet=new Set(sessionCalendar.sessions||[]);
  const discrepancies=[];
  for(const closure of closures.closures||[]){
    if(closure.status!=='confirmed_exchange_closure')continue;
    if(dateSet.has(closure.date))discrepancies.push({date:closure.date,code:'HOLIDAY_MARKED_AS_SESSION',severity:'critical',source:closure.source,action:'quarantine_and_verify_source_rows'});
  }
  return {exchange:'EGX',timezone:'Africa/Cairo',auditedAt:new Date().toISOString(),checkedClosures:(closures.closures||[]).length,discrepancies,pass:discrepancies.length===0,policy:'Quarantine conflicting bars, preserve raw records, require official/exchange evidence before backtesting or signaling.'};
}
if(require.main===module){
  const result=audit(load('data/session-calendar.json'),load('data/egx-exchange-closures.json'));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  process.exitCode=result.pass?0:2;
}
module.exports={audit};
