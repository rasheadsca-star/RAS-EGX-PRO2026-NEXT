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

const v17 = read('data/v17/current.json');
const gate = read('data/v17/resilient-session-status.json');
const internalSr = read('data/v17/internal-ohlc-support-resistance.json');
const liquidity = read('data/v17/liquidity-gate.json');
const v19 = read('data/v19/native-challenger-v6.json');
const v19Lock = read('data/v19/v6-research-champion-lock.json');
const championEvidence = read('data/research/v16-v169-basket-engine.json');
const ranking = read('data/final-opportunity-ranking.json');
const market = read('data/market.json');

const CHAMPION = 'V16_9_EQUAL_WEIGHT_BASKET';
if (v17?.engine?.id && v17.engine.id !== CHAMPION) throw new Error(`Champion invariant failed: ${v17.engine.id}`);
if (v19?.promotion?.automaticPromotion === true || v19?.promotion?.promotionAllowed === true) throw new Error('V19 promotion lock invariant failed');
if (v19Lock?.governance?.automaticPromotion === true || v19Lock?.governance?.productionPromoted === true) throw new Error('V19 research lock invariant failed');

const sessionDate = gate?.priceTruth?.verifiedSessionDate || v17?.sessionDate || market?.sessionDate || null;
const researchReady = gate?.readiness?.researchReady === true && v17?.readiness?.researchReady === true;
const executionReady = gate?.executionGrade === true && v17?.readiness?.executionReady === true;
const gateStatus = ['HEALTHY', 'DEGRADED', 'RESEARCH_ONLY', 'BLOCKED'].includes(gate?.status) ? gate.status : 'BLOCKED';
const maximumTotalAllocationPct = clamp(v17?.portfolioPolicy?.maximumTotalAllocationPct ?? 50, 0, 100);
const recommendedExposurePct = executionReady
  ? clamp(v17?.portfolioPolicy?.plannedAllocationPct ?? 0, 0, maximumTotalAllocationPct)
  : 0;
const cashPct = round(100 - recommendedExposurePct, 2);
const portfolioRiskState = gateStatus === 'BLOCKED'
  ? 'CASH_PRESERVATION'
  : executionReady
    ? (String(v17?.market?.regime || '').includes('BEAR') ? 'DEFENSIVE' : 'NORMAL')
    : 'DEFENSIVE';

const confidenceCapPct = clamp(gate?.confidencePolicy?.confidenceCapPct ?? (executionReady ? 100 : 68), 0, 100);
const srMap = new Map(rowsOf(internalSr).map(row => [symbolOf(row.symbol), row]).filter(([s]) => s));
const liquidSet = new Set((liquidity?.executionEligibleSymbols || []).map(symbolOf).filter(Boolean));
const conflictSet = new Set((gate?.sourceConflicts || []).map(row => symbolOf(row.symbol)).filter(Boolean));

function opportunityStatus(row, sr) {
  const ticker = symbolOf(row?.symbol);
  const rowBlocked = row?.executionAllowed === false || row?.precisionRisk === true || (Array.isArray(row?.blocks) && row.blocks.length > 0);
  if (gateStatus === 'BLOCKED' || rowBlocked || conflictSet.has(ticker)) return 'AVOID';
  if (executionReady && row?.executionAllowed === true && sr?.executionEligible === true && liquidSet.has(ticker)) return 'ACTIONABLE';
  if (researchReady && finite(row?.finalScore, 0) >= 70) return 'WATCH';
  return 'WAIT';
}

