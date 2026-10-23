'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function check(ledger,report,calendar){
 const closures=new Set((calendar.closures||[]).filter(x=>x.status==='confirmed_exchange_closure'&&x.source).map(x=>x.date));
 const bad=[],rows=ledger.records||[];
 for(const r of rows){
  const hits=[r.entryDate,r.exitDate,...(r.evaluationWindowDates||[])].filter(d=>d&&closures.has(d));
  if(hits.length)bad.push({id:r.id,issue:'CLOSED_DATE_IN_TRADE',dates:[...new Set(hits)]});
 }
 const summary=report.summary||{};
 if((report.records||[]).length!==rows.length)bad.push({issue:'RECORD_COUNT_MISMATCH'});
 const resolved=rows.filter(r=>['TARGET_HIT','STOP_HIT','STOP_HIT_AMBIGUOUS_CONSERVATIVE','EXPIRED_POSITIVE','EXPIRED_NEGATIVE','EXPIRED_FLAT'].includes(r.evaluationStatus));
 const profitable=resolved.filter(r=>['TARGET_HIT','EXPIRED_POSITIVE'].includes(r.evaluationStatus));
 const rate=resolved.length?Number((profitable.length/resolved.length*100).toFixed(2)):null;
 if(summary.resolvedTrades!==resolved.length)bad.push({issue:'RESOLVED_COUNT_MISMATCH',expected:resolved.length,reported:summary.resolvedTrades});
 if(summary.successRatePct!==rate)bad.push({issue:'WIN_RATE_MISMATCH',expected:rate,reported:summary.successRatePct});
 return {pass:bad.length===0,records:rows.length,closedDates:closures.size,failures:bad};
}
if(require.main===module){
 const result=check(read('data/stable/v15-recommendation-ledger.json'),read('data/stable/v15-recommendation-evaluation.json'),read('data/egx-exchange-closures.json'));
 console.log(JSON.stringify(result,null,2));
 if(!result.pass)process.exitCode=2;
}
module.exports={check};
