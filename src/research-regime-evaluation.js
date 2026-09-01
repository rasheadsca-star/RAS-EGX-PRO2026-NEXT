import { sha256 } from './hash.js';

function finite(v){return Number.isFinite(Number(v))?Number(v):null}
function round(v,d=4){return Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null}
function delta(a,b){const x=finite(a),y=finite(b);return x===null||y===null?null:round(x-y,4)}
function verifyArtifact(x){if(!x||x.authorityMode!=='RESEARCH'||x.productionAuthority!==false||x.forwardEvidence!==false||x.regimeChallenger?.status!=='SHADOW_CHALLENGER_NOT_AUTO_PROMOTED'||!/^[a-f0-9]{64}$/.test(String(x.artifactHash??'')))return false;const {artifactHash,generatedAt,...stable}=x;return sha256(stable)===artifactHash}

function compareMetrics(base,challenger){
  return {
    plans:{baseline:base?.plans??null,challenger:challenger?.plans??null,delta:delta(challenger?.plans,base?.plans)},
    target1HitRatePct:{baseline:base?.target1HitRatePct??null,challenger:challenger?.target1HitRatePct??null,delta:delta(challenger?.target1HitRatePct,base?.target1HitRatePct)},
    stopRatePct:{baseline:base?.stopRatePct??null,challenger:challenger?.stopRatePct??null,delta:delta(challenger?.stopRatePct,base?.stopRatePct)},
    expectancyR:{baseline:base?.expectancyR??null,challenger:challenger?.expectancyR??null,delta:delta(challenger?.expectancyR,base?.expectancyR)},
    averageNetReturnPct:{baseline:base?.averageNetReturnPct??null,challenger:challenger?.averageNetReturnPct??null,delta:delta(challenger?.averageNetReturnPct,base?.averageNetReturnPct)},
    netReturnProfitFactor:{baseline:base?.netReturnProfitFactor??null,challenger:challenger?.netReturnProfitFactor??null,delta:delta(challenger?.netReturnProfitFactor,base?.netReturnProfitFactor)},
    winningSessionRatePct:{baseline:base?.winningSessionRatePct??null,challenger:challenger?.winningSessionRatePct??null,delta:delta(challenger?.winningSessionRatePct,base?.winningSessionRatePct)},
    averageBasketNetPct:{baseline:base?.averageBasketNetPct??null,challenger:challenger?.averageBasketNetPct??null,delta:delta(challenger?.averageBasketNetPct,base?.averageBasketNetPct)}
  };
}

export function evaluateHistoricalRegimeChallenger(simulation){
  if(!verifyArtifact(simulation))throw new Error('REGIME_EVALUATION_SIMULATOR_INVALID');
  const base=simulation.performance?.allDailySignals??{},challenger=simulation.regimeChallenger?.performance?.allDailySignals??{},baseActive=simulation.performance?.oneActivePlanPerTicker??{},challengerActive=simulation.regimeChallenger?.performance?.oneActivePlanPerTicker??{};
  const allSignals=compareMetrics(base,challenger),oneActive=compareMetrics(baseActive,challengerActive),baseMonths=simulation.breakdowns?.byMonth??{},guardMonths=simulation.breakdowns?.regimeGuardedByMonth??{},monthlySignReversals=[];
  for(const month of Object.keys(baseMonths).sort()){
    const b=finite(baseMonths[month]?.expectancyR),g=finite(guardMonths[month]?.expectancyR);if(b!==null&&g!==null&&b>=0&&g<0)monthlySignReversals.push({month,baselineExpectancyR:b,challengerExpectancyR:g,deltaR:round(g-b,4)});
  }
  const checks={target1NotLower:finite(challenger.target1HitRatePct)>=finite(base.target1HitRatePct),expectancyNotLower:finite(challenger.expectancyR)>=finite(base.expectancyR),stopRateNotHigher:finite(challenger.stopRatePct)<=finite(base.stopRatePct),netReturnProfitFactorNotLower:finite(challenger.netReturnProfitFactor)>=finite(base.netReturnProfitFactor),noPositiveToNegativeMonthlyExpectancy:monthlySignReversals.length===0};
  const historicalScreenPass=Object.values(checks).every(Boolean),replacementStatus=historicalScreenPass?'HISTORICAL_SCREEN_PASS_FORWARD_VALIDATION_REQUIRED':'REJECTED_AS_BASELINE_REPLACEMENT';
  const body={schemaVersion:'egx-one-regime-challenger-evaluation-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,forwardEvidence:false,sourceSimulatorArtifactHash:simulation.artifactHash,challengerPolicy:simulation.regimeChallenger.policy,evaluationPolicy:'NO_HISTORICAL_AUTO_PROMOTION_V1',replacementStatus,operationalUse:'CONTEXT_AND_CONFIDENCE_ONLY',filterUsage:'DISABLED_PENDING_FORWARD_VALIDATION',confidenceMeaning:'RESEARCH_RELATIVE_CONFIDENCE_INDEX_NOT_SUCCESS_PROBABILITY',historicalScreen:{pass:historicalScreenPass,checks,monthlySignReversals},comparison:{allDailySignals:allSignals,oneActivePlanPerTicker:oneActive},nextEvidenceRequired:'HASH_CHAINED_FORWARD_SHADOW_LEDGER'};
  return Object.freeze({...body,evaluationHash:sha256(body)});
}

export function verifyHistoricalRegimeEvaluation(evaluation,simulation){if(!evaluation||!simulation||evaluation.sourceSimulatorArtifactHash!==simulation.artifactHash||!/^[a-f0-9]{64}$/.test(String(evaluation.evaluationHash??'')))return false;const {evaluationHash,...body}=evaluation;return sha256(body)===evaluationHash&&evaluation.productionAuthority===false&&evaluation.forwardEvidence===false&&evaluation.filterUsage==='DISABLED_PENDING_FORWARD_VALIDATION'}
