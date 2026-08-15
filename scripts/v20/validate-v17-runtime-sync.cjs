#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
const read=(r,f={})=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return f}};
const write=(r,v)=>{const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,`${JSON.stringify(v,null,2)}\n`,'utf8')};
const rows=v=>Array.isArray(v)?v:(Array.isArray(v?.rows)?v.rows:Array.isArray(v?.data)?v.data:Array.isArray(v?.recommendations)?v.recommendations:[]);
const sha256File=r=>crypto.createHash('sha256').update(fs.readFileSync(P(r))).digest('hex');
const sourceSha=String(process.env.V20_V17_RUNTIME_SOURCE_SHA||'').trim(),sourceCommitDate=String(process.env.V20_V17_RUNTIME_SOURCE_DATE||'').trim();
const CHAMPION='V16_9_EQUAL_WEIGHT_BASKET';
const required=[
 'data/market.json','data/final-opportunity-ranking.json','data/history.json',
 'data/v17/current.json','data/v17/resilient-session-status.json','data/v17/internal-ohlc-support-resistance.json','data/v17/liquidity-gate.json','data/v17/challenger-status.json','data/v17/market-session-truth.json','data/v17/regression.json','data/v17/review.json'
];
const failures=[];const check=(ok,code,detail=null)=>{if(!ok)failures.push({code,detail})};
check(/^[0-9a-f]{40}$/.test(sourceSha),'V17_RUNTIME_SOURCE_SHA_INVALID',sourceSha||null);
for(const rel of required)check(fs.existsSync(P(rel)),`V17_RUNTIME_REQUIRED_FILE_MISSING_${rel.replace(/[^A-Za-z0-9]+/g,'_')}`);
const market=read('data/market.json'),ranking=read('data/final-opportunity-ranking.json'),history=read('data/history.json'),current=read('data/v17/current.json'),gate=read('data/v17/resilient-session-status.json'),sr=read('data/v17/internal-ohlc-support-resistance.json'),liq=read('data/v17/liquidity-gate.json'),challenger=read('data/v17/challenger-status.json'),truth=read('data/v17/market-session-truth.json'),reg=read('data/v17/regression.json'),review=read('data/v17/review.json');
const session=truth.selectedSessionDate||gate?.priceTruth?.verifiedSessionDate||gate.sessionDate||current.sessionDate||market.sessionDate||history.sessionDate||null;
check(/^\d{4}-\d{2}-\d{2}$/.test(String(session||'')),'V17_RUNTIME_SESSION_MISSING',session);
check(current.sessionDate===session,'V17_CURRENT_SESSION_MISMATCH',current.sessionDate);
check((gate?.priceTruth?.verifiedSessionDate||gate.sessionDate)===session,'V17_GATE_SESSION_MISMATCH',gate?.priceTruth?.verifiedSessionDate||gate.sessionDate);
check(truth.selectedSessionDate===session,'V17_TRUTH_SESSION_MISMATCH',truth.selectedSessionDate);
if(market.sessionDate)check(market.sessionDate===session,'V17_MARKET_SESSION_MISMATCH',market.sessionDate);
if(history.sessionDate)check(history.sessionDate===session,'V17_HISTORY_SESSION_MISMATCH',history.sessionDate);
check(['HEALTHY','DEGRADED','RESEARCH_ONLY'].includes(gate.status),'V17_RUNTIME_GATE_STATUS_UNACCEPTABLE',gate.status);
check(gate.sessionAligned===true,'V17_RUNTIME_GATE_NOT_SESSION_ALIGNED');
check(current.engine?.id===CHAMPION,'V17_RUNTIME_CURRENT_CHAMPION_DRIFT',current.engine?.id);
check(challenger.activeEngine===CHAMPION,'V17_RUNTIME_CHALLENGER_CHAMPION_DRIFT',challenger.activeEngine);
check(challenger.promotionAllowed===false,'V17_RUNTIME_PROMOTION_ALLOWED');
check(challenger.criteria?.automaticPromotionForbidden===true,'V17_RUNTIME_AUTOMATIC_PROMOTION_GUARD_MISSING');
check(reg.ok===true&&Number(reg.failedCount||0)===0&&Number(reg.criticalFailedCount||0)===0,'V17_RUNTIME_REGRESSION_NOT_GREEN',{ok:reg.ok,failedCount:reg.failedCount,criticalFailedCount:reg.criticalFailedCount});
check(review.verdict==='NO_COMMENTS'&&Object.values(review.counts||{}).every(v=>Number(v||0)===0),'V17_RUNTIME_REVIEW_NOT_CLEAN',{verdict:review.verdict,counts:review.counts});
check(rows(market).length>0,'V17_RUNTIME_MARKET_EMPTY');
check(rows(ranking).length>0,'V17_RUNTIME_RANKING_EMPTY');
check(rows(sr).length>0,'V17_RUNTIME_SR_EMPTY');
check(rows(liq).length>0||Array.isArray(liq.executionEligibleSymbols),'V17_RUNTIME_LIQUIDITY_EMPTY');
check(Object.keys(history.sessionsBySymbol||{}).length>0,'V17_RUNTIME_HISTORY_EMPTY');
const fileEvidence=required.filter(r=>fs.existsSync(P(r))).map(r=>({path:r,sha256:sha256File(r),bytes:fs.statSync(P(r)).size}));
const out={
 schemaVersion:'20.0.0-v17-runtime-sync-1',generatedAt:new Date().toISOString(),ok:failures.length===0,failedCount:failures.length,failures,
 source:{repository:'rasheadsca-star/RAS-EGX-PRO2026-NEXT',branch:'develop/v17-rebuild',commitSha:sourceSha,commitDate:sourceCommitDate||null,fetchMode:'RUNTIME_READ_ONLY_WHITELIST'},
 sessionDate:session,
 governance:{activeChampion:CHAMPION,v17GateStatus:gate.status,v17ExecutionGrade:gate.executionGrade===true,v17SessionAligned:gate.sessionAligned===true,promotionAllowed:false,automaticPromotion:false,v20MayMutateV17Branch:false,v17FilesPersistedIntoV20Branch:false},
 whitelist:required,
 evidence:{marketRows:rows(market).length,rankingRows:rows(ranking).length,historySymbols:Object.keys(history.sessionsBySymbol||{}).length,srRows:rows(sr).length,liquidityRows:rows(liq).length,coveragePct:Number(gate.coveragePct||0),freshnessPct:Number(gate.freshnessPct||0),criticalFieldsPct:Number(gate.criticalFieldsPct||0),sourceConflictCount:(gate.sourceConflicts||[]).length,files:fileEvidence},
 persistence:{reportPath:'data/v20/v17-runtime-sync.json',upstreamWorkingTreeFilesAreTemporary:true,upstreamFilesStagedForV20Commit:false,sourceShaPersistedForReproducibility:true}
};
write('data/v20/v17-runtime-sync.json',out);console.log(JSON.stringify(out,null,2));if(!out.ok)process.exitCode=1;
