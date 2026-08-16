#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const file=process.env.V20_MULTI_ENGINE_OUT||path.join(process.cwd(),'data/v20/multi-engine-consensus.json');const x=JSON.parse(fs.readFileSync(file,'utf8'));const failures=[];const check=(ok,m)=>{if(!ok)failures.push(m)};
check(x.schemaVersion==='20.0.0-multi-engine-consensus-1','schema mismatch');
check(x.scoreDefinition?.independentEngineCount===3,'independent engine count must be 3');
check(x.scoreDefinition?.formula==='independentVotes / 3 * 100','formula drift');
check(x.scoreDefinition?.historicalPerformanceUsedInScore===false,'historical evidence leaked into current score');
check(x.scoreDefinition?.changesMainAppRanking===false,'MAIN APP ranking must remain unchanged');
check(x.governance?.displayPriorityOnly===true,'must remain display priority only');
check(x.governance?.mainAppMethodologyFrozen===true,'MAIN APP methodology freeze missing');
check(x.governance?.changesMainAppRecommendation===false,'must not mutate MAIN APP recommendation');
check(x.governance?.changesFinalDecision===false,'must not mutate final decision');
check(x.governance?.changesExecutionPermission===false,'must not mutate execution permission');
check(x.governance?.v17RemainsProductionAuthority===true,'V17 authority drift');
const active=x.engineRegistry?.activeIndependent||[];check(active.length===3,'exactly three active independent confirmation engines expected');
check(active.some(e=>e.id==='V16_9_EQUAL_WEIGHT_BASKET'&&e.voteEligible===true),'MAIN APP engine missing');
check(active.some(e=>e.id==='V19_CHAT_GPT_NATIVE_CHALLENGER_V6'&&e.voteEligible===true),'V19 engine missing');
check(active.some(e=>e.id==='V20_FULL_MARKET_NATIVE_SELECTION_V1'&&e.voteEligible===true),'V20 Native engine missing');
const non=x.engineRegistry?.monitoredNonVotes||[];
const requiredHistorical=['V13_HISTORICAL_LINEAGE','V14_HISTORICAL_LINEAGE','V15_PRACTICAL_DECISION','V16_3_IMMEDIATE_SCAN','V16_6_TRIPLE_BARRIER','V16_7_COHERENT_ENGINE','V16_8_PRACTICAL_SELECTOR'];
for(const id of requiredHistorical)check(non.some(e=>e.id===id&&e.voteEligible===false),`${id} must be monitored without current vote`);
check(non.some(e=>e.id==='V17_PRODUCTION_VALIDATION_AUTHORITY'&&e.voteEligible===false),'V17 must be monitored but never double-counted');
check(non.some(e=>e.id==='V20_LIQ30_EXPERIMENT'&&e.voteEligible===false),'V20 Liq30 experiment must be tracked without canonical vote');
check(non.some(e=>e.id==='V21'&&e.status==='NOT_PRESENT'),'V21 absence must be explicit');
check(Number(x.engineRegistry?.monitoredEngineCount)===active.length+non.length,'monitored engine count mismatch');
for(const r of x.current?.rows||[]){check(r.independentEngineCount===3,`${r.ticker}: engine count drift`);check(r.independentVotes>=0&&r.independentVotes<=3,`${r.ticker}: invalid votes`);check(Math.abs(Number(r.confirmationScore)-Math.round((r.independentVotes/3*100)*100)/100)<0.001,`${r.ticker}: score mismatch`);}
for(const a of x.current?.mainAppAnnotations||[]){check(a.independentVotes>=1,`${a.ticker}: MAIN APP annotation must include MAIN APP vote`);check(typeof a.noteAr==='string'&&a.noteAr.length>20,`${a.ticker}: annotation missing`);}
if(x.current?.sessionAligned===true){check(Boolean(x.sessionDate),'aligned session missing date');}
const result={schemaVersion:'20.0.0-multi-engine-consensus-regression-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,sessionDate:x.sessionDate,monitoredEngineCount:x.engineRegistry?.monitoredEngineCount||0,currentIndependentEngines:active.map(e=>e.id),historicalAndNonVoteEngines:non.map(e=>({id:e.id,status:e.status})),mainAppAnnotations:(x.current?.mainAppAnnotations||[]).map(a=>({ticker:a.ticker,votes:a.independentVotes,score:a.confirmationScore,label:a.confirmationLabelAr})),governancePreserved:failures.length===0};
const out=path.join(process.cwd(),'data/v20/multi-engine-consensus-regression.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(failures.length)process.exit(1);
