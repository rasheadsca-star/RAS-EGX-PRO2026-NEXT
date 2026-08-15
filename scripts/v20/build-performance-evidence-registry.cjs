#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = (rel, fallback = {}) => {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
};
const write = (rel, value) => {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const metrics = value => ({
  sessions: finite(value?.sessions),
  averageNetReturnPct: finite(value?.averageNetReturnPct),
  medianNetReturnPct: finite(value?.medianNetReturnPct),
  sessionWinRatePct: finite(value?.sessionWinRatePct),
  profitFactor: finite(value?.profitFactor),
  compoundedNetReturnPct: finite(value?.compoundedNetReturnPct),
  maximumDrawdownPct: finite(value?.maximumDrawdownPct),
  volatilityPct: finite(value?.volatilityPct),
  bestSessionPct: finite(value?.bestSessionPct),
  worstSessionPct: finite(value?.worstSessionPct),
});

const v16 = read('data/research/v16-v169-basket-engine.json');
const v19Native = read('data/v19/native-challenger-v6.json');
const v19Lock = read('data/v19/v6-research-champion-lock.json');
const v19Gate = read('data/v19/challenger-status-v6.json');
const forward = read('data/v20/forward-evaluation.json', { evaluations: [] });
const current = read('data/v20/current.json');
const v18Audit = read('data/v20/v18-performance-audit.json', {
  status: 'AUDIT_OUTPUT_MISSING',
  acceptedForPerformanceClaims: false,
  reproducible: false,
  source: { sourceArtifactAvailable: false },
  unreconciledClaims: { observedTradeCounts: [16, 971, 1138], reconciled: false },
  definitions: { definitionCoveragePct: 0, missing: [] },
  governance: {
    countsAsIndependentEvidence: false,
    canCalibrateV20DecisionScore: false,
    canOpenExecutionGate: false,
    canChangeChampion: false,
    canPromoteChallenger: false,
  },
  blockingReasons: ['V18_AUDIT_OUTPUT_MISSING'],
});

const entries = [];
for (const size of ['3','4','5']) {
  if (!v16?.fixedBasketMetrics?.[size]) continue;
  entries.push({
    evidenceId: `V16_FIXED_BASKET_${size}`,
    model: 'V16_9_EQUAL_WEIGHT_BASKET',
    role: 'ACTIVE_CHAMPION_REFERENCE',
    evidenceClass: 'HISTORICAL_BACKTEST',
    source: 'data/research/v16-v169-basket-engine.json',
    sourceSection: `fixedBasketMetrics.${size}`,
    metrics: metrics(v16.fixedBasketMetrics[size]),
    independence: {
      freshIndependentEvidence: null,
      status: 'NOT_ESTABLISHED_BY_SOURCE',
    },
    decisionUse: 'REFERENCE_ONLY_NOT_COMBINED_WITH_FORWARD_RESULTS',
    caveats: ['Fixed basket historical metrics are not merged with walk-forward or live-forward evidence.'],
  });
}

if (v16?.blockedWalkForwardMetrics) {
  entries.push({
    evidenceId: 'V16_BLOCKED_WALK_FORWARD',
    model: 'V16_9_EQUAL_WEIGHT_BASKET',
    role: 'ACTIVE_CHAMPION_REFERENCE',
    evidenceClass: 'WALK_FORWARD_INTERNAL',
    source: 'data/research/v16-v169-basket-engine.json',
    sourceSection: 'blockedWalkForwardMetrics',
    metrics: metrics(v16.blockedWalkForwardMetrics),
    independence: {
      freshIndependentEvidence: null,
      status: 'INTERNAL_WALK_FORWARD_SOURCE_DOES_NOT_CLAIM_FRESH_EXTERNAL_HOLDOUT',
    },
    decisionUse: 'CHAMPION_REFERENCE',
    caveats: ['Kept separate from fixed-basket metrics and from V20 forward tracking.'],
  });
}

if (v19Native?.development?.metrics) {
  entries.push({
    evidenceId: 'V19_V6_DEVELOPMENT_OOS',
    model: v19Native.engineId || 'V19_CHAT_GPT_NATIVE_CHALLENGER_V6',
    role: 'SHADOW_CHALLENGER',
    evidenceClass: 'DEVELOPMENT_OOS',
    source: 'data/v19/native-challenger-v6.json',
    sourceSection: 'development.metrics',
    metrics: metrics(v19Native.development.metrics),
    independence: {
      freshIndependentEvidence: v19Native?.methodology?.countsAsFreshIndependentEvidence === true,
      status: v19Native?.methodology?.countsAsFreshIndependentEvidence === true ? 'FRESH_INDEPENDENT' : 'NOT_FRESH_INDEPENDENT',
    },
    decisionUse: 'RESEARCH_DIAGNOSTIC_ONLY',
    caveats: [
      'Development OOS evidence is reported even when weaker than the reused benchmark.',
      v19Native?.methodology?.postHocDiagnosticInfluencedBasePolicy ? 'Base policy was influenced by post-hoc diagnostics.' : null,
    ].filter(Boolean),
  });
}

if (v19Lock?.benchmarkResult) {
  entries.push({
    evidenceId: 'V19_V6_REUSED_BENCHMARK',
    model: v19Lock.engineId || 'V19_CHAT_GPT_NATIVE_CHALLENGER_V6',
    role: 'SHADOW_CHALLENGER',
    evidenceClass: 'REUSED_BENCHMARK_NOT_INDEPENDENT',
    source: 'data/v19/v6-research-champion-lock.json',
    sourceSection: 'benchmarkResult',
    metrics: metrics(v19Lock.benchmarkResult),
    independence: {
      freshIndependentEvidence: false,
      status: 'EXPLICITLY_NOT_FRESH_INDEPENDENT',
      benchmarkInformedArchitecture: v19Lock?.governance?.benchmarkInformedArchitecture === true,
    },
    decisionUse: 'RESEARCH_LOCK_REFERENCE_NOT_PROMOTION_EVIDENCE',
    promotionEligible: false,
    caveats: Array.isArray(v19Lock.limitations) ? v19Lock.limitations : [],
  });
}

const forwardRows = Array.isArray(forward.evaluations) ? forward.evaluations : [];
const uniqueSignals = new Set(forwardRows.map(row => row.immutableSignalHash).filter(Boolean));
const statusCounts = forwardRows.reduce((acc, row) => {
  const key = String(row.status || 'UNKNOWN');
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const resolved = forwardRows.filter(row => row.status === 'RESOLVED');
const ambiguous = forwardRows.filter(row => row.status === 'AMBIGUOUS');
const pending = forwardRows.filter(row => row.status === 'PENDING');

entries.push({
  evidenceId: 'V20_LIVE_FORWARD_TRACKING',
  model: current?.governance?.activeChampion || 'V16_9_EQUAL_WEIGHT_BASKET',
  role: 'CURRENT_FORWARD_EVIDENCE',
  evidenceClass: 'LIVE_FORWARD',
  source: 'data/v20/forward-evaluation.json',
  sourceSection: 'evaluations',
  metrics: null,
  forwardState: {
    signalCount: uniqueSignals.size,
    evaluationCount: forwardRows.length,
    resolvedCount: resolved.length,
    ambiguousCount: ambiguous.length,
    pendingCount: pending.length,
    statusCounts,
    horizonsSessions: Array.isArray(forward.horizonsSessions) ? forward.horizonsSessions : [1,3,5,10,20],
  },
  independence: {
    freshIndependentEvidence: true,
    status: 'POINT_IN_TIME_FORWARD_TRACKING',
  },
  decisionUse: resolved.length ? 'FORWARD_EVIDENCE_SEPARATE_FROM_HISTORICAL' : 'PENDING_NO_RETURN_METRIC_YET',
  caveats: [
    'Pending horizons have null returns and are never converted to zero.',
    'Multiple horizons and signal revisions are not averaged into a single headline performance number.',
  ],
});

const v19BenchmarkEntry = entries.find(e => e.evidenceId === 'V19_V6_REUSED_BENCHMARK');
const v19DevelopmentEntry = entries.find(e => e.evidenceId === 'V19_V6_DEVELOPMENT_OOS');
const v18Accepted = v18Audit?.acceptedForPerformanceClaims === true && v18Audit?.reproducible === true;
const out = {
  schemaVersion: '20.0.0-performance-evidence-registry-1',
  generatedAt: new Date().toISOString(),
  decisionSupportOnly: true,
  policy: {
    singleHeadlinePerformanceMetricAllowed: false,
    crossEvidenceAggregationAllowed: false,
    historicalAndForwardEvidenceMustRemainSeparate: true,
    developmentAndHoldoutEvidenceMustRemainSeparate: true,
    reusedBenchmarkCanPromoteChallenger: false,
    pendingForwardReturnMustRemainNull: true,
    v18PerformanceAccepted: v18Accepted,
    v18AuditRequired: true,
  },
  summary: {
    evidenceEntryCount: entries.length,
    activeChampion: current?.governance?.activeChampion || null,
    v19AutomaticPromotion: v19Gate?.automaticPromotion === true,
    v19PromotionAllowed: v19Gate?.promotionAllowed === true,
    v19FreshIndependentEvidenceRequired: v19Gate?.freshIndependentEvidenceRequired === true,
    v19DevelopmentAverageNetReturnPct: v19DevelopmentEntry?.metrics?.averageNetReturnPct ?? null,
    v19ReusedBenchmarkAverageNetReturnPct: v19BenchmarkEntry?.metrics?.averageNetReturnPct ?? null,
    forwardResolvedCount: resolved.length,
    forwardPendingCount: pending.length,
    forwardAmbiguousCount: ambiguous.length,
    v18AuditStatus: v18Audit?.status || 'AUDIT_OUTPUT_MISSING',
    v18DefinitionCoveragePct: finite(v18Audit?.definitions?.definitionCoveragePct),
    status: resolved.length ? 'FORWARD_EVIDENCE_PARTIALLY_RESOLVED' : 'FORWARD_EVIDENCE_PENDING',
  },
  entries,
  externalReferences: {
    v18: {
      auditFile: 'data/v20/v18-performance-audit.json',
      acceptedForPerformanceClaims: v18Accepted,
      reproducible: v18Audit?.reproducible === true,
      status: v18Audit?.status || 'AUDIT_OUTPUT_MISSING',
      sourceArtifactAvailable: v18Audit?.source?.sourceArtifactAvailable === true,
      observedTradeCounts: Array.isArray(v18Audit?.unreconciledClaims?.observedTradeCounts) ? v18Audit.unreconciledClaims.observedTradeCounts : [],
      tradeCountsReconciled: v18Audit?.unreconciledClaims?.reconciled === true,
      definitionCoveragePct: finite(v18Audit?.definitions?.definitionCoveragePct),
      missingDefinitions: Array.isArray(v18Audit?.definitions?.missing) ? v18Audit.definitions.missing : [],
      blockingReasons: Array.isArray(v18Audit?.blockingReasons) ? v18Audit.blockingReasons : [],
      governance: {
        countsAsIndependentEvidence: v18Audit?.governance?.countsAsIndependentEvidence === true,
        canCalibrateV20DecisionScore: v18Audit?.governance?.canCalibrateV20DecisionScore === true,
        canOpenExecutionGate: v18Audit?.governance?.canOpenExecutionGate === true,
        canChangeChampion: v18Audit?.governance?.canChangeChampion === true,
        canPromoteChallenger: v18Audit?.governance?.canPromoteChallenger === true,
      },
      reason: v18Accepted
        ? 'V18 performance source passed the dedicated reproducibility and definition audit. Evidence remains separated by class and does not imply promotion.'
        : 'V18 performance claims remain blocked until the dedicated audit reconciles the source artifact, trade counts and methodology definitions.',
    }
  }
};

if (out.summary.v19AutomaticPromotion || out.summary.v19PromotionAllowed) throw new Error('V19 promotion unexpectedly allowed');
if (v19BenchmarkEntry?.promotionEligible !== false) throw new Error('Reused V19 benchmark must not be promotion evidence');
if (pending.some(row => row.portfolioReturnGrossPct !== null || row.portfolioReturnNetPct !== null)) throw new Error('Pending forward return was populated');
if (out.policy.singleHeadlinePerformanceMetricAllowed !== false || out.policy.crossEvidenceAggregationAllowed !== false) throw new Error('Performance evidence separation policy drift');
if (out.policy.v18PerformanceAccepted !== v18Accepted) throw new Error('V18 audit/registry acceptance mismatch');
if (out.externalReferences.v18.governance.canOpenExecutionGate || out.externalReferences.v18.governance.canChangeChampion || out.externalReferences.v18.governance.canPromoteChallenger) {
  throw new Error('V18 performance audit cannot change execution or model governance');
}

write('data/v20/performance-evidence-registry.json', out);
console.log(JSON.stringify(out.summary, null, 2));
