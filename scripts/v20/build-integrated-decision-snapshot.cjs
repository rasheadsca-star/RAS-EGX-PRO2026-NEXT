#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function read(rel, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function write(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function rowsOf(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['rows', 'items', 'data']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}
function symbolOf(value) {
  return String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
}
function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, digits = 2) {
  const n = finite(value);
  if (n === null) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
function clamp(value, min, max) {
  const n = finite(value, min);
  return Math.max(min, Math.min(max, n));
}
function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function firstFinite(...values) {
  for (const value of values) {
    const n = finite(value);
    if (n !== null) return n;
  }
  return null;
}
function tradeMetrics(entryLow, entryHigh, stop, target, costPct) {
  const entryReference = firstFinite(entryHigh, entryLow);
  if (entryReference === null || stop === null || target === null || entryReference <= 0) {
    return {
      entryReference,
      costPerShare: null,
      grossRewardPct: null,
      netRewardPct: null,
      grossRiskPct: null,
      netRiskPct: null,
      grossRiskReward: null,
      netRiskReward: null,
      valid: false,
    };
  }
  const grossReward = target - entryReference;
  const grossRisk = entryReference - stop;
  const costPerShare = entryReference * costPct / 100;
  const netReward = grossReward - costPerShare;
  const netRisk = grossRisk + costPerShare;
  return {
    entryReference: round(entryReference, 4),
    costPerShare: round(costPerShare, 6),
    grossRewardPct: round((grossReward / entryReference) * 100, 2),
    netRewardPct: round((netReward / entryReference) * 100, 2),
    grossRiskPct: round((grossRisk / entryReference) * 100, 2),
    netRiskPct: round((netRisk / entryReference) * 100, 2),
    grossRiskReward: grossRisk > 0 ? round(grossReward / grossRisk, 3) : null,
    netRiskReward: netRisk > 0 ? round(netReward / netRisk, 3) : null,
    valid: grossRisk > 0 && grossReward > 0 && netRisk > 0,
  };
}

const v17 = read('data/v17/current.json');
const gate = read('data/v17/resilient-session-status.json');
const internalSr = read('data/v17/internal-ohlc-support-resistance.json');
const liquidity = read('data/v17/liquidity-gate.json');
const v19 = read('data/v19/native-challenger-v6.json');
const v19Lock = read('data/v19/v6-research-champion-lock.json');
const championEvidence = read('data/research/v16-v169-basket-engine.json');
const ranking = read('data/final-opportunity-ranking.json');
const market = read('data/market.json');
const policy = read('data/v20/policy-registry.json');
const modelRegistry = read('data/v20/model-registry.json');
const sourceHealth = read('data/v20/source-health.json');

const CHAMPION = 'V16_9_EQUAL_WEIGHT_BASKET';
if (v17?.engine?.id && v17.engine.id !== CHAMPION) throw new Error(`Champion invariant failed: ${v17.engine.id}`);
if (modelRegistry?.activeProductionChampion && modelRegistry.activeProductionChampion !== CHAMPION) throw new Error('V20 model registry champion invariant failed');
if (v19?.promotion?.automaticPromotion === true || v19?.promotion?.promotionAllowed === true) throw new Error('V19 promotion lock invariant failed');
if (v19Lock?.governance?.automaticPromotion === true || v19Lock?.governance?.productionPromoted === true) throw new Error('V19 research lock invariant failed');
if (policy?.principles?.localRowExecutionFlagsCannotOverrideGlobalGate !== true) throw new Error('V20 fail-closed policy missing');

const sessionDate = gate?.priceTruth?.verifiedSessionDate || v17?.sessionDate || market?.sessionDate || null;
const researchReady = gate?.readiness?.researchReady === true && v17?.readiness?.researchReady === true;
const executionReady = gate?.executionGrade === true && v17?.readiness?.executionReady === true;
const gateStatus = ['HEALTHY', 'DEGRADED', 'RESEARCH_ONLY', 'BLOCKED'].includes(gate?.status) ? gate.status : 'BLOCKED';
const maximumTotalAllocationPct = clamp(
  Math.min(
    finite(v17?.portfolioPolicy?.maximumTotalAllocationPct, 50),
    finite(policy?.portfolio?.maximumTotalAllocationPct, 50),
  ),
  0,
  100,
);

const marketRegime = v17?.market?.regime || 'UNVERIFIED_CURRENT_REGIME';
const marketVerified = !String(marketRegime).startsWith('UNVERIFIED');
const portfolioRiskState = gateStatus === 'BLOCKED'
  ? 'CASH_PRESERVATION'
  : !executionReady
    ? 'DEFENSIVE'
    : /BEAR|RISK_OFF/i.test(String(marketRegime))
      ? 'DEFENSIVE'
      : /NEUTRAL|SIDEWAYS/i.test(String(marketRegime))
        ? 'CAUTIOUS'
        : marketVerified
          ? 'NORMAL'
          : 'CAUTIOUS';

const confidenceCapPct = clamp(
  gate?.confidencePolicy?.confidenceCapPct ?? (executionReady ? 100 : v17?.readiness?.dataQualityScore ?? 68),
  0,
  100,
);
const systemDataQualityPct = clamp(v17?.readiness?.dataQualityScore ?? 100, 0, 100);
const gateCoveragePct = clamp(gate?.coveragePct ?? 0, 0, 100);
const gateFreshnessPct = clamp(gate?.freshnessPct ?? 0, 0, 100);
const gateCriticalFieldsPct = clamp(gate?.criticalFieldsPct ?? 0, 0, 100);
const marketConfidencePct = marketVerified
  ? round(Math.min(gateCoveragePct, gateFreshnessPct, gateCriticalFieldsPct), 1)
  : 0;

const srMap = new Map(rowsOf(internalSr).map(row => [symbolOf(row.symbol), row]).filter(([s]) => s));
const liquidSet = new Set((liquidity?.executionEligibleSymbols || []).map(symbolOf).filter(Boolean));
const conflictSet = new Set((gate?.sourceConflicts || []).map(row => symbolOf(row.symbol)).filter(Boolean));
const missingSet = new Set((gate?.missingSymbols || []).map(symbolOf).filter(Boolean));
const costPct = finite(policy?.transactionCosts?.roundTripPct, finite(v19?.methodology?.transactionCostPct, 0.6));

function opportunityStatus(row, sr) {
  const ticker = symbolOf(row?.symbol);
  const rowBlocked = row?.executionAllowed === false || row?.precisionRisk === true || (Array.isArray(row?.blocks) && row.blocks.length > 0);
  const srSessionAligned = Boolean(sr?.sessionDate && sessionDate && sr.sessionDate === sessionDate);
  if (gateStatus === 'BLOCKED' || rowBlocked || conflictSet.has(ticker)) return 'AVOID';
  if (
    executionReady &&
    gate?.sessionAligned === true &&
    row?.executionAllowed === true &&
    sr?.executionEligible === true &&
    srSessionAligned &&
    liquidSet.has(ticker)
  ) return 'ACTIONABLE';
  if (researchReady && finite(row?.finalScore, 0) >= 70) return 'WATCH';
  return 'WAIT';
}

const opportunities = rowsOf(ranking).slice(0, 30).map((row, index) => {
  const ticker = symbolOf(row.symbol || row.ticker || row.code);
  const sr = srMap.get(ticker) || null;
  const status = opportunityStatus(row, sr);
  const legacyConfidence = clamp(row?.confidence ?? row?.targetProbability ?? 0, 0, 100);
  const srConfidencePct = sr && finite(sr.confidence) !== null
    ? clamp(finite(sr.confidence) <= 1 ? finite(sr.confidence) * 100 : finite(sr.confidence), 0, 100)
    : 100;
  const dataConfidencePct = round(Math.min(
    legacyConfidence,
    confidenceCapPct,
    systemDataQualityPct,
    gateCriticalFieldsPct || 100,
    srConfidencePct,
  ), 1);
  const executionConfidencePct = executionReady && status === 'ACTIONABLE' ? dataConfidencePct : 0;
  const entryLow = firstFinite(row?.entryFrom, row?.entryLow);
  const entryHigh = firstFinite(row?.entryTo, row?.entryHigh);
  const stop = firstFinite(row?.stopLoss, row?.stop);
  const target1 = firstFinite(row?.target1, row?.target);
  const target2 = firstFinite(row?.target2);
  const t1 = tradeMetrics(entryLow, entryHigh, stop, target1, costPct);
  const t2 = tradeMetrics(entryLow, entryHigh, stop, target2, costPct);
  const srSessionAligned = Boolean(sr?.sessionDate && sessionDate && sr.sessionDate === sessionDate);
  const reasons = [
    row?.why || null,
    !executionReady ? 'GLOBAL_EXECUTION_GATE_CLOSED' : null,
    gate?.sessionAligned !== true ? 'GLOBAL_SESSION_NOT_ALIGNED' : null,
    conflictSet.has(ticker) ? 'CRITICAL_SOURCE_CONFLICT' : null,
    missingSet.has(ticker) ? 'MISSING_CRITICAL_SYMBOL_EVIDENCE' : null,
    !liquidSet.has(ticker) ? 'LIQUIDITY_NOT_EXECUTION_ELIGIBLE' : null,
    sr && sr.executionEligible !== true ? 'SUPPORT_RESISTANCE_RESEARCH_ONLY' : null,
    sr && !srSessionAligned ? 'SUPPORT_RESISTANCE_SESSION_MISMATCH' : null,
    t1.netRiskReward !== null && t1.netRiskReward <= 0 ? 'TARGET1_NET_REWARD_NON_POSITIVE_AFTER_COSTS' : null,
  ].filter(Boolean);
  return {
    rank: index + 1,
    ticker,
    nameAr: row?.name || row?.companyNameAr || null,
    price: finite(row?.price ?? row?.close),
    opportunityScore: finite(row?.finalScore),
    scoreProvenance: 'LEGACY_FINAL_OPPORTUNITY_RANKING_NOT_CONFIDENCE',
    legacyTargetProbabilityPct: finite(row?.targetProbability),
    confidence: {
      marketConfidencePct,
      dataConfidencePct,
      modelConfidencePct: null,
      executionConfidencePct,
    },
    liquidityExecutionEligible: liquidSet.has(ticker),
    supportResistance: sr ? {
      support1: finite(sr.support1), support2: finite(sr.support2),
      resistance1: finite(sr.resistance1), resistance2: finite(sr.resistance2),
      methodology: sr.methodology || null,
      source: sr.source || null,
      sessionDate: sr.sessionDate || null,
      sessionAligned: srSessionAligned,
      freshness: sr.freshness || null,
      confidence: finite(sr.confidence),
      executionEligible: sr.executionEligible === true,
      externalValidation: sr.externalValidation || null,
    } : null,
    tradePlan: {
      direction: 'LONG',
      entryLow,
      entryHigh,
      entryReferenceForRiskMath: t1.entryReference,
      stop,
      target1,
      target2,
      transactionCostRoundTripPct: costPct,
      target1Metrics: t1,
      target2Metrics: target2 !== null ? t2 : null,
      legacyGrossRiskReward: finite(row?.rr),
      netRiskRewardGatingEnabled: policy?.transactionCosts?.gatingEnabled === true,
    },
    suggestedPositionWeightPct: 0,
    shadowPositionWeightPct: 0,
    status,
    reasons: [...new Set(reasons)],
    provenance: {
      rankingSource: 'data/final-opportunity-ranking.json',
      supportResistanceSource: sr ? 'data/v17/internal-ohlc-support-resistance.json' : null,
      liquiditySource: 'data/v17/liquidity-gate.json',
      executionGateSource: 'data/v17/resilient-session-status.json',
      costPolicySource: 'data/v20/policy-registry.json',
    },
  };
});

const v19SameSession = v19?.current?.signalDate === sessionDate;
const challengerCandidates = (v19?.current?.candidates || []).slice(0, 15).map(row => ({
  rank: row.rank,
  ticker: symbolOf(row.ticker),
  nameAr: row.companyNameAr || null,
  challengerScore: finite(row.v19AlphaScore),
  pTop10Pct: finite(row.pTop10Pct),
  pNetPositivePct: finite(row.pNetPositivePct),
  pLargeLossPct: finite(row.pLargeLossPct),
  selectedByV19: row.selectedByV6 === true,
  researchOnly: true,
  currentSessionAligned: v19SameSession,
  executionAllowed: false,
}));

const systemStatus = !researchReady ? 'BLOCKED' : executionReady ? 'HEALTHY' : gateStatus;
const warnings = [
  ...(gate?.reasons || []),
  ...(gate?.missingSymbols?.length ? [`MISSING_SYMBOLS_${gate.missingSymbols.length}`] : []),
  ...(!v19SameSession ? ['V19_CURRENT_SIGNAL_NOT_ALIGNED_WITH_V17_MARKET_SESSION'] : []),
  ...(!marketVerified ? ['CURRENT_MARKET_REGIME_UNVERIFIED'] : []),
  'V18_EXTERNAL_REFERENCE_BROWSER_AUDIT_PENDING',
];

const out = {
  schemaVersion: '20.0.0-integrated-decision-contract-2',
  generatedAt: new Date().toISOString(),
  branch: process.env.GITHUB_REF_NAME || 'develop/v20-integrated-decision-platform',
  product: 'EGX PRO INTEGRATED DECISION PLATFORM',
  status: systemStatus,
  sessionDate,
  decisionSupportOnly: true,
  executionStatus: executionReady ? 'EXECUTION_GRADE' : researchReady ? 'RESEARCH_ONLY' : 'BLOCKED',
  marketStatus: {
    regime: marketRegime,
    labelAr: v17?.market?.labelAr || null,
    verified: marketVerified,
    marketConfidencePct,
  },
  dataStatus: {
    status: gateStatus,
    sessionAligned: gate?.sessionAligned === true,
    coveragePct: finite(gate?.coveragePct),
    freshnessPct: finite(gate?.freshnessPct),
    criticalFieldsPct: finite(gate?.criticalFieldsPct),
    marketCoveragePct: finite(gate?.priceTruth?.marketCoveragePct),
    sourceCoveragePct: finite(gate?.priceTruth?.sourceCoveragePct),
    missingSymbols: gate?.missingSymbols || [],
    sourceConflicts: gate?.sourceConflicts || [],
    sourcesUsed: gate?.sourcesUsed || [],
    lastSourceUpdate: gate?.priceTruth?.lastSourceUpdate || null,
    sourceAgeMinutes: finite(gate?.priceTruth?.sourceAgeMinutes),
    sourceHealthSource: 'data/v20/source-health.json',
    sourceHealthStatus: sourceHealth?.status || gateStatus,
  },
  governance: {
    activeChampion: CHAMPION,
    championEvidenceSource: 'data/research/v16-v169-basket-engine.json',
    challenger: v19?.engineId || 'V19_CHAT_GPT_NATIVE_CHALLENGER_V6',
    challengerStatus: v19?.status || 'SHADOW_RESEARCH_ONLY',
    challengerFreshIndependentEvidence: v19?.methodology?.countsAsFreshIndependentEvidence === true,
    automaticPromotion: false,
    promotionAllowed: false,
    immutableV17LedgerSource: 'data/v17/ledger.json',
    v16EvidencePresent: Object.keys(championEvidence || {}).length > 0,
    modelRegistrySource: 'data/v20/model-registry.json',
    policyRegistrySource: 'data/v20/policy-registry.json',
  },
  portfolio: {
    riskState: portfolioRiskState,
    constructionMode: policy?.portfolio?.productionConstruction || 'CHAMPION_COMPATIBLE_EQUAL_WEIGHT',
    maximumTotalAllocationPct,
    recommendedExposurePct: 0,
    cashPct: 100,
    totalPlannedAllocationGuardPassed: true,
    automaticOrders: false,
    transactionCostPolicyPct: costPct,
    appliedPositionCount: 0,
    note: 'Final applied weights are produced by scripts/v20/build-portfolio-risk.cjs. Closed execution gate always remains 100% cash.',
  },
  opportunities,
  challengerResearch: {
    sessionDate: v19?.current?.signalDate || null,
    sessionAligned: v19SameSession,
    mode: v19?.current?.mode || v19?.status || 'SHADOW_RESEARCH_ONLY',
    executionAllowed: false,
    candidates: challengerCandidates,
  },
  warnings: [...new Set(warnings)],
  externalReferences: {
    v18: {
      url: 'https://egxpro18-r2qgzpdf.manus.space/',
      role: 'UI_UX_STOCK_ANALYSIS_BACKTEST_REPORTING_REFERENCE',
      auditState: 'PENDING_BROWSER_ACCESS',
      performanceEvidenceAccepted: false,
    },
  },
  provenance: {
    v16: 'release/v16.9.2-frozen-20260806@2351b2ec2bbcf3e36e992021e26b36845e879ab0',
    v17: 'develop/v17-rebuild@abd76acb3dc0b472e4f8de985aba7a6c45f87c16',
    v19: 'v19-egx-chat-gpt@fb5aafb3e3e4cd908831a7cb98de3f952e356c34',
    dataTruth: {
      masterUniverse: 'data/v20/master-universe.json',
      currentMarketSnapshot: 'data/v20/current-market-snapshot.json',
      sourceHealth: 'data/v20/source-health.json',
    },
    sourceHash: sha({
      v17GeneratedAt: v17?.generatedAt || null,
      gateGeneratedAt: gate?.generatedAt || null,
      v19GeneratedAt: v19?.generatedAt || null,
      rankingGeneratedAt: ranking?.generatedAt || null,
      sourceHealthGeneratedAt: sourceHealth?.generatedAt || null,
      policySchema: policy?.schemaVersion || null,
      modelRegistrySchema: modelRegistry?.schemaVersion || null,
    }),
  },
};

write('data/v20/current.json', out);
console.log(JSON.stringify({
  status: out.status,
  executionStatus: out.executionStatus,
  sessionDate: out.sessionDate,
  opportunities: out.opportunities.length,
  actionable: out.opportunities.filter(x => x.status === 'ACTIONABLE').length,
  exposurePct: out.portfolio.recommendedExposurePct,
  champion: out.governance.activeChampion,
  challenger: out.governance.challenger,
  netRiskRewardComputed: out.opportunities.filter(x => Number.isFinite(x.tradePlan?.target1Metrics?.netRiskReward)).length,
}, null, 2));
