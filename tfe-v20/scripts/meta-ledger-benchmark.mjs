import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCES = Object.freeze({
  challengerLedger: 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/stable/v16-main-app-challenger-ledger.json',
  liveOutcomes: 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/stable/v16-v169-live-evaluation.json',
  enginePerformance: 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/stable/v16-main-app-engine-performance.json'
});

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'egx-meta-engine-research' } });
  if (!res.ok) throw new Error(`FETCH_FAILED ${res.status} ${url}`);
  return res.json();
}

const round = (v, d = 2) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const key = (date, ticker) => `${date}::${String(ticker || '').trim().toUpperCase()}`;

function metrics(rows) {
  const entered = rows.filter(x => !['CASH_UNFILLED', 'WAITING'].includes(x.memberStatus));
  const target = entered.filter(x => x.memberStatus === 'TARGET_HIT').length;
  const stop = entered.filter(x => x.memberStatus === 'STOP_HIT').length;
  const timeExit = entered.filter(x => x.memberStatus === 'TIME_EXIT').length;
  const returns = entered.map(x => Number(x.netReturnPct)).filter(Number.isFinite);
  const gains = returns.filter(x => x > 0).reduce((a, b) => a + b, 0);
  const losses = Math.abs(returns.filter(x => x < 0).reduce((a, b) => a + b, 0));
  const targetRate = entered.length ? target / entered.length * 100 : 0;
  const stopRate = entered.length ? stop / entered.length * 100 : 0;
  return {
    selectionCount: rows.length,
    enteredCount: entered.length,
    targetCount: target,
    targetRatePct: round(targetRate),
    stopCount: stop,
    stopRatePct: round(stopRate),
    targetMinusStopEdgePct: round(targetRate - stopRate),
    timeExitCount: timeExit,
    averageNetReturnPct: returns.length ? round(returns.reduce((a, b) => a + b, 0) / returns.length, 4) : null,
    positiveNetReturnPct: returns.length ? round(returns.filter(x => x > 0).length / returns.length * 100) : null,
    profitFactor: losses > 0 ? round(gains / losses, 3) : gains > 0 ? null : 0
  };
}

function isCausallyFrozen(sessionDate, firstCapturedAt) {
  if (!firstCapturedAt) return false;
  return String(firstCapturedAt).slice(0, 10) === String(sessionDate);
}

const [ledger, outcomes, enginePerformance] = await Promise.all([
  fetchJson(SOURCES.challengerLedger),
  fetchJson(SOURCES.liveOutcomes),
  fetchJson(SOURCES.enginePerformance)
]);

const outcomeMap = new Map();
for (const session of outcomes.sessions || []) {
  for (const member of session.members || []) {
    outcomeMap.set(key(session.signalDate, member.ticker), {
      ...member,
      signalDate: session.signalDate,
      estimatedRoundTripCostPct: session.estimatedRoundTripCostPct ?? null
    });
  }
}

const joined = [];
const rejectedForCausality = [];
for (const session of ledger.sessions || []) {
  for (const row of session.rows || []) {
    const out = outcomeMap.get(key(session.sessionDate, row.ticker));
    if (!out) continue;
    if (!isCausallyFrozen(session.sessionDate, session.firstCapturedAt)) {
      rejectedForCausality.push({ sessionDate: session.sessionDate, ticker: row.ticker, firstCapturedAt: session.firstCapturedAt });
      continue;
    }
    joined.push({
      signalDate: session.sessionDate,
      ticker: row.ticker,
      mainAppRank: row.mainAppRank,
      shadowConfirmationScore: row.shadowConfirmationScore,
      evidenceCoveragePct: row.evidenceCoveragePct,
      shadowLabel: row.shadowLabel,
      memberStatus: out.memberStatus,
      netReturnPct: out.netReturnPct,
      reasonCode: out.reasonCode,
      firstCapturedAt: session.firstCapturedAt,
      outcomeDate: out.outcomeDate
    });
  }
}

