import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeMetaOpportunity, rankMetaOpportunities } from '../src/metaEngine.js';

const SOURCES = Object.freeze({
  triple: 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/research/triple-engine-consensus-v1/triple-engine/data/current.json',
  v16: 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/stable/v15-practical-decision.json',
  regime: 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/stable/v16-market-regime.json',
  v20: 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/develop/v20-integrated-decision-platform/data/v20/native-current.json'
});

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'egx-meta-engine-research' } });
  if (!res.ok) throw new Error(`FETCH_FAILED ${res.status} ${url}`);
  return res.json();
}

function liquidityFromTurnover(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  if (v >= 10_000_000) return 100;
  if (v >= 5_000_000) return 90;
  if (v >= 2_000_000) return 70;
  if (v >= 1_000_000) return 55;
  if (v >= 500_000) return 35;
  return 15;
}

const [triple, v16, regime, v20] = await Promise.all([
  fetchJson(SOURCES.triple),
  fetchJson(SOURCES.v16),
  fetchJson(SOURCES.regime),
  fetchJson(SOURCES.v20)
]);

const session = triple.marketSession;
const v16Aligned = v16.sessionDate === session;
const regimeAligned = regime?.metrics?.sessionDate === session;
const v20Aligned = v20.sessionDate === session;
const v16Map = new Map((v16.recommendations || []).map(x => [String(x.ticker).toUpperCase(), x]));
const v20Map = new Map((v20.publishedCandidates || []).map(x => [String(x.ticker).toUpperCase(), x]));

const rows = [];
for (const row of triple.rows || []) {
  const ticker = String(row.ticker || '').toUpperCase();
  const v16Rec = v16Aligned ? v16Map.get(ticker) : null;
  const v20Rec = v20Aligned ? v20Map.get(ticker) : null;
  const engines = [];

  const a = row.engines?.V16_9;
  if (a?.present) engines.push({
    id: 'V16_9', family: 'V16_PROBABILISTIC', signalScore: a.score,
    evidenceClass: 'WALK_FORWARD_POINT_IN_TIME',
    sampleSize: v16?.selectedModel?.validation?.sessions ?? 0,
    hitRatePct: v16?.selectedModel?.validation?.winRatePct ?? null,
    dataQuality: row.ready ? 100 : 0
  });

  const s = row.engines?.SEPA_X;
  if (s?.present) engines.push({
    id: 'SEPA_X', family: 'SEPA_STAGE_TREND', signalScore: s.score,
    evidenceClass: 'CURRENT_SNAPSHOT_ONLY', dataQuality: row.ready ? 100 : 0
  });

  const g = row.engines?.GANN_FUSION_X;
  if (g?.present) engines.push({
    id: 'GANN_FUSION_X', family: 'GANN_GEOMETRY', signalScore: g.score,
    evidenceClass: 'CURRENT_SNAPSHOT_ONLY', dataQuality: row.ready ? 100 : 0
  });

  if (v20Rec) engines.push({
    id: 'V20_NATIVE', family: 'TFE_MULTI_COMPONENT', signalScore: v20Rec.nativeResearchScore,
    evidenceClass: 'RETROSPECTIVE_POINT_IN_TIME', dataQuality: row.ready ? 100 : 0
  });

  const geometry = v16Rec || v20Rec || null;
  const rr = Number(v16Rec?.riskReward ?? v20Rec?.netRiskReward ?? 0);
  const expectedEdgePct = Number(v16Rec?.outOfSampleAverageReturnPct ?? 0);
  const costPct = Number(v20Rec?.tradePlan?.roundTripTransactionCostPct ?? 0.6);
  const liquidityScore = v16Rec ? liquidityFromTurnover(v16Rec.averageTurnover20Egp) : Number(v20Rec?.liquidity2Score ?? 0);

  const analyzed = analyzeMetaOpportunity({
    ticker,
    dataQuality: row.ready ? 75 : 0,
    liquidityScore,
    netRiskReward: rr,
    expectedEdgePct,
    estimatedRoundTripCostPct: costPct,
    marketRegime: regimeAligned ? regime.regime : 'NEUTRAL',
    engines
  });

  rows.push({
    ...analyzed,
    sourceConsensus: row.consensus,
    sourceEngineCount: row.engineCount,
    executionGeometryAvailable: Boolean(geometry),
    v16GeometryAvailable: Boolean(v16Rec),
    v20GeometryAvailable: Boolean(v20Rec),
    sourceSessions: {
      metaSession: session,
      v16: v16.sessionDate,
      regime: regime?.metrics?.sessionDate ?? null,
      v20: v20.sessionDate
    }
  });
}

const ranked = rankMetaOpportunities(rows);
const report = {
  schemaVersion: 'meta-engine-live-shadow-1',
  generatedAt: new Date().toISOString(),
  status: 'RESEARCH_SHADOW_ONLY',
  sessionDate: session,
  sourceAlignment: { v16Aligned, regimeAligned, v20Aligned },
  dataReadiness: triple.dataReadiness,
  sourceConsensusStatus: triple.consensusStatus,
  sources: SOURCES,
  methodology: {
    sameSessionOnly: true,
    staleEngineTreatment: 'EXCLUDED_FROM_LIVE_CONTRIBUTION',
    missingEngineTreatment: 'NEUTRAL_NOT_BEARISH',
    executionGeometry: 'V16_SAME_SESSION_FIRST_THEN_V20_SAME_SESSION; OTHERWISE HARD_GATES_FORCE_NO_TRADE',
    dataQualityForReadyRows: 'MINIMUM_GATE_FLOOR_75_NOT_FULL_QUALITY_BONUS',
    sepaAndGannEvidence: 'CURRENT_SNAPSHOT_ONLY_UNTIL_POINT_IN_TIME_PERFORMANCE_IS_AVAILABLE',
    automaticExecution: false
  },
  summary: {
    evaluated: ranked.length,
    buy: ranked.filter(x => x.decision === 'BUY').length,
    ready: ranked.filter(x => x.decision === 'READY').length,
    watch: ranked.filter(x => x.decision === 'WATCH').length,
    noTrade: ranked.filter(x => x.decision === 'NO_TRADE').length,
    withExecutionGeometry: ranked.filter(x => x.executionGeometryAvailable).length
  },
  rows: ranked,
  executionLocks: {
    researchOnly: true,
    executionAllowed: false,
    automaticOrders: false,
    automaticPromotion: false
  }
};

await fs.mkdir(path.resolve('reports'), { recursive: true });
await fs.writeFile(path.resolve('reports/meta-live-shadow.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  sessionDate: report.sessionDate,
  sourceAlignment: report.sourceAlignment,
  summary: report.summary,
  top: ranked.slice(0, 10).map(x => ({ ticker: x.ticker, decision: x.decision, metaScore: x.metaScore, blocking: x.gates.blocking }))
}, null, 2));
