#!/usr/bin/env node
'use strict';
/* V18 forward-ledger integrity: audit only, never infer live execution or promote decisions. */
const fs=require('node:fs');
const path=require('node:path');
function audit(doc){
 if(!doc||!Array.isArray(doc.entries))throw Error('Missing V18 entries');
 const problems=[],dates=[],identities=new Set(),statuses={},families={},ambiguous=[];
 for(let i=0;i<doc.entries.length;i++){
  const row=doc.entries[i],a=row?.issued||{},out=row?.futurePerformance||{};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(a.sessionId||''))problems.push({i,reason:'bad_session'});
  if(!/^[A-Z0-9.\-]{2,16}$/.test(a.ticker||''))problems.push({i,reason:'bad_symbol'});
  if(a.sessionId)dates.push(a.sessionId);
  const key=a.sessionId+':'+a.ticker;
  if(identities.has(key))problems.push({i,reason:'duplicate_session_ticker',key});else identities.add(key);
  const p=a.preferredPlan||{};
  if(p.entryLow!=null&&p.entryHigh!=null&&(+p.entryLow<=0||+p.entryHigh<+p.entryLow))problems.push({i,reason:'invalid_entry'});
  for(const f of a.strategyFamilies||[])families[f]=(families[f]||0)+1;
  const status=out.status||'NOT_RECORDED';statuses[status]=(statuses[status]||0)+1;
  if(out.outcome==='TARGET'||out.outcome==='STOP'||/HIT/.test(status)){
   ambiguous.push({key,status,outcome:out.outcome||null,executionConfirmed:row.executionConfirmed===true});
  }
 }
 return {schemaVersion:doc.schemaVersion,entries:doc.entries.length,uniqueSignals:identities.size,firstSession:dates.sort()[0]||null,lastSession:dates.at(-1)||null,problemCount:problems.length,problems:problems.slice(0,40),families,statuses,apparentOutcomeCount:ambiguous.length,verifiedLiveExecutions:0,note:'Reference OHLC outcome does not establish a filled paper/live order. Same-bar stop/target cannot be resolved without intraday sequence; never treat TARGET1_HIT as validated win.'};
}
if(require.main===module){
 const file=process.argv[2]||'data/stable/v18-forward-ledger.json';
 const obj=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
 const result=audit(obj);process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result.problemCount)process.exitCode=1;
}
module.exports={audit};
