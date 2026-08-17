#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const ENGINE = 'V16_9_EQUAL_WEIGHT_BASKET';
const OUT = P('data/stable/v16-main-app-intelligence-snapshot.json');

function readJson(rel, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function readText(rel) {
  try { return fs.readFileSync(P(rel), 'utf8'); } catch { return ''; }
}
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const current = readJson('data/stable/v16-main-app-current.json');
const primary = readJson('data/stable/v16-v169-primary-decision.json');
const consensus = readJson('data/stable/v16-main-app-consensus.json');
const priceTruth = readJson('data/stable/v15-price-truth.json');
const analyzer = readText('preview-v16/app/stock-analyzer.js');
const chart = readText('preview-v16/app/stock-analyzer-chart.js');
const decisionUi = readText('preview-v16/app/stock-analyzer-decision.js');

if (current?.governance?.activeEngine !== ENGINE) {
  throw new Error(`MAIN APP engine lock mismatch: ${current?.governance?.activeEngine || 'missing'}`);
}
if (primary?.selectedModel?.id && primary.selectedModel.id !== ENGINE) {
  throw new Error(`Primary decision engine mismatch: ${primary.selectedModel.id}`);
}

const recs = Array.isArray(primary.recommendations)
  ? primary.recommendations
  : Array.isArray(current.recommendations) ? current.recommendations : [];
const consensusRows = Array.isArray(consensus?.current?.mainAppAnnotations)
  ? consensus.current.mainAppAnnotations : [];
const consensusByTicker = new Map(consensusRows.map(row => [String(row?.ticker || '').toUpperCase(), row]));

const capability = {
  technical: analyzer.includes('technicalAnalysis') && analyzer.includes('fibonacci'),
  financial: analyzer.includes('fundamentalScore') && analyzer.includes('trailingPE') && analyzer.includes('priceToBook'),
  news: analyzer.includes('newsSummary') && analyzer.includes('sentimentForTitle'),
  chart: chart.includes('EMA20') && chart.includes('RSI(14)') && chart.includes('Fibonacci'),
  portfolioDecision: decisionUi.includes('إلغاء القرار') && decisionUi.includes('الهدف الأقرب'),
};

const recommendations = recs.map(row => {
  const ticker = String(row?.ticker || '').toUpperCase();
  const consensusRow = consensusByTicker.get(ticker) || null;
  return {
    ticker,
    rank: row?.rank ?? null,
    signalDate: primary.sessionDate || current.sessionDate || null,
    publishedAt: primary.generatedAt || current.generatedAt || null,
    referenceClose: row?.close ?? row?.recommendationClose ?? null,
    entryLow: row?.entryLow ?? null,
    entryHigh: row?.entryHigh ?? null,
    stopLoss: row?.stopLoss ?? null,
    target1: row?.target1 ?? null,
    weightPct: row?.portfolioWeightPct ?? row?.weightPct ?? null,
    consensus: consensusRow,
    intelligenceAtIssue: {
      technicalCapabilityAvailable: capability.technical,
      financialCapabilityAvailable: capability.financial,
      newsCapabilityAvailable: capability.news,
      chartCapabilityAvailable: capability.chart,
      portfolioDecisionCapabilityAvailable: capability.portfolioDecision,
      persistedFinancialValues: null,
      persistedNewsItems: [],
      dataAvailabilityNote: 'Capabilities are present in the analyzer, but only values actually persisted at publication time may be treated as auditable evidence. No synthetic or later-fetched values are backfilled.',
    },
  };
});

const out = {
  schemaVersion: '16.9.2-auditable-intelligence-snapshot-v1',
  generatedAt: new Date().toISOString(),
  engine: ENGINE,
  sessionDate: primary.sessionDate || current.sessionDate || null,
  immutableMethodology: {
    changesAlphaOrRanking: false,
    changesEntryStopTargetAllocation: false,
    changesExecutionGrant: false,
    purpose: 'Audit/explainability only. This snapshot cannot rank, filter, replace, or mutate MAIN APP recommendations.',
  },
  automaticDataContext: {
    priceTruthGeneratedAt: priceTruth.generatedAt || null,
    executionGrade: priceTruth.executionGrade === true,
    sourceSessionEvidenceCoveragePct: priceTruth?.source?.sourceSessionEvidenceCoveragePct ?? null,
    acceptedRows: priceTruth.acceptedRows ?? null,
    inputRows: priceTruth?.source?.inputRows ?? null,
  },
  capabilitiesAtSnapshot: capability,
  recommendations,
  auditCompleteness: {
    recommendationCount: recommendations.length,
    consensusRowsMatched: recommendations.filter(r => r.consensus).length,
    technicalCapabilityPersisted: capability.technical,
    financialCapabilityPresentButValuesNotYetPersisted: capability.financial,
    newsCapabilityPresentButItemsNotYetPersisted: capability.news,
    noRetroactiveFinancialOrNewsBackfill: true,
  },
};
out.snapshotHash = sha({
  engine: out.engine,
  sessionDate: out.sessionDate,
  automaticDataContext: out.automaticDataContext,
  recommendations: out.recommendations,
  immutableMethodology: out.immutableMethodology,
});
writeAtomic(OUT, out);
console.log(JSON.stringify({
  output: path.relative(ROOT, OUT),
  engine: out.engine,
  sessionDate: out.sessionDate,
  recommendationCount: recommendations.length,
  executionGrade: out.automaticDataContext.executionGrade,
  changesAlphaOrRanking: out.immutableMethodology.changesAlphaOrRanking,
  snapshotHash: out.snapshotHash,
}, null, 2));
