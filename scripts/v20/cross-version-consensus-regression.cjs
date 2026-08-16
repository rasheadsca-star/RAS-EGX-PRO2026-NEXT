#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const file=process.env.V20_CONSENSUS_OUT_PATH||path.join(process.cwd(),'data/v20/cross-version-consensus.json');const x=JSON.parse(fs.readFileSync(file,'utf8'));const failures=[];const check=(ok,message)=>{if(!ok)failures.push(message);};
check(x.schemaVersion==='20.0.0-cross-version-consensus-1','schema mismatch');
check(x.scoreDefinition?.independentModelCount===2,'independent model count must remain 2');
check(x.scoreDefinition?.historicalPerformanceUsedInScore===false,'historical evidence must not alter score');
check(JSON.stringify(x.scoreDefinition?.values)===JSON.stringify({'0':0,'1':50,'2':100}),'score values drift');
check(x.governance?.displayPriorityOnly===true,'consensus must remain display priority only');
check(x.governance?.changesFinalDecision===false,'consensus must not change final decision');
check(x.governance?.changesExecutionPermission===false,'consensus must not change execution permission');
check(x.governance?.changesMainAppMethodology===false,'MAIN APP methodology must remain frozen');
check(x.governance?.changesV19Methodology===false,'V19 methodology must remain unchanged');
check(x.governance?.changesV20NativeRanking===false,'V20 Native ranking must remain unchanged');
check(x.governance?.v17RemainsProductionAuthority===true,'V17 production authority must remain intact');
check(x.governance?.v17CountedAsIndependentVote===false,'V17 mirror must not be double-counted');
check(x.governance?.v20NativeCountedAsIndependentVote===false,'V20 Native must not be counted in score v1');
check(Array.isArray(x.current?.rows),'current rows missing');
for(const row of x.current?.rows||[]){check([0,50,100].includes(row.consensusScore),`${row.ticker}: invalid score`);check(row.consensusScore===row.independentVotes*50,`${row.ticker}: vote score mismatch`);check(row.independentModelCount===2,`${row.ticker}: independentModelCount drift`);}
if(x.current?.sessionAligned===true){check(x.sessionDate===x.current.mainAppSessionDate&&x.sessionDate===x.current.v19SessionDate,'aligned session date mismatch');const expectedShared=(x.current.mainAppBasket||[]).filter(t=>(x.current.v19Selected||[]).includes(t)).sort();check(JSON.stringify(expectedShared)===JSON.stringify([...(x.current.sharedTickers||[])].sort()),'shared ticker set mismatch');}
const h=x.historicalEvidence;check(Number(h?.window?.sessions||0)>=20,'historical window too small');check(Number(h?.v16V19Consensus?.selections||0)>0,'no historical consensus rows');check(Number.isFinite(Number(h?.deltaConsensusVsV16Only?.avgCloseGrossPp)),'historical return delta missing');
const result={schemaVersion:'20.0.0-cross-version-consensus-regression-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,sessionDate:x.sessionDate,currentSharedTickers:x.current?.sharedTickers||[],currentFullMainAppBasketAgreement:x.current?.fullMainAppBasketAgreement===true,governancePreserved:failures.length===0};
const out=path.join(process.cwd(),'data/v20/cross-version-consensus-regression.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(failures.length)process.exit(1);
