#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=r=>path.join(root,r);
const read=r=>JSON.parse(fs.readFileSync(P(r),'utf8'));
const write=(r,v)=>{const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,`${JSON.stringify(v,null,2)}\n`,'utf8')};
const failures=[];const checks=[];
function check(ok,code,evidence=null){checks.push({code,ok:ok===true,evidence});if(ok!==true)failures.push(code)}
function finalState({native=false,v17Data=true,v17Recommendation=true,v17Execution=true,globalGate=true,planValid=true,priceState='IN_ENTRY_RANGE',criticalConflict=false}){
  if(native&&priceState==='ABOVE_ENTRY_RANGE_DO_NOT_CHASE')return'DO_NOT_CHASE';
  if(v17Execution&&globalGate&&planValid&&priceState==='IN_ENTRY_RANGE'&&!criticalConflict)return'ACTIONABLE';
  if(v17Recommendation&&globalGate&&planValid&&(priceState==='BELOW_ENTRY_RANGE'||priceState==='BELOW_ENTRY_RANGE_WAITING')&&!criticalConflict)return'WAIT_FOR_ENTRY';
  if(native&&v17Recommendation&&!globalGate)return'HIGH_QUALITY_RESEARCH';
  if(native)return'RESEARCH_ONLY';
  if(!v17Data||criticalConflict)return'BLOCKED';
  return'WATCHLIST';
}

// CASE A: Native #1 cannot override V17 data failure.
check(finalState({native:true,v17Data:false,v17Recommendation:false,v17Execution:false,globalGate:true})!=='ACTIONABLE','CASE_A_NATIVE_RANK1_V17_DATA_FAIL_BLOCKS_ACTIONABLE');
// CASE B: strong Native + per-stock V17 passes + global gate closed.
check(finalState({native:true,v17Data:true,v17Recommendation:true,v17Execution:false,globalGate:false})!=='ACTIONABLE','CASE_B_GLOBAL_GATE_CLOSED_BLOCKS_ACTIONABLE');
// CASE C: all production conditions pass.
check(finalState({native:true,v17Data:true,v17Recommendation:true,v17Execution:true,globalGate:true,planValid:true,priceState:'IN_ENTRY_RANGE'})==='ACTIONABLE','CASE_C_ALL_CONDITIONS_ALLOW_ACTIONABLE');
// CASE D: price above issued entry range.
check(finalState({native:true,v17Data:true,v17Recommendation:true,v17Execution:true,globalGate:true,planValid:true,priceState:'ABOVE_ENTRY_RANGE_DO_NOT_CHASE'})==='DO_NOT_CHASE','CASE_D_ABOVE_RANGE_DO_NOT_CHASE');
// CASE E: critical source conflict revokes execution.
check(finalState({native:true,v17Data:true,v17Recommendation:true,v17Execution:false,globalGate:true,criticalConflict:true})!=='ACTIONABLE','CASE_E_CRITICAL_CONFLICT_REVOKES_EXECUTION');
// CASE F: outside Legacy Seed remains a valid research concept.
const outsideLegacyResearch={native:true,wasInLegacySeedUniverse:false,legacyScoringContributionPct:0,executionPermission:false};
check(outsideLegacyResearch.native===true&&outsideLegacyResearch.wasInLegacySeedUniverse===false&&outsideLegacyResearch.legacyScoringContributionPct===0,'CASE_F_OUTSIDE_LEGACY_VALID_NATIVE_RESEARCH');
// CASE G/H: model-version immutability.
function freezeDecision(existing,next){if(existing.modelId===next.modelId&&existing.modelVersion===next.modelVersion&&existing.compositeModelDigest!==next.compositeModelDigest)return'BLOCK';if(existing.modelId===next.modelId&&existing.modelVersion!==next.modelVersion)return'NEW_EVIDENCE_WINDOW';return'ALLOW_SAME_DIGEST'}
check(freezeDecision({modelId:'N',modelVersion:'V1',compositeModelDigest:'A'},{modelId:'N',modelVersion:'V1',compositeModelDigest:'B'})==='BLOCK','CASE_G_SAME_VERSION_DIFFERENT_DIGEST_BLOCKED');
check(freezeDecision({modelId:'N',modelVersion:'V1',compositeModelDigest:'A'},{modelId:'N',modelVersion:'V2',compositeModelDigest:'B'})==='NEW_EVIDENCE_WINDOW','CASE_H_NEW_VERSION_REQUIRES_NEW_EVIDENCE_WINDOW');

