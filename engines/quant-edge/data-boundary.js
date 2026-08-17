'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { validateBars } = require('./core');

const ALLOWED_GRADES = new Set(['ANALYSIS_GRADE', 'EXECUTION_GRADE']);

function hashSnapshot(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function validateIndependentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('QUANT_EDGE_SNAPSHOT_REQUIRED');
  if (!ALLOWED_GRADES.has(String(snapshot.sourceGrade || '').toUpperCase())) throw new Error('QUANT_EDGE_SOURCE_NOT_ANALYSIS_GRADE');
  const origin = String(snapshot.origin || '').toUpperCase();
  if (!origin || /MAIN[_ -]?APP|MAIN[_ -]?RECOMMEND|MAIN[_ -]?RANK|MAIN[_ -]?SCORE/.test(origin)) {
    throw new Error('QUANT_EDGE_NON_INDEPENDENT_SOURCE_ORIGIN');
  }
  if (!snapshot.benchmark || !Array.isArray(snapshot.benchmark.bars)) throw new Error('QUANT_EDGE_BENCHMARK_SNAPSHOT_REQUIRED');
  validateBars(snapshot.benchmark.bars);
  if (!Array.isArray(snapshot.symbols) || !snapshot.symbols.length) throw new Error('QUANT_EDGE_SYMBOL_SNAPSHOTS_REQUIRED');
  for (const symbol of snapshot.symbols) {
    if (!symbol.ticker) throw new Error('QUANT_EDGE_SNAPSHOT_TICKER_REQUIRED');
    validateBars(symbol.bars);
  }
  return true;
}

function loadIndependentSnapshot(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const snapshot = JSON.parse(raw);
  validateIndependentSnapshot(snapshot);
  return { snapshot, sha256: hashSnapshot(snapshot) };
}

function toUniverse(snapshot) {
  validateIndependentSnapshot(snapshot);
  const sectors = snapshot.sectors || {};
  const brokerByTicker = snapshot.brokerRecommendationsByTicker || {};
  return snapshot.symbols.map(s => ({
    ticker: String(s.ticker).toUpperCase(),
    bars: s.bars,
    benchmarkBars: snapshot.benchmark.bars,
    sectorBars: s.sector && sectors[s.sector] ? sectors[s.sector].bars : null,
    brokerRecommendations: brokerByTicker[String(s.ticker).toUpperCase()] || [],
    brokerStats: snapshot.brokerStats || {},
  }));
}

module.exports = { validateIndependentSnapshot, loadIndependentSnapshot, toUniverse, hashSnapshot };
