import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTickerBase } from '../src/engine.js';
import { evaluateRegisteredMetaCandidate } from '../src/meta-pipeline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);

const triplePath = path.join(ROOT, 'tfe-v20/evidence/external/triple-engine-current-2026-08-27.json');
const triple = read(triplePath);
const expectedSessionDate = triple.marketSession ?? null;

function externalSignal(engineId, payload) {
  if (!payload?.present) return null;
  const decision = String(payload.decision ?? '').toUpperCase();
  let signal = decision;
  if (engineId === 'V16_9') {
    if (decision.includes('PRIMARY')) signal = 'READY';
    else if (decision.includes('CONDITIONAL') || decision.includes('RESERVE')) signal = 'WATCH';
    else if (decision.includes('BUY') || decision.includes('ENTER')) signal = 'BUY';
  }
  if (engineId === 'SEPA_X' && decision === 'WATCH TRIGGER') signal = 'WATCH TRIGGER';
  if (engineId === 'GANN_FUSION_X' && decision === 'ACTIONABLE') signal = 'ACTIONABLE';
  return { id: engineId, signal, score: payload.score ?? null };
}

function loadContext(ticker) {
  const historyPath = path.join(ROOT, 'data/history', `${ticker}.json`);
  if (!exists(historyPath)) return { status: 'HISTORY_NOT_SYNCED', analysis: null };
  const doc = read(historyPath);
  const rows = Array.isArray(doc.sessions) ? doc.sessions : [];
  const analysis = analyzeTickerBase({
    ticker,
    nameAr: doc.companyNameAr ?? null,
    nameEn: doc.companyNameEn ?? null,
    rows,
    expectedSessionDate,
    historyMeta: {
      warnings: doc.warnings ?? [],
      updateFailed: doc.updateFailed ?? false,
      staleData: doc.staleData ?? false,
      symbolVerified: doc.symbolVerified,
      symbolVerification: doc.symbolVerification,
      officiallyVerifiedLatestSession: doc.officiallyVerifiedLatestSession,
    },
    includeOverlay: false,
  });
  return { status: 'OK', analysis, historyMeta: { availableSessions: doc.availableSessions ?? rows.length, lastSession: doc.lastSession ?? rows.at(-1)?.date ?? null, generatedAt: doc.generatedAt ?? null } };
}

const candidates = [];
for (const row of triple.rows ?? []) {
  const ticker = String(row.ticker ?? '').toUpperCase();
  if (!ticker) continue;
  const ctx = loadContext(ticker);
  if (!ctx.analysis) {
    candidates.push({ ticker, status: ctx.status, meta: null });
    continue;
  }
  const a = ctx.analysis;
  const experts = [
    externalSignal('V16_9', row.engines?.V16_9),
    externalSignal('SEPA_X', row.engines?.SEPA_X),
    externalSignal('GANN_FUSION_X', row.engines?.GANN_FUSION_X),
    { id: 'TFE_CORE', signal: a.decision, score: a.scores?.research ?? null, dataQuality: a.quality?.score ?? null },
    // Diagnostic only: canonical pipeline must exclude this composite from voting.
    { id: 'TRIPLE_ENGINE', signal: row.engineCount >= 2 ? 'READY' : 'WATCH', score: row.engineCount >= 2 ? 75 : 55 },
  ].filter(Boolean);

  const result = evaluateRegisteredMetaCandidate({
    ticker,
    quality: a.quality,
    liquidity: a.liquidity,
    tradePlan: a.tradePlan,
    market: { regime: 'UNKNOWN', confidence: null },
    experts,
  });

  candidates.push({
    ticker,
    status: 'EVALUATED',
    sourceConsensus: row.consensus,
    sourceEngineCount: row.engineCount,
    history: ctx.historyMeta,
    tfeContext: {
      decision: a.decision,
      eligible: a.eligible,
      reasonCodes: a.reasonCodes,
      researchScore: a.scores?.research ?? null,
      technicalScore: a.scores?.technical ?? null,
      liquidityScore: a.liquidity?.score ?? null,
      dataQualityScore: a.quality?.score ?? null,
      supportResistanceScore: a.supportResistance?.score ?? null,
    },
    meta: result,
  });
}

const evaluated = candidates.filter((x) => x.meta);
const priority = { BUY: 4, READY: 3, WATCH: 2, NO_TRADE: 1 };
evaluated.sort((a, b) =>
  (priority[b.meta.decision] ?? 0) - (priority[a.meta.decision] ?? 0)
  || b.meta.edgeScore - a.meta.edgeScore
  || b.meta.confidence - a.meta.confidence
  || a.ticker.localeCompare(b.ticker)
);
evaluated.forEach((x, i) => { x.rank = i + 1; });

const snapshot = {
  schemaVersion: 'egx-meta-engine-current-snapshot-v1',
  generatedAt: new Date().toISOString(),
  engineId: 'EGX_META_ENGINE_V1',
  mode: 'RESEARCH_SHADOW_ONLY',
  marketSession: expectedSessionDate,
  source: {
    tripleEngine: path.relative(ROOT, triplePath).replaceAll('\\', '/'),
    contextEngine: 'TFE_V20_BASE_ON_SYNCED_POINT_IN_TIME_HISTORY',
  },
  governance: {
    executionAllowed: false,
    automaticPromotion: false,
    tripleCompositeVotingAllowed: false,
    unknownTradeCriticalInputs: 'NO_TRADE',
  },
  summary: {
    tripleRows: (triple.rows ?? []).length,
    evaluated: evaluated.length,
    historyNotSynced: candidates.filter((x) => !x.meta).length,
    buy: evaluated.filter((x) => x.meta.decision === 'BUY').length,
    ready: evaluated.filter((x) => x.meta.decision === 'READY').length,
    watch: evaluated.filter((x) => x.meta.decision === 'WATCH').length,
    noTrade: evaluated.filter((x) => x.meta.decision === 'NO_TRADE').length,
  },
  evaluated,
  skipped: candidates.filter((x) => !x.meta).map((x) => ({ ticker: x.ticker, status: x.status })),
};

const outDir = path.join(ROOT, 'tfe-v20/evidence/meta');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'current-meta-snapshot.json');
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');

console.log(JSON.stringify({
  marketSession: snapshot.marketSession,
  summary: snapshot.summary,
  ranking: snapshot.evaluated.map((x) => ({ rank: x.rank, ticker: x.ticker, decision: x.meta.decision, edgeScore: x.meta.edgeScore, confidence: x.meta.confidence, blocks: x.meta.blocks })),
}, null, 2));
