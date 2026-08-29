#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'..');
cp.execFileSync(process.execPath,[path.join(__dirname,'build-consensus.cjs')],{cwd:ROOT,stdio:'inherit'});
const out=JSON.parse(fs.readFileSync(path.join(__dirname,'data','current.json'),'utf8'));
const fail=m=>{throw new Error(m)};
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
if(out.mode!=='RESEARCH_SHADOW_ONLY')fail('research-only lock missing');
if(out.executionLocks?.executionAllowed!==false||out.executionLocks?.automaticOrders!==false||out.executionLocks?.automaticPromotion!==false)fail('execution lock regression');
if(out.dataReadiness?.policy?.missingData!=='UNKNOWN_NEVER_ZERO')fail('missing-data policy regression');
if(out.dataReadiness?.policy?.currentVolumeObservationsRequired!==21)fail('GANN volume readiness must require current + prior 20 observations');
if(out.dataReadiness?.policy?.historySummaryIdentityRequired!==true)fail('identity readiness gate missing');
if(out.sources?.V16_9?.source!=='data/stable/v15-practical-decision.json')fail('V16.9 source is not the actual V16.9 UI source');
if(out.sources?.GANN_FUSION_X?.source!=='CURRENT_GANN_CODE_RECOMPUTED_ON_SHARED_READY_SET')fail('GANN must be recomputed from current code on the shared READY set');
if(out.threeOfThree?.length&&!out.allSourcesFresh)fail('3/3 exposed while a source is stale');
if(out.allSourcesFresh){for(const s of Object.values(out.sources)){if(s.session!==out.marketSession)fail('fresh source session mismatch')}}
for(const r of out.rows||[]){
  if(r.ready!==true)fail('non-ready ticker entered consensus');
  if(!['1/3','2/3','3/3'].includes(r.consensus))fail('bad consensus label');
  if(r.consensus==='3/3'&&Object.values(r.engines||{}).some(e=>e.present!==true))fail('false 3/3');
  const g=r.engines?.GANN_FUSION_X;
  if(g?.present&&g.decision==='ACTIONABLE'){
    const p=g.tradePlan;
    if(!p||p.completeness!=='FULL')fail(`${r.ticker}: actionable GANN signal missing FULL trade plan`);
    for(const k of ['entryLow','entryHigh','trigger','stopLoss','target1','target2','target3'])if(!finite(p[k]))fail(`${r.ticker}: actionable GANN plan missing ${k}`);
    if(!(Number(p.stopLoss)<Number(p.referenceEntry)&&Number(p.target1)>Number(p.referenceEntry)))fail(`${r.ticker}: invalid GANN price geometry`);
  }
  if(r.consensusPlan?.source==='GANN_FUSION_X'&&r.consensusPlan?.completeness!=='FULL')fail(`${r.ticker}: selected GANN consensus plan is incomplete`);
}
if((out.dataReadiness?.ready||0)+(out.dataReadiness?.quarantined||0)!==out.dataReadiness?.total)fail('readiness totals do not reconcile');
console.log(JSON.stringify({ok:true,marketSession:out.marketSession,allSourcesFresh:out.allSourcesFresh,ready:out.dataReadiness.ready,quarantined:out.dataReadiness.quarantined,reasonCounts:out.dataReadiness.reasonCounts,sources:out.sources,threeOfThree:(out.threeOfThree||[]).map(x=>x.ticker),twoOfThree:(out.twoOfThree||[]).map(x=>x.ticker),tradePlanCoverage:(out.rows||[]).filter(x=>x.consensusPlan).length},null,2));
