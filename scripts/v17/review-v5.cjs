#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r),OUT='data/v17/review.json';
const read=(r,d={})=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return d}};
function write(r,v){const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
const n=(v,d=0)=>{const x=Number(v);return Number.isFinite(x)?x:d},validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||'')),regular=d=>validDate(d)&&new Date(`${d}T12:00:00Z`).getUTCDay()<=4;
const base=cp.spawnSync(process.execPath,[P('scripts/v17/review.cjs')],{cwd:root,encoding:'utf8'}),baseReport=read(OUT,{findings:[]});
const findings=Array.isArray(baseReport.findings)?[...baseReport.findings]:[],add=(severity,code,message,location=null)=>findings.push({severity,code,message,location});
if(base.status!==0&&findings.length===0)add('CRITICAL','BASE_REVIEW_PROCESS_FAILURE',`exit=${base.status}; ${base.stderr||base.stdout||''}`.slice(0,500),'review.cjs');
const current=read('data/v17/current.json'),truth=read('data/v17/market-session-truth.json'),repair=read('data/v17/session-history-repair.json'),internal=read('data/v17/internal-ohlc-support-resistance.json'),liquidity=read('data/v17/liquidity-gate.json'),resilient=read('data/v17/resilient-session-status.json'),history50=read('data/history-50.json',{symbols:{}}),history=read('data/history.json',{sessionsBySymbol:{}});
const execution=resilient.executionGrade===true;
const s=regular(truth.selectedSessionDate)?truth.selectedSessionDate:null;
const executionTruth=Boolean(execution&&s&&truth.executionSafe===true&&truth.priceSourceVerified===true);
const researchTruth=Boolean(!execution&&s&&truth.researchSessionVerified===true);

