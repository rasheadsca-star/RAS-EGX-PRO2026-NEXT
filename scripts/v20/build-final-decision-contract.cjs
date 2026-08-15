#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const P=rel=>path.join(root,rel);
const read=(rel,fallback=null)=>{try{return JSON.parse(fs.readFileSync(P(rel),'utf8'))}catch(error){if(fallback!==null)return fallback;throw new Error(`Cannot read ${rel}: ${error.message}`)}};
const writeAtomic=(rel,value)=>{const file=P(rel);fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,'utf8');JSON.parse(fs.readFileSync(tmp,'utf8'));fs.renameSync(tmp,file)};
const finite=v=>Number.isFinite(Number(v));
const sym=v=>String(v||'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'');

const native=read('data/v20/native-current.json');
const core=read('data/v20/v17-production-decision-core.json');
const resilient=read('data/v17/resilient-session-status.json');
const sr=read('data/v17/internal-ohlc-support-resistance.json',{});
const current=read('data/v20/current.json');
const regime=read('data/v20/market-regime.json',{});
const freeze=read('data/v20/native-model-freeze.json',{});
const sync=read('data/v20/v17-runtime-sync.json',{});

if(native.sessionDate!==core.sessionDate||core.sessionDate!==current.sessionDate)throw new Error('Native/V17/current session mismatch');
if(core.sourceV17?.globalExecutionGrade!==resilient.executionGrade)throw new Error('V17 core/global gate mismatch');

const nativeMap=new Map((native.publishedCandidates||[]).map(row=>[sym(row.ticker),row]));
const srMap=new Map((sr.rows||[]).map(row=>[sym(row.symbol),row]));
const roundTripCostPct=Number((native.publishedCandidates||[])[0]?.tradePlan?.roundTripTransactionCostPct??0.6);
const minNetRR=0.7;

function priceState(n){
  if(!n)return null;
  const state=n.tradePlan?.alignmentState||null;
  if(state==='ABOVE_ENTRY_RANGE_DO_NOT_CHASE')return 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE';
  if(state==='IN_ENTRY_RANGE')return 'IN_ENTRY_RANGE';
  if(state==='BELOW_ENTRY_RANGE')return 'BELOW_ENTRY_RANGE';
  return state;
}
function hasCriticalProductionBlocker(row){
  return (row.v17Blockers||[]).some(code=>['STALE_DATA','MISSING_CRITICAL_FIELDS','CRITICAL_SOURCE_CONFLICT','PRICE_UNTRUSTED','SESSION_NOT_ALIGNED'].includes(code));
}
function decide(v,n){
  const pState=priceState(n);
  const planReady=!!n&&finite(n.tradePlan?.entryLow)&&finite(n.tradePlan?.entryHigh)&&finite(n.tradePlan?.stop)&&finite(n.tradePlan?.target1)&&finite(n.netRiskReward)&&Number(n.netRiskReward)>=minNetRR;
  if(n&&pState==='ABOVE_ENTRY_RANGE_DO_NOT_CHASE')return 'DO_NOT_CHASE';
  if(v.v17ExecutionEligible===true&&resilient.executionGrade===true&&planReady&&pState==='IN_ENTRY_RANGE')return 'ACTIONABLE';
  if(v.v17RecommendationEligible===true&&resilient.executionGrade===true&&planReady&&pState==='BELOW_ENTRY_RANGE')return 'WAIT_FOR_ENTRY';
  if(n&&v.v17RecommendationEligible===true&&resilient.executionGrade!==true)return 'HIGH_QUALITY_RESEARCH';
  if(n&&hasCriticalProductionBlocker(v))return 'RESEARCH_ONLY';
  if(n)return 'RESEARCH_ONLY';
  if(v.v17RecommendationEligible===true)return 'WATCHLIST';
  if(hasCriticalProductionBlocker(v))return 'BLOCKED';
  return 'WATCHLIST';
}
function nextCondition(v,n,state){
  if(state==='ACTIONABLE')return 'FOLLOW_APPROVED_PRODUCTION_POLICY_AND_PORTFOLIO_GUARDS';
  if(state==='DO_NOT_CHASE')return 'WAIT_FOR_PRICE_TO_REENTER_ISSUED_ENTRY_RANGE;_DO_NOT_MOVE_ENTRY_RANGE_UP';
  if(state==='WAIT_FOR_ENTRY')return 'WAIT_FOR_PRICE_TO_ENTER_ISSUED_ENTRY_RANGE';
  if(v.v17Blockers?.includes('EXECUTION_GATE_CLOSED'))return 'V17_GLOBAL_EXECUTION_GATE_MUST_OPEN_AFTER_ALL_QUALITY_GATES_PASS';
  if(v.v17Blockers?.includes('CRITICAL_SOURCE_CONFLICT'))return 'RESOLVE_CRITICAL_SOURCE_CONFLICT';
  if(v.v17Blockers?.includes('MISSING_SR')||v.v17Blockers?.includes('SR_LOW_CONFIDENCE'))return 'RESTORE_V17_SR_READINESS';
  if(v.v17Blockers?.includes('LOW_LIQUIDITY'))return 'PASS_V17_LIQUIDITY_ELIGIBILITY';
  if(v.v17Blockers?.includes('INSUFFICIENT_TECHNICAL_HISTORY'))return 'COMPLETE_TRUSTED_TECHNICAL_HISTORY_REQUIREMENT';
  if(v.v17Blockers?.includes('CORPORATE_ACTION_STATUS_UNAVAILABLE'))return 'AUTHORITATIVE_CORPORATE_ACTION_SAFETY_EVIDENCE_REQUIRED_FOR_EXECUTION';
  return n?'SATISFY_V17_PRODUCTION_ELIGIBILITY':'CONTINUE_MONITORING';
}

const rows=(core.rows||[]).map(v=>{
  const n=nativeMap.get(sym(v.ticker))||null;
  const srRow=srMap.get(sym(v.ticker))||null;
  const finalDecisionState=decide(v,n);
  const blockers=[...(v.v17Blockers||[])];
  if(n&&finite(n.netRiskReward)&&Number(n.netRiskReward)<minNetRR)blockers.push('NET_RR_TOO_LOW');
  if(n&&n.tradePlan?.alignmentState==='ABOVE_ENTRY_RANGE_DO_NOT_CHASE')blockers.push('DO_NOT_CHASE','PRICE_OUTSIDE_ENTRY_RANGE');
  if(finalDecisionState==='ACTIONABLE'&&resilient.executionGrade!==true)throw new Error(`Closed V17 gate created ACTIONABLE ${v.ticker}`);
  return {
    identity:{symbol:v.ticker,companyName:v.companyName,marketSessionDate:core.sessionDate},
    dataTruth:{
      trustedPrice:v.evidence?.trustedPrice??null,
      source:'V17_CURRENT_SESSION_VERIFIED_CHAIN',
      sourceTimestamp:null,
      freshness:v.v17DataEligible===true?'CURRENT_VERIFIED_SESSION':'NOT_PRODUCTION_ELIGIBLE',
      sessionAligned:core.sourceV17?.sourceSessionVerified===true,
      coveragePct:finite(resilient.coveragePct)?Number(resilient.coveragePct):null,
      criticalFieldsPct:finite(resilient.criticalFieldsPct)?Number(resilient.criticalFieldsPct):null,
      sourceConfidence:v.v17SourceConfidenceReady===true?'READY':'BLOCKED_OR_UNVERIFIED',
      sourceConflicts:v.evidence?.criticalSourceConflicts||[]
    },
    v20Native:n?{
      discovered:true,
      discoveryRank:n.rank,
      nativeScore:n.nativeResearchScore,
      tier:n.nativeResearchTier,
      liquidityScore:n.liquidity2Score,
      technicalScore:n.technicalScore,
      srScore:n.srConfluenceScore,
      researchReasons:[],
      legacyScoringContributionPct:0,
      grantsExecutionPermission:false
    }:{discovered:false,discoveryRank:null,nativeScore:null,tier:null,liquidityScore:null,technicalScore:null,srScore:null,researchReasons:[],legacyScoringContributionPct:0,grantsExecutionPermission:false},
    v17:{
      recommendationScore:v.v17RecommendationScore,
      dataEligible:v.v17DataEligible,
      liquidityEligible:v.v17LiquidityEligible,
      technicalEligible:v.v17TechnicalEligible,
      srEligible:v.v17SrEligible,
      sourceConfidenceReady:v.v17SourceConfidenceReady,
      corporateActionSafe:v.v17CorporateActionSafe,
      corporateActionState:v.corporateActionState,
      priceEligible:v.v17PriceEligible,
      recommendationEligible:v.v17RecommendationEligible,
      executionEligible:v.v17ExecutionEligible,
      blockers:[...new Set(blockers)]
    },
    tradePlan:n?{
      currentPrice:n.price,
      entryLow:n.tradePlan?.entryLow??null,
      entryHigh:n.tradePlan?.entryHigh??null,
      priceState:priceState(n),
      stop:n.tradePlan?.stop??null,
      target1:n.tradePlan?.target1??null,
      target2:n.tradePlan?.target2??null,
      grossRR:null,
      transactionCostsPct:roundTripCostPct,
      slippagePct:null,
      netRR:n.netRiskReward,
      chaseState:n.tradePlan?.alignmentState==='ABOVE_ENTRY_RANGE_DO_NOT_CHASE'?'DO_NOT_CHASE':'NO_CHASE_SIGNAL'
    }:{currentPrice:v.evidence?.trustedPrice??null,entryLow:null,entryHigh:null,priceState:null,stop:null,target1:null,target2:null,grossRR:null,transactionCostsPct:roundTripCostPct,slippagePct:null,netRR:null,chaseState:null},
    supportResistance:srRow?{source:srRow.source||null,methodology:srRow.methodology||null,sessionDate:srRow.sessionDate||null,freshness:srRow.freshness||null,confidence:srRow.confidence??null,validationState:srRow.executionEligible===true?'V17_EXECUTION_ELIGIBLE':'RESEARCH_OR_BLOCKED',levels:srRow.levels||null}:null,
    confidence:{
      marketConfidence:null,
      dataConfidence:v.evidence?.dataQualityScore??null,
      technicalConfidence:v.v17RecommendationScore??null,
      modelConfidence:null,
      modelConfidenceState:'UNCALIBRATED_DO_NOT_INFER_FROM_NATIVE_SCORE',
      executionConfidence:null,
      executionConfidenceState:resilient.executionGrade===true?'GATE_OPEN_NOT_A_PROBABILITY':'GATE_CLOSED_NOT_A_PROBABILITY'
    },
    governance:{
      activeChampion:'V16_9_EQUAL_WEIGHT_BASKET',
      nativeModelVersion:native.engineId,
      nativeFreezeId:freeze.freezeId||null,
      v17GateStatus:resilient.status||resilient.mode||null,
      finalDecisionState,
      automaticPromotion:false,
      automaticBrokerExecution:false,
      v20MayOverrideV17:false
    },
    explainability:{
      whySelected:n?`V20_NATIVE_DISCOVERY_RANK_${n.rank}`:'NOT_IN_PUBLISHED_NATIVE_TOP_30',
      whyNotActionable:finalDecisionState==='ACTIONABLE'?null:[...new Set(blockers)],
      nextRequiredCondition:nextCondition(v,n,finalDecisionState)
    }
  };
});

const stateCounts={};for(const row of rows){const s=row.governance.finalDecisionState;stateCounts[s]=(stateCounts[s]||0)+1;}
const actionableCount=stateCounts.ACTIONABLE||0;
if(resilient.executionGrade!==true&&actionableCount!==0)throw new Error('V17 gate closed but ACTIONABLE count is nonzero');
const out={
  schemaVersion:'20.0.0-canonical-stock-decision-contract-1',
  generatedAt:new Date().toISOString(),
  sessionDate:core.sessionDate,
  architecture:'V17_CENTRIC_V20_NATIVE_DISCOVERY',
  sourceV17Commit:sync?.source?.commitSha||core.sourceV17?.commitSha||null,
  productStatus:'PRODUCTION_READY_DECISION_SUPPORT',
  sessionStatus:resilient.executionGrade===true?'EXECUTION_GRADE':(resilient.status==='BLOCKED'?'BLOCKED':'RESEARCH_ONLY'),
  policy:{v20Discovers:true,v17ValidatesAndAuthorizes:true,v20NativeCannotOverrideV17:true,closedGateRequiresZeroActionable:true,closedGateRequiresZeroNewExposure:true,legacyNativeScoringContributionPct:0},
  summary:{evaluatedCount:rows.length,nativePublishedCount:native.publishedCandidates?.length||0,v17RecommendationEligibleCount:rows.filter(r=>r.v17.recommendationEligible===true).length,v17ExecutionEligibleCount:rows.filter(r=>r.v17.executionEligible===true).length,productionActionableCount:actionableCount,productionNewExposurePct:0,stateCounts},
  rows
};
if(out.sessionStatus!=='EXECUTION_GRADE')out.summary.productionNewExposurePct=0;
writeAtomic('data/v20/final-decision-contract.json',out);
console.log(JSON.stringify({ok:true,sessionDate:out.sessionDate,productStatus:out.productStatus,sessionStatus:out.sessionStatus,...out.summary},null,2));