const opportunities = rowsOf(ranking).slice(0, 30).map((row, index) => {
  const ticker = symbolOf(row.symbol || row.ticker || row.code);
  const sr = srMap.get(ticker) || null;
  const status = opportunityStatus(row, sr);
  const legacyConfidence = clamp(row?.confidence ?? row?.targetProbability ?? 0, 0, 100);
  const dataConfidencePct = round(Math.min(legacyConfidence, confidenceCapPct), 1);
  const executionConfidencePct = executionReady && status === 'ACTIONABLE' ? dataConfidencePct : 0;
  const entryLow = finite(row?.entryFrom ?? row?.entryLow);
  const entryHigh = finite(row?.entryTo ?? row?.entryHigh);
  const stop = finite(row?.stopLoss ?? row?.stop);
  const target1 = finite(row?.target1 ?? row?.target);
  const target2 = finite(row?.target2);
  return {
    rank: index + 1,
    ticker,
    nameAr: row?.name || row?.companyNameAr || null,
    price: finite(row?.price ?? row?.close),
    legacyOpportunityScore: finite(row?.finalScore),
    legacyTargetProbabilityPct: finite(row?.targetProbability),
    dataConfidencePct,
    executionConfidencePct,
    liquidityExecutionEligible: liquidSet.has(ticker),
    supportResistance: sr ? {
      support1: finite(sr.support1), support2: finite(sr.support2),
      resistance1: finite(sr.resistance1), resistance2: finite(sr.resistance2),
      methodology: sr.methodology || null,
      source: sr.source || null,
      sessionDate: sr.sessionDate || null,
      freshness: sr.freshness || null,
      confidence: finite(sr.confidence),
      executionEligible: sr.executionEligible === true,
      externalValidation: sr.externalValidation || null,
    } : null,
    tradePlan: { entryLow, entryHigh, stop, target1, target2, grossRiskReward: finite(row?.rr), netRiskReward: null },
    suggestedPositionWeightPct: 0,
    status,
    reasons: [
      row?.why || null,
      !executionReady ? 'GLOBAL_EXECUTION_GATE_CLOSED' : null,
      conflictSet.has(ticker) ? 'CRITICAL_SOURCE_CONFLICT' : null,
      !liquidSet.has(ticker) ? 'LIQUIDITY_NOT_EXECUTION_ELIGIBLE' : null,
      sr && sr.executionEligible !== true ? 'SUPPORT_RESISTANCE_RESEARCH_ONLY' : null,
    ].filter(Boolean),
    provenance: {
      rankingSource: 'data/final-opportunity-ranking.json',
      supportResistanceSource: sr ? 'data/v17/internal-ohlc-support-resistance.json' : null,
      liquiditySource: 'data/v17/liquidity-gate.json',
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

const costPct = finite(v19?.methodology?.transactionCostPct, 0.6);
const systemStatus = !researchReady ? 'BLOCKED' : executionReady ? 'HEALTHY' : gateStatus;
const warnings = [
  ...(gate?.reasons || []),
  ...(gate?.missingSymbols?.length ? [`MISSING_SYMBOLS_${gate.missingSymbols.length}`] : []),
  ...(!v19SameSession ? ['V19_CURRENT_SIGNAL_NOT_ALIGNED_WITH_V17_MARKET_SESSION'] : []),
  'V18_EXTERNAL_REFERENCE_BROWSER_AUDIT_PENDING',
];

const out = {
  schemaVersion: '20.0.0-integrated-decision-contract-1',
  generatedAt: new Date().toISOString(),
  branch: process.env.GITHUB_REF_NAME || 'develop/v20-integrated-decision-platform',
  product: 'EGX PRO INTEGRATED DECISION PLATFORM',
  status: systemStatus,
  sessionDate,
  decisionSupportOnly: true,
  executionStatus: executionReady ? 'EXECUTION_GRADE' : researchReady ? 'RESEARCH_ONLY' : 'BLOCKED',
  marketStatus: {
    regime: v17?.market?.regime || 'UNVERIFIED_CURRENT_REGIME',
    labelAr: v17?.market?.labelAr || null,
    verified: !String(v17?.market?.regime || '').startsWith('UNVERIFIED'),
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
  },
  portfolio: {
    riskState: portfolioRiskState,
    maximumTotalAllocationPct,
    recommendedExposurePct,
    cashPct,
    totalPlannedAllocationGuardPassed: recommendedExposurePct <= maximumTotalAllocationPct,
    automaticOrders: false,
    transactionCostPolicyPct: costPct,
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
    sourceHash: sha({
      v17GeneratedAt: v17?.generatedAt || null,
      gateGeneratedAt: gate?.generatedAt || null,
      v19GeneratedAt: v19?.generatedAt || null,
      rankingGeneratedAt: ranking?.generatedAt || null,
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
}, null, 2));