if(execution){
  if(!executionTruth)add('CRITICAL','VERIFIED_PRICE_SESSION_REQUIRED',`selected=${truth.selectedSessionDate}; safe=${truth.executionSafe}; priceVerified=${truth.priceSourceVerified}`,'market-session-truth');
  else for(const [label,value] of [['snapshot',current.sessionDate],['internal',internal.referenceSessionDate],['liquidity',liquidity.referenceSessionDate],['history',history.sessionDate]])if(value!==s)add('CRITICAL','REVIEW_SESSION_CHAIN_MISMATCH',`${label}=${value}; expected=${s}`,label);
  if(repair.applied!==true||repair.verifiedSessionDate!==s)add('CRITICAL','REVIEW_HISTORY_REPAIR_MISSING',`applied=${repair.applied}; date=${repair.verifiedSessionDate}`,'session-history-repair');
}else{
  if(!researchTruth)add('CRITICAL','VERIFIED_RESEARCH_SESSION_REQUIRED',`selected=${truth.selectedSessionDate}; researchVerified=${truth.researchSessionVerified}; mode=${truth.selectionMode}`,'market-session-truth');
  else {
    for(const [label,value] of [['snapshot',current.sessionDate],['internal',internal.referenceSessionDate],['liquidity',liquidity.referenceSessionDate]])if(value!==s)add('CRITICAL','REVIEW_RESEARCH_SESSION_CHAIN_MISMATCH',`${label}=${value}; expected=${s}`,label);
    if(!regular(internal.levelSessionDate)||internal.levelSessionDate>s)add('CRITICAL','REVIEW_COMPLETED_LEVEL_SESSION_INVALID',`level=${internal.levelSessionDate}; research=${s}`,'internal-ohlc-support-resistance');
    if(validDate(history.sessionDate)&&history.sessionDate>s)add('CRITICAL','REVIEW_HISTORY_SESSION_FUTURE',`history=${history.sessionDate}; research=${s}`,'history');
    if(truth.executionSafe===true||truth.liveIntradayResearchEvidence?.eligible===true&&truth.policy?.liveIntradayResearchNeverQualifiesExecution!==true)add('CRITICAL','REVIEW_RESEARCH_EXECUTION_BOUNDARY_INVALID','intraday research evidence leaked into execution truth','market-session-truth');
  }
}
function scan(container,label){for(const [symbol,rows] of Object.entries(container||{}))for(const row of Array.isArray(rows)?rows:[]){const d=String(row?.date||'');if(!validDate(d))continue;if(!regular(d))add('MAJOR','REVIEW_WEEKEND_HISTORY_ROW',`${symbol}:${d}`,label);if(s&&d>s)add('CRITICAL','REVIEW_FUTURE_HISTORY_ROW',`${symbol}:${d} > ${s}`,label);}}
scan(history50.symbols,'history-50');scan(history.sessionsBySymbol,'history');
if(current?.finalization?.immutableSignalHashTouched!==false||current?.finalization?.ledgerTouched!==false||current?.finalization?.staleChampionCurrentWeightsZeroed!==true)add('CRITICAL','REVIEW_FINALIZER_ATTESTATION_INVALID',JSON.stringify(current.finalization||{}),'snapshot');
if(current?.championReference?.currentForMarketSession===false){if(n(current.championReference.plannedAllocationPct)!==0)add('MAJOR','REVIEW_HISTORICAL_CHAMPION_ALLOCATION_NONZERO',String(current.championReference.plannedAllocationPct),'championReference');for(const row of current.championReference.recommendations||[])if(n(row.portfolioWeightPct)!==0||n(row.basketWeightPct)!==0||row.executionAllowed===true||row.monitorOnly!==true)add('MAJOR','REVIEW_HISTORICAL_CHAMPION_CURRENT_SEMANTICS',row.ticker,'championReference');}
if(execution&&(!executionTruth||liquidity.gatePassed!==true||internal.executionCandidateReady!==true||resilient.sessionAligned!==true))add('CRITICAL','REVIEW_FALSE_EXECUTION_GRADE','execution grade lacks full source/SR/liquidity chain','resilient');
if(!execution&&(n(current?.portfolioPolicy?.plannedAllocationPct)!==0||n(current?.portfolioPolicy?.cashReservePct)!==100||(current.recommendations||[]).some(r=>n(r.portfolioWeightPct)!==0||r.executionAllowed===true||r.monitorOnly!==true)))add('CRITICAL','REVIEW_RESEARCH_EXPOSURE_LEAK','research/degraded mode must be all cash and watch only','snapshot');
const counts=findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]||0)+1,a),{CRITICAL:0,MAJOR:0,MINOR:0,INFO:0}),verdict=findings.length===0?'NO_COMMENTS':(counts.CRITICAL||counts.MAJOR?'REJECTED':'COMMENTS_FOUND');
const report={schemaVersion:'17.0.0-review-5',generatedAt:new Date().toISOString(),reviewer:'V17_CURRENT_SESSION_TRUTH_GATE_V5',verdict,counts,findings,checks:{...(baseReport.checks||{}),executionSessionTruth:executionTruth,researchSessionTruth:researchTruth,selectedSession:s,historyTemporalRepair:execution?repair.applied===true:true,sessionChainAligned:execution?Boolean(executionTruth&&current.sessionDate===s&&internal.referenceSessionDate===s&&liquidity.referenceSessionDate===s&&history.sessionDate===s):Boolean(researchTruth&&current.sessionDate===s&&internal.referenceSessionDate===s&&liquidity.referenceSessionDate===s),completedLevelSessionNotFuture:Boolean(regular(internal.levelSessionDate)&&(!s||internal.levelSessionDate<=s)),historicalChampionCurrentWeightsZero:current?.championReference?.currentForMarketSession!==false||n(current?.championReference?.plannedAllocationPct)===0,snapshotFinalizerAttested:current?.finalization?.immutableSignalHashTouched===false&&current?.finalization?.ledgerTouched===false&&current?.finalization?.staleChampionCurrentWeightsZeroed===true,zeroAllocationInNonExecutionMode:execution||n(current?.portfolioPolicy?.plannedAllocationPct)===0}};
write(OUT,report);console.log(JSON.stringify(report,null,2));if(findings.length)process.exitCode=2;
