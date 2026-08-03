#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const STATUS_PATH = path.join(ROOT, 'data/stable/v15-update-status.json');
const DECISION_PATH = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const PRICE_PATH = path.join(ROOT, 'data/stable/v15-price-truth.json');
const EVALUATION_PATH = path.join(ROOT, 'data/stable/v15-recommendation-evaluation.json');
const FUNDAMENTAL_PATH = path.join(ROOT, 'data/stable/v16-fundamental-analysis.json');

function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}

const old = readJson(STATUS_PATH, {});
const decision = readJson(DECISION_PATH, {});
const price = readJson(PRICE_PATH, {});
const evaluation = readJson(EVALUATION_PATH, {});
const fundamental = readJson(FUNDAMENTAL_PATH, {});
const generatedAt = new Date().toISOString();
const status = {
  ...old,
  schemaVersion: '16.1.1',
  generatedAt,
  lastAutomaticScanAt: old.lastAutomaticScanAt || generatedAt,
  productInterface: 'EGX_PROFESSIONAL_V16_1',
  evidenceTier: decision.evidenceTier || old.evidenceTier || 'RESEARCH',
  professionalEvidenceReady: decision.professionalEvidenceReady === true,
  sessionDate: decision.sessionDate || old.sessionDate || null,
  expectedLatestSession: decision.expectedLatestSession || price.expectedSession || old.expectedLatestSession || null,
  recommendationGeneratedAt: decision.generatedAt || null,
  recommendationsReady: decision.practicalReady === true,
  recommendationCount: Array.isArray(decision.recommendations) ? decision.recommendations.length : 0,
  recommendationTickers: Array.isArray(decision.recommendations) ? decision.recommendations.map(row => row.ticker) : [],
  priceTruth: {
    ...(old.priceTruth || {}),
    ready: price.ready === true,
    executionGrade: price.executionGrade === true,
    acceptedRows: price.acceptedRows || 0,
    source: price.source?.name || old.priceTruth?.source || null,
    sourceGeneratedAt: price.source?.generatedAt || old.priceTruth?.sourceGeneratedAt || null,
  },
  fundamentals: {
    generatedAt: fundamental.generatedAt || null,
    methodology: fundamental.methodology?.name || null,
    marketUniverse: fundamental.summary?.marketUniverse || 0,
    rawCoverage: fundamental.summary?.rawCoverage || 0,
    scoredCompanies: fundamental.summary?.scoredCompanies || 0,
    freshStatements: fundamental.summary?.freshStatements || 0,
    staleStatements: fundamental.summary?.staleStatements || 0,
    currentRecommendationCoverage: fundamental.summary?.currentRecommendationFinancialCoverage || 0,
    currentRecommendationCount: fundamental.summary?.currentRecommendationCount || 0,
    officialVerifiedCompanies: fundamental.summary?.officialVerifiedCompanies || 0,
    qualityGate: fundamental.qualityGate?.version || null,
  },
  evaluationGeneratedAt: evaluation.generatedAt || null,
  evaluationArchivedRecommendations: evaluation.summary?.archivedRecommendations || 0,
  liveResolvedTrades: evaluation.summary?.resolvedTrades || 0,
  liveEvidenceGate: (evaluation.summary?.resolvedTrades || 0) >= 100 ? 'PROFESSIONAL' : (evaluation.summary?.resolvedTrades || 0) >= 30 ? 'ADVANCED_PILOT' : 'RESEARCH',
};
writeJson(STATUS_PATH, status);
console.log(JSON.stringify({ productInterface: status.productInterface, financialGeneratedAt: status.fundamentals.generatedAt, financialCoverage: status.fundamentals.currentRecommendationCoverage, recommendationCount: status.recommendationCount }, null, 2));