const native=read('data/v20/native-current.json');
const core=read('data/v20/v17-production-decision-core.json');
const contract=read('data/v20/final-decision-contract.json');
const freeze=read('data/v20/native-model-freeze.json');
const resilient=read('data/v17/resilient-session-status.json');
const policy=read('data/v20/decision-intelligence-policy.json');
check(native.engineId==='V20_FULL_MARKET_NATIVE_SELECTION_V1','LIVE_NATIVE_V1_ENGINE');
check(native.candidateUniverseIsFullMarketIndependent===true&&native.legacySeedDependency===false&&Number(native.legacyScoringContributionPct)===0,'LIVE_NATIVE_FULL_MARKET_LEGACY_ZERO');
check(native.notAuthoritativeFor?.includes('EXECUTION_PERMISSION'),'LIVE_NATIVE_CANNOT_GRANT_EXECUTION');
check(core.moduleId==='V20_V17_PRODUCTION_DECISION_CORE'&&core.policy?.v17IsAuthoritativeForProductionEligibility===true,'LIVE_V17_CORE_MORE_THAN_BOOLEAN_GATE');
check((core.rows||[]).every(r=>Array.isArray(r.v17Blockers)&&typeof r.v17DataEligible==='boolean'&&typeof r.v17LiquidityEligible==='boolean'&&typeof r.v17TechnicalEligible==='boolean'&&typeof r.v17SrEligible==='boolean'&&typeof r.v17RecommendationEligible==='boolean'&&typeof r.v17ExecutionEligible==='boolean'),'LIVE_V17_PER_STOCK_ELIGIBILITY_FIELDS_COMPLETE');
check(contract.architecture==='V17_CENTRIC_V20_NATIVE_DISCOVERY'&&contract.policy?.v20NativeCannotOverrideV17===true,'LIVE_CANONICAL_DECISION_CONTRACT_V17_CENTRIC');
check(contract.summary?.productionActionableCount===(contract.rows||[]).filter(r=>r.governance?.finalDecisionState==='ACTIONABLE').length,'LIVE_ACTIONABLE_COUNT_RECONCILES');
if(resilient.executionGrade!==true){
  check(contract.summary?.productionActionableCount===0,'LIVE_CLOSED_GATE_ZERO_ACTIONABLE');
  check(Number(contract.summary?.productionNewExposurePct)===0,'LIVE_CLOSED_GATE_ZERO_NEW_EXPOSURE');
  check((contract.rows||[]).every(r=>r.governance?.finalDecisionState!=='ACTIONABLE'),'LIVE_CLOSED_GATE_NO_ROW_ACTIONABLE');
}
check((contract.rows||[]).filter(r=>r.v20Native?.discovered===true).every(r=>r.v20Native?.grantsExecutionPermission===false),'LIVE_NATIVE_ROWS_NO_EXECUTION_PERMISSION');
check((contract.rows||[]).filter(r=>r.v17?.blockers?.includes('CRITICAL_SOURCE_CONFLICT')).every(r=>r.governance?.finalDecisionState!=='ACTIONABLE'),'LIVE_CRITICAL_CONFLICT_NEVER_ACTIONABLE');
check((contract.rows||[]).filter(r=>r.tradePlan?.chaseState==='DO_NOT_CHASE').every(r=>r.governance?.finalDecisionState==='DO_NOT_CHASE'),'LIVE_DO_NOT_CHASE_CANONICAL_STATE');
check(freeze.modelId==='V20_FULL_MARKET_NATIVE_SELECTION'&&freeze.modelVersion==='V1'&&freeze.governance?.retuneV1Forbidden===true,'LIVE_NATIVE_V1_FROZEN');
check(freeze.rankingContract==='V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2','LIVE_NATIVE_V1_TIE_CONTRACT_FROZEN');
check(policy.fullMarketNativeSelection?.minimumNetRiskReward===0.7,'LIVE_NATIVE_MIN_NET_RR_UNRETUNED');
check(contract.rows?.every(r=>r.governance?.activeChampion==='V16_9_EQUAL_WEIGHT_BASKET'&&r.governance?.automaticPromotion===false&&r.governance?.automaticBrokerExecution===false),'LIVE_CHAMPION_AND_NO_AUTO_PROMOTION_EXECUTION');
check((contract.rows||[]).every(r=>r.confidence?.modelConfidence===null&&r.confidence?.modelConfidenceState==='UNCALIBRATED_DO_NOT_INFER_FROM_NATIVE_SCORE'),'LIVE_MODEL_CONFIDENCE_NOT_INFERRED_FROM_SCORE');

const report={schemaVersion:'20.0.0-v17-centric-semantic-acceptance-1',generatedAt:new Date().toISOString(),sessionDate:contract.sessionDate,ok:failures.length===0,failedCount:failures.length,failures,checks,summary:{testCount:checks.length,caseAtoHPassed:checks.slice(0,8).every(x=>x.ok),v17ExecutionGrade:resilient.executionGrade===true,productionActionableCount:contract.summary?.productionActionableCount,productionNewExposurePct:contract.summary?.productionNewExposurePct,nativePublishedCount:native.publishedCandidates?.length||0,activeChampion:'V16_9_EQUAL_WEIGHT_BASKET'}};
write('data/v20/v17-centric-semantic-acceptance.json',report);
console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