const all = metrics(joined);
const support = metrics(joined.filter(x => x.shadowLabel === 'SUPPORT'));
const neutral = metrics(joined.filter(x => x.shadowLabel === 'NEUTRAL'));
const coverage75 = metrics(joined.filter(x => Number(x.evidenceCoveragePct) >= 75));
const primaryBaseline = (enginePerformance.rows || []).find(x => x.id === 'MAIN_APP_V16_9') || null;

const supportEdgeUpliftVsMatchedAll = support.enteredCount && all.enteredCount
  ? round(support.targetMinusStopEdgePct - all.targetMinusStopEdgePct)
  : null;
const supportStopDeltaVsMatchedAll = support.enteredCount && all.enteredCount
  ? round(support.stopRatePct - all.stopRatePct)
  : null;

const evidenceGate = {
  minimumSupportEntered: 12,
  minimumEdgeUpliftPctPoints: 5,
  maximumStopDeteriorationPctPoints: 0,
  checks: {
    sample: support.enteredCount >= 12,
    edgeUplift: supportEdgeUpliftVsMatchedAll != null && supportEdgeUpliftVsMatchedAll >= 5,
    stopNotWorse: supportStopDeltaVsMatchedAll != null && supportStopDeltaVsMatchedAll <= 0
  }
};
evidenceGate.passes = Object.values(evidenceGate.checks).every(Boolean);

const report = {
  schemaVersion: 'meta-engine-frozen-shadow-ledger-benchmark-1',
  generatedAt: new Date().toISOString(),
  status: 'DIAGNOSTIC_ONLY_NOT_META_ENGINE_PROMOTION_EVIDENCE',
  evidenceClass: 'FROZEN_SHADOW_LEDGER_JOINED_TO_SUBSEQUENT_OUTCOMES',
  methodology: {
    purpose: 'Test whether pre-outcome confirmation labels separated stronger from weaker V16 selections without tuning a new threshold on outcomes.',
    joinKey: 'signalDate+ticker',
    causalRule: 'challenger ledger firstCapturedAt date must equal signalDate',
    outcomeSource: 'V16 live member outcomes',
    executionTreatment: 'reuse recorded memberStatus and netReturnPct; no outcome reconstruction',
    importantLimitation: 'This validates the evidence-gating concept, not the full new Meta-Engine. Full promotion remains blocked until the new engine is replayed point-in-time.'
  },
  sources: SOURCES,
  coverage: {
    ledgerSessions: (ledger.sessions || []).length,
    outcomeSessions: (outcomes.sessions || []).length,
    joinedRows: joined.length,
    rejectedForCausalityCount: rejectedForCausality.length
  },
  matchedSample: { all, support, neutral, coverage75 },
  deltas: {
    supportEdgeUpliftVsMatchedAllPctPoints: supportEdgeUpliftVsMatchedAll,
    supportStopDeltaVsMatchedAllPctPoints: supportStopDeltaVsMatchedAll
  },
  evidenceGate,
  primaryBaselineReference: primaryBaseline ? {
    evidenceClass: primaryBaseline.evidenceClass,
    auditSessions: primaryBaseline.auditSessions,
    executableCount: primaryBaseline.executableCount,
    targetRatePct: primaryBaseline.targetRatePct,
    stopRatePct: primaryBaseline.stopRatePct,
    targetMinusStopEdgePct: round(Number(primaryBaseline.targetRatePct) - Number(primaryBaseline.stopRatePct))
  } : null,
  promotionEligible: false,
  promotionBlockReasons: [
    'FULL_META_ENGINE_NOT_REPLAYED_POINT_IN_TIME',
    'SUPPORT_LABEL_BENCHMARK_IS_CONCEPT_EVIDENCE_ONLY',
    'FRESH_INDEPENDENT_FORWARD_SAMPLE_NOT_AVAILABLE'
  ],
  rows: joined,
  rejectedForCausality
};

await fs.mkdir(path.resolve('reports'), { recursive: true });
await fs.writeFile(path.resolve('reports/meta-ledger-benchmark.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  status: report.status,
  joinedRows: joined.length,
  all,
  support,
  neutral,
  evidenceGate
}, null, 2));
