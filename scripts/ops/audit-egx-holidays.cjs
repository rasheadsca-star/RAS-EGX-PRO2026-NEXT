'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const iso=d=>/^\d{4}-\d{2}-\d{2}$/.test(d);
function audit(calendar,evidence){
 const rows=Array.isArray(calendar.sessions)?calendar.sessions:[];
 const raw=new Set(rows), discrepancies=[], quarantined=new Set(), closureDays=new Set();
 for(const holiday of evidence.closures||[]){
  if(holiday.status!=='confirmed_exchange_closure')continue;
  if(!iso(holiday.date)||!holiday.source)throw new Error('Invalid verified closure evidence');
  closureDays.add(holiday.date);
  if(raw.has(holiday.date)){quarantined.add(holiday.date);discrepancies.push({date:holiday.date,code:'HOLIDAY_MARKED_AS_SESSION',severity:'critical',source:holiday.source,action:'quarantine_and_verify_source_rows'});}
 }
 for(const d of rows){if(!iso(d))discrepancies.push({date:d,code:'INVALID_DATE',severity:'critical'});}
 const vetted=rows.filter(d=>iso(d)&&!closureDays.has(d));
 return {exchange:'EGX',timezone:'Africa/Cairo',auditedAt:new Date().toISOString(),inputSessions:rows.length,checkedClosures:(evidence.closures||[]).length,quarantinedDates:[...quarantined].sort(),eligibleSessionCount:vetted.length,latestEligibleSession:vetted.at(-1)||null,discrepancies,pass:discrepancies.length===0,policy:'Fail closed for confirmed exchange closures; preserve raw observations; reconcile source rows before downstream backtests.'};
}
if(require.main===module){
 const result=audit(load('data/session-calendar.json'),load('data/egx-exchange-closures.json'));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(process.argv.includes('--strict'))process.exitCode=result.pass?0:2;
}
module.exports={audit};
