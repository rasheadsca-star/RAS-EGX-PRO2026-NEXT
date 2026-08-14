#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r),OUT='data/v17/destructive-critic.json';
const read=(r,d={})=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return d}},text=r=>{try{return fs.readFileSync(P(r),'utf8')}catch{return''}};
function write(r,v){const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
const n=(v,d=0)=>{const x=Number(v);return Number.isFinite(x)?x:d};
const base=cp.spawnSync(process.execPath,[P('scripts/v17/destructive-critic-v2.cjs')],{cwd:root,encoding:'utf8'});
const baseReport=read(OUT,{verdict:'COMMENTS_FOUND',findings:[{severity:'CRITICAL',code:'CRITIC_V2_NO_REPORT',message:base.stderr||'Critic V2 produced no report'}]});
const findings=Array.isArray(baseReport.findings)?[...baseReport.findings]:[];
const add=(severity,code,message,location=null)=>findings.push({severity,code,message,location});
const current=read('data/v17/current.json'),truth=read('data/v17/market-session-truth.json'),repair=read('data/v17/session-history-repair.json'),resilient=read('data/v17/resilient-session-status.json'),workflow=text('.github/workflows/update-market-data.yml'),buildReview=text('.github/workflows/v17-build-review.yml');
if(base.status!==0&&Number(baseReport.totalFindings||0)===0)add('CRITICAL','CRITIC_V2_PROCESS_FAILURE',`exit=${base.status}; ${base.stderr||base.stdout||''}`.slice(0,500),'critic-v2');
if(current?.championReference?.currentForMarketSession===false){
  if(n(current.championReference.plannedAllocationPct)!==0)add('MAJOR','HISTORICAL_CHAMPION_CURRENT_ALLOCATION_NONZERO',`plannedAllocationPct=${current.championReference.plannedAllocationPct}`,'championReference');
  for(const row of current.championReference.recommendations||[]){
    if(n(row.portfolioWeightPct)!==0||n(row.basketWeightPct)!==0||n(row.currentSessionWeightPct)!==0)add('MAJOR','HISTORICAL_CHAMPION_CURRENT_WEIGHT_NONZERO',`${row.ticker}: portfolio=${row.portfolioWeightPct}; basket=${row.basketWeightPct}; current=${row.currentSessionWeightPct}`,'championReference');
    if(n(row.historicalPortfolioWeightPct)<0||n(row.historicalBasketWeightPct)<0)add('MINOR','HISTORICAL_CHAMPION_INVALID_ARCHIVE_WEIGHT',row.ticker,'championReference');
  }
}
if(current?.finalization?.staleChampionCurrentWeightsZeroed!==true)add('MAJOR','FINALIZER_DID_NOT_ATTEST_ZEROED_HISTORICAL_WEIGHTS','missing finalization attestation','snapshot');
if(truth.executionSafe===true&&repair.applied!==true)add('CRITICAL','VERIFIED_SESSION_WITHOUT_HISTORY_REPAIR',truth.selectedSessionDate,'session-chain');
if(resilient.executionGrade===false&&current?.status!=='RESEARCH_READY_EXECUTION_BLOCKED')add('MAJOR','DEGRADED_STATUS_PRESENTATION_MISMATCH',`snapshot=${current?.status}; executionGrade=${resilient.executionGrade}`,'snapshot');
if(!workflow.includes('destructive-critic-v3.cjs'))add('MAJOR','CRITIC_V3_NOT_MANDATORY_MARKET','market workflow does not run Critic V3','workflow');
if(buildReview&&!buildReview.includes('destructive-critic-v3.cjs'))add('MAJOR','CRITIC_V3_NOT_MANDATORY_BUILD_REVIEW','build review does not run Critic V3','v17-build-review');
const counts=findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]||0)+1,a),{CRITICAL:0,MAJOR:0,MINOR:0,INFO:0});
const report={schemaVersion:'17.0.0-destructive-critic-3',generatedAt:new Date().toISOString(),critic:'V17_DESTRUCTIVE_ADVERSARIAL_REVIEWER_V3',verdict:findings.length===0?'NO_COMMENTS':'COMMENTS_FOUND',counts,totalFindings:findings.length,findings,baseCritic:{schemaVersion:baseReport.schemaVersion||null,verdict:baseReport.verdict||null,totalFindings:Number(baseReport.totalFindings||0)},coverage:{...(baseReport.coverage||{}),historicalAllocationSemantics:true,finalizerAttestation:true,dualWorkflowCriticEnforcement:true},rule:'Critic V3 is additive: Critic V2 must be clean and all new release/allocation checks must also have zero findings.'};
write(OUT,report);console.log(JSON.stringify(report,null,2));if(findings.length)process.exitCode=2;
