#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const file=process.env.V20_MULTI_ENGINE_OUT||path.join(process.cwd(),'data/v20/multi-engine-consensus.json');const x=JSON.parse(fs.readFileSync(file,'utf8'));const failures=[];const check=(ok,m)=>{if(!ok)failures.push(m)};
check(x.schemaVersion==='20.1.0-method-independent-consensus-1','schema mismatch');
check(x.scoreDefinition?.independentEngineCount===2,'independent engine count must be 2');
check(x.scoreDefinition?.formula==='independentVotes / 2 * 100','formula drift');
check(x.scoreDefinition?.historicalPerformanceUsedInScore===false,'historical evidence leaked into current score');
check(x.scoreDefinition?.changesMainAppRanking===false,'MAIN APP ranking must remain unchanged');
check(x.governance?.displayPriorityOnly===true,'must remain display priority only');
check(x.governance?.mainAppMethodologyFrozen===true,'MAIN APP methodology freeze missing');
check(x.governance?.changesMainAppRecommendation===false,'must not mutate MAIN APP recommendation');
check(x.governance?.changesFinalDecision===false,'must not mutate final decision');
check(x.governance?.changesExecutionPermission===false,'must not mutate execution permission');
check(x.governance?.v17RemainsProductionAuthority===true,'V17 authority drift');
const active=x.engineRegistry?.activeIndependent||[];check(active.length===2,'exactly two current method-independent engines expected');
check(active.some(e=>e.id==='V16_9_EQUAL_WEIGHT_BASKET'&&e.voteEligible===true&&e.alphaFamily==='CALIBRATED_TOP10_PROBABILITY'),'MAIN APP independent engine missing');
check(active.some(e=>e.id==='V20_FULL_MARKET_NATIVE_SELECTION_V1'&&e.voteEligible===true&&e.alphaFamily==='MULTI_COMPONENT_EVIDENCE_COMPOSITE'),'V20 Native independent engine missing');
check(!active.some(e=>e.id==='V19_CHAT_GPT_NATIVE_CHALLENGER_V6'),'V19 must not be counted as independent alpha vote');
const related=x.engineRegistry?.relatedCorroborators||[];check(related.some(e=>e.id==='V19_CHAT_GPT_NATIVE_CHALLENGER_V6'&&e.voteEligible===false&&e.corroborationEligible===true),'V19 same-family corroboration classification missing');
check(x.engineIndependenceAudit?.conclusion==='CURRENT_INDEPENDENT_VOTES_ARE_MAIN_APP_AND_V20_NATIVE_ONLY','independence conclusion drift');
const non=x.engineRegistry?.monitoredNonVotes||[];check(non.some(e=>e.id==='V17_PRODUCTION_VALIDATION_AUTHORITY'&&e.voteEligible===false),'V17 must be monitored but never counted');check(non.some(e=>e.id==='V21'&&e.status==='NOT_PRESENT'),'V21 absence must be explicit');
for(const r of x.current?.rows||[]){check(r.independentEngineCount===2,`${r.ticker}: engine count drift`);check(r.independentVotes>=0&&r.independentVotes<=2,`${r.ticker}: invalid votes`);check(Math.abs(Number(r.confirmationScore)-Math.round((r.independentVotes/2*100)*100)/100)<0.001,`${r.ticker}: score mismatch`);}
for(const a of x.current?.mainAppAnnotations||[]){check(a.independentVotes>=1,`${a.ticker}: MAIN APP vote missing`);check(typeof a.noteAr==='string'&&a.noteAr.length>20,`${a.ticker}: annotation missing`);}
if(x.current?.sessionAligned===true)check(Boolean(x.sessionDate),'aligned session missing date');
const result={schemaVersion:'20.1.0-method-independent-consensus-regression-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,sessionDate:x.sessionDate,monitoredEngineCount:x.engineRegistry?.monitoredEngineCount||0,currentIndependentEngines:active.map(e=>e.id),sameFamilyCorroborators:related.map(e=>e.id),mainAppAnnotations:(x.current?.mainAppAnnotations||[]).map(a=>({ticker:a.ticker,votes:a.independentVotes,score:a.confirmationScore,label:a.confirmationLabelAr,relatedCorroborators:a.relatedCorroborators||[]})),governancePreserved:failures.length===0,methodIndependenceEnforced:failures.length===0};
const out=path.join(process.cwd(),'data/v20/multi-engine-consensus-regression.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(failures.length)process.exit(1);
