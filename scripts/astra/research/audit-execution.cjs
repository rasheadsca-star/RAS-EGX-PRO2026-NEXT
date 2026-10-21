'use strict';
// Reproduce legacy accounting from the checked-in comparison without running its
// network/RC2 integration, then replay the same preserved signals and price bars.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {evaluatePlan,summarize}=require('./execution-replay.cjs');
const root=path.resolve(__dirname,'../../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const legacySource=fs.readFileSync(path.join(root,'scripts/astra/astra-claude-retrospective-comparison.mjs'),'utf8');
const start=legacySource.indexOf('function fill('),end=legacySource.indexOf('function currentAstra(');
if(start<0||end<start)throw new Error('Legacy replay boundaries changed; review audit adapter');
const source=read('data/stable/v16-v169-live-evaluation.json');
const sessions=source.sessions.filter(s=>s.status==='RESOLVED').sort((a,b)=>a.signalDate.localeCompare(b.signalDate));
const asOf=read('astra-prod/app/data.json').sourceDecision.session;
const signals=sessions.flatMap(s=>s.members.map((m,i)=>({ticker:m.ticker,signalDate:s.signalDate,rank:i+1,
  entryLow:Number(m.entryLow),entryHigh:Number(m.entryHigh),stop:Number(m.stopLoss),target1:Number(m.target1)})))
  .filter(s=>[s.entryLow,s.entryHigh,s.stop,s.target1].every(Number.isFinite));
const history=new Map(),metadata=[];
for(const ticker of new Set(signals.map(s=>s.ticker))){
 const d=read('data/history/'+ticker+'.json');
 const rows=(d.sessions||d.rows||[]).map(b=>({...b,date:String(b.date||b.sessionDate||'').slice(0,10),
   open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)}))
   .filter(b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&b.date<=asOf&&[b.open,b.high,b.low,b.close].every(Number.isFinite))
   .sort((a,b)=>a.date.localeCompare(b.date));
 history.set(ticker,rows);
 metadata.push({ticker,rows:rows.length,lastDate:rows.at(-1)?.date,
   warnings:d.warnings||[],validationStatus:d.validationStatus||null,
   sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')});
}
const round=(v,n=4)=>Number.isFinite(Number(v))?Number(Number(v).toFixed(n)):null;
const context={historyRows:ticker=>history.get(ticker),round,
  avg:a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null,pct:(n,d)=>d?round(n/d*100,2):null};
vm.createContext(context);vm.runInContext(legacySource.slice(start,end),context);
const policy={entryExpirySessions:3,maxHoldSessions:10,roundTripCostPct:0.6};
const baseline=context.sequentialAstraEpisodes(signals,policy);
const candidate=[],blocked=new Map();
for(const signal of [...signals].sort((a,b)=>a.signalDate.localeCompare(b.signalDate)||a.ticker.localeCompare(b.ticker))){
 const until=blocked.get(signal.ticker);
 if(until&&signal.signalDate<=until){candidate.push({...signal,state:'SUPPRESSED_OVERLAP',blockedThrough:until});continue;}
 const result=evaluatePlan(signal,history.get(signal.ticker),policy);
 candidate.push(result);blocked.set(signal.ticker,result.blockedThrough);
}
const key=s=>s.ticker+':'+s.signalDate;
const oldBy=new Map(baseline.map(s=>[key(s),s]));
const changes=candidate.flatMap(s=>{
 const old=oldBy.get(key(s)),oldState=old.state==='ENTERED'?'CLOSED':old.state;
 if(oldState===s.state&&old.outcome===s.outcome&&round(old.netPct,2)===round(s.netPct,2))return[];
 return[{ticker:s.ticker,signalDate:s.signalDate,before:{state:old.state,outcome:old.outcome||null,netPct:old.netPct??null},
   after:{state:s.state,outcome:s.outcome||null,netPct:s.netPct??null,exitPrice:s.exitPrice??null}}];
});
const report={schemaVersion:'execution-audit-1',asOf,
 window:{first:sessions[0].signalDate,last:sessions.at(-1).signalDate},policy,
 legacySourceSha256:crypto.createHash('sha256').update(legacySource).digest('hex'),
 limitations:['Research accounting audit, not a live strategy performance certificate',
 'Same saved signals and prices; history-continuity changes to signal generation are not included',
 'Unreconciled history warnings remain; no source quality certification',
 'Daily OHLC cannot establish all intraday paths; ambiguous entries excluded and block later entries',
 'Neutral 3-session entry and 10-session hold differ from native basket policy',
 '0.6% flat round-trip cost; no calibrated spread or additional market-impact model',
 'No corrected RC2 comparison is claimed'],
 baseline:context.summarizeEpisodes(baseline),candidate:summarize(candidate),changes,history:metadata,episodes:candidate};
fs.writeFileSync(path.join(root,'docs/astra/EXECUTION_AUDIT_2026-09-29.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({asOf,baseline:report.baseline,candidate:report.candidate,changes},null,2));
