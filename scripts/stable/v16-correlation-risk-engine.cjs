#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DECISION_PATH = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const MARKET_PATH = path.join(ROOT, 'data/quant/market-search-index-v13-17.json');
const FUNDAMENTAL_PATH = path.join(ROOT, 'data/stable/v16-fundamental-analysis.json');
const REGIME_PATH = path.join(ROOT, 'data/stable/v16-market-regime.json');
const HISTORY_DIR = path.join(ROOT, 'data/history');
const OUT_PATH = path.join(ROOT, 'data/stable/v16-correlation-risk.json');

const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 3) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function closes(ticker) {
  const document = readJson(path.join(HISTORY_DIR, `${ticker}.json`), {});
  const rows = Array.isArray(document.sessions) ? document.sessions : Array.isArray(document) ? document : [];
  return rows
    .map(row => ({ date: String(row.date || row.sessionDate || '').slice(0, 10), close: num(row.close) }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function returnsByDate(rows, lookback = 60) {
  const slice = rows.slice(-(lookback + 1));
  const map = new Map();
  for (let i = 1; i < slice.length; i += 1) map.set(slice[i].date, (slice[i].close / slice[i - 1].close - 1) * 100);
  return map;
}
function pearson(a, b) {
  const dates = [...a.keys()].filter(date => b.has(date));
  if (dates.length < 20) return { value: null, observations: dates.length };
  const xs = dates.map(date => a.get(date));
  const ys = dates.map(date => b.get(date));
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let numerator = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i] - mx;
    const y = ys[i] - my;
    numerator += x * y;
    dx += x * x;
    dy += y * y;
  }
  const denominator = Math.sqrt(dx * dy);
  return { value: denominator > 0 ? round(numerator / denominator, 3) : null, observations: dates.length };
}
function main() {
  const decision = readJson(DECISION_PATH, { recommendations: [] });
  const market = readJson(MARKET_PATH, { stocks: [] });
  const fundamental = readJson(FUNDAMENTAL_PATH, { records: [] });
  const regime = readJson(REGIME_PATH, {});
  const recs = decision.recommendations || [];
  const tickerSet = new Set(recs.map(row => String(row.ticker || '').toUpperCase()));
  const returnMaps = new Map();
  for (const ticker of tickerSet) returnMaps.set(ticker, returnsByDate(closes(ticker)));
  const matrix = [];
  const highCorrelationPairs = [];
  for (const left of tickerSet) {
    const row = { ticker: left, correlations: {} };
    for (const right of tickerSet) {
      if (left === right) row.correlations[right] = { value: 1, observations: returnMaps.get(left)?.size || 0 };
      else {
        const result = pearson(returnMaps.get(left) || new Map(), returnMaps.get(right) || new Map());
        row.correlations[right] = result;
        if (left < right && result.value !== null && result.value >= 0.7) highCorrelationPairs.push({ left, right, correlation: result.value, observations: result.observations, severity: result.value >= 0.85 ? 'HIGH' : 'MEDIUM' });
      }
    }
    matrix.push(row);
  }
  const financialMap = new Map((fundamental.records || []).map(row => [String(row.ticker || '').toUpperCase(), row]));
  const groups = {};
  for (const rec of recs) {
    const ticker = String(rec.ticker || '').toUpperCase();
    const financial = financialMap.get(ticker);
    const sector = financial?.classification?.sector || financial?.classification?.template || 'غير مصنف';
    groups[sector] = (groups[sector] || 0) + 1;
  }
  const sectorConcentration = Object.entries(groups).map(([sector, count]) => ({ sector, count, sharePct: round(count / Math.max(1, recs.length) * 100, 1) })).sort((a, b) => b.count - a.count);
  const averageCorrelationValues = highCorrelationPairs.map(row => row.correlation);
  const averageHighPairCorrelation = averageCorrelationValues.length ? round(averageCorrelationValues.reduce((a, b) => a + b, 0) / averageCorrelationValues.length) : null;
  const riskMultiplier = num(regime.riskMultiplier) ?? 0.65;
  const equalWeight = recs.length ? 1 / recs.length : 0;
  const stressScenarios = [
    { id: 'MARKET_GAP_5', labelAr: 'فجوة سوقية -5%', assumedMovePct: -5, equalWeightPortfolioImpactPct: recs.length ? -5 : null },
    { id: 'RISK_OFF_8', labelAr: 'صدمة سوق دفاعي -8%', assumedMovePct: -8, equalWeightPortfolioImpactPct: recs.length ? round(-8 * (0.7 + 0.3 * riskMultiplier), 2) : null },
    { id: 'SECTOR_SHOCK_10', labelAr: 'صدمة -10% لأكبر قطاع', assumedMovePct: -10, equalWeightPortfolioImpactPct: sectorConcentration.length ? round(-10 * sectorConcentration[0].sharePct / 100, 2) : null },
    { id: 'CORRELATED_STOP_CLUSTER', labelAr: 'تزامن وقف الأسهم الأعلى ارتباطًا', assumedMovePct: null, equalWeightPortfolioImpactPct: highCorrelationPairs.length ? round(-Math.min(6, 2 + highCorrelationPairs.length * 0.8), 2) : 0 }
  ];
  const warnings = [];
  if (highCorrelationPairs.some(row => row.correlation >= 0.85)) warnings.push('VERY_HIGH_PAIR_CORRELATION');
  if (sectorConcentration[0]?.sharePct > 40) warnings.push('SECTOR_CONCENTRATION_ABOVE_40');
  if (regime.regime === 'RISK_OFF' || regime.regime === 'HIGH_VOLATILITY') warnings.push('MARKET_REGIME_REQUIRES_LOWER_EXPOSURE');
  const out = {
    schemaVersion: '16.3.0',
    generatedAt: new Date().toISOString(),
    methodology: {
      name: 'EGX_PRO_CORRELATION_PORTFOLIO_RISK_1.0',
      returnWindowSessions: 60,
      minimumPairObservations: 20,
      correlationThreshold: 0.7,
      principles: [
        'Correlation is computed from aligned daily close-to-close returns.',
        'Correlation reduces diversification benefit but does not predict direction.',
        'Stress scenarios are deterministic risk illustrations, not forecasts.'
      ]
    },
    recommendationCount: recs.length,
    tickers: [...tickerSet],
    matrix,
    highCorrelationPairs,
    sectorConcentration,
    summary: {
      highCorrelationPairCount: highCorrelationPairs.length,
      averageHighPairCorrelation,
      largestSector: sectorConcentration[0] || null,
      regime: regime.regime || 'UNKNOWN',
      regimeRiskMultiplier: riskMultiplier,
      suggestedMaximumPositions: regime.regime === 'RISK_ON' ? 5 : regime.regime === 'NEUTRAL' ? 3 : 2,
      suggestedMaximumSingleSectorPct: regime.regime === 'RISK_ON' ? 40 : 30,
      suggestedMaximumOpenRiskPct: num(regime.maxOpenRiskPct) ?? 1.3
    },
    stressScenarios,
    equalWeightAssumption: { positionWeightPct: round(equalWeight * 100, 1) },
    warnings
  };
  writeJson(OUT_PATH, out);
  console.log({ summary: out.summary, highCorrelationPairs: out.highCorrelationPairs, warnings: out.warnings });
}

main();
