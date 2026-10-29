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
  if(raw.has(holiday.date)){quarantined.add(holiday.date);discrepancies.push({date:holiday.date,code:'RAW_CLOSURE_OBSERVATION_QUARANTINED',severity:'review',source:holiday.source,action:'retain_raw_for_source_review'});}
 }
 const isClosed=d=>[5,6].includes(new Date(d+'T00:00:00Z').getUTCDay())||closureDays.has(d);
 const vetted=rows.filter(d=>iso(d)&&!isClosed(d));
 const hasEligible=Array.isArray(calendar.eligibleSessions);
 const effective=hasEligible?calendar.eligibleSessions:vetted;
 for(const d of rows){if(!iso(d))discrepancies.push({date:d,code:'INVALID_RAW_DATE',severity:'critical'});}
 for(const d of effective){if(!iso(d)||isClosed(d)||!raw.has(d))discrepancies.push({date:d,code:'INELIGIBLE_DATE_IN_TRADING_CALENDAR',severity:'critical'});}
 if(hasEligible&&JSON.stringify(effective)!==JSON.stringify(vetted))discrepancies.push({code:'ELIGIBLE_CALENDAR_MISMATCH',severity:'critical'});
 if(hasEligible&&JSON.stringify(calendar.quarantinedClosedDates||[])!==JSON.stringify(rows.filter(d=>!vetted.includes(d))))discrepancies.push({code:'QUARANTINE_LIST_MISMATCH',severity:'critical'});
 return {exchange:'EGX',timezone:'Africa/Cairo',auditedAt:new Date().toISOString(),inputSessions:rows.length,checkedClosures:(evidence.closures||[]).length,quarantinedDates:[...quarantined].sort(),eligibleSessionCount:effective.length,latestEligibleSession:effective.at(-1)||null,discrepancies,pass:!discrepancies.some(x=>x.severity==='critical'),policy:'Raw closure observations remain review findings; only unsafe eligible calendar or invalid raw dates block the execution calendar.'};
}
if(require.main===module){
 const result=audit(load('data/session-calendar.json'),load('data/egx-exchange-closures.json'));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(process.argv.includes('--strict'))process.exitCode=result.pass?0:2;
}
module.exports={audit};
