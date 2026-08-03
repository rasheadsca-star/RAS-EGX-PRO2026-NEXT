#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const EVALUATION_PATH = path.join(ROOT, 'data/stable/v15-recommendation-evaluation.json');
const MARKET_PATH = path.join(ROOT, 'data/quant/market-search-index-v13-17.json');
const HISTORY_DIR = path.join(ROOT, 'data/history');
const OUT_PATH = path.join(ROOT, 'data/stable/v16-live-evidence.json');

const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 3) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
function median(values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const i = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[i] : (rows[i - 1] + rows[i]) / 2;
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function history(ticker) {
  const document = readJson(path.join(HISTORY_DIR, `${ticker}.json`), {});
  const rows = Array.isArray(document.sessions) ? document.sessions : Array.isArray(document) ? document : [];
  return rows
    .map(row => ({ date: String(row.date || row.sessionDate || '').slice(0, 10), close: num(row.close) }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function closeAtOrAfter(rows, date) { return rows.find(row => row.date >= date)?.close || null; }
function closeAtOrBefore(rows, date) { return [...rows].reverse().find(row => row.date <= date)?.close || null; }
function benchmarkReturn(histories, startDate, endDate) {
  if (!startDate || !endDate) return null;
  const values = [];
  for (const rows of histories.values()) {
    const start = closeAtOrAfter(rows, startDate);
    const end = closeAtOrBefore(rows, endDate);
    if (start > 0 && end > 0) values.push((end / start - 1) * 100);
  }
  return round(median(values));
}
function maxDrawdown(equity) {
  let peak = 1;
  let worst = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.value);
    worst = Math.min(worst, (point.value / peak - 1) * 100);
  }
  return round(worst);
}
function summarize(records) {
  const resolved = records.filter(row => ['TARGET_HIT', 'STOP_HIT', 'STOP_HIT_AMBIGUOUS_CONSERVATIVE', 'EXPIRED_POSITIVE', 'EXPIRED_NEGATIVE', 'EXPIRED_FLAT'].includes(row.evaluationStatus));
  const entered = records.filter(row => row.entryDate);
  const returns = resolved.map(row => num(row.netReturnPct)).filter(Number.isFinite);
  const wins = resolved.filter(row => num(row.netReturnPct) > 0).length;
  const grossProfits = returns.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLosses = Math.abs(returns.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  let equityValue = 1;
  const equityCurve = resolved
    .slice()
    .sort((a, b) => String(a.exitDate || a.recommendationDate).localeCompare(String(b.exitDate || b.recommendationDate)))
    .map(row => {
      equityValue *= 1 + (num(row.netReturnPct) || 0) / 100;
      return { date: row.exitDate || row.recommendationDate, ticker: row.ticker, value: round(equityValue, 6), returnPct: num(row.netReturnPct) };
    });
  const firstDate = records.map(row => row.recommendationDate).filter(Boolean).sort()[0] || null;
  const lastDate = records.map(row => row.exitDate || row.recommendationDate).filter(Boolean).sort().at(-1) || null;
  const observedDays = firstDate && lastDate ? Math.max(0, Math.round((Date.parse(lastDate) - Date.parse(firstDate)) / 86400000)) : 0;
  return {
    archivedRecommendations: records.length,
    enteredTrades: entered.length,
    resolvedTrades: resolved.length,
    openTrades: records.filter(row => row.evaluationStatus === 'OPEN').length,
    awaitingNextSession: records.filter(row => row.evaluationStatus === 'AWAITING_NEXT_SESSION').length,
    cancelledOrNotEntered: records.filter(row => /CANCELLED|NOT_ENTERED/.test(row.evaluationStatus || '')).length,
    wins,
    losses: resolved.length - wins,
    winRatePct: resolved.length ? round(wins / resolved.length * 100, 1) : null,
    averageNetReturnPct: returns.length ? round(returns.reduce((a, b) => a + b, 0) / returns.length) : null,
    medianNetReturnPct: round(median(returns)),
    cumulativeCompoundedReturnPct: equityCurve.length ? round((equityCurve.at(-1).value - 1) * 100) : null,
    profitFactor: grossLosses > 0 ? round(grossProfits / grossLosses, 3) : grossProfits > 0 ? null : null,
    maxDrawdownPct: maxDrawdown(equityCurve),
    observedCalendarDays: observedDays,
    firstRecommendationDate: firstDate,
    latestObservedDate: lastDate,
    equityCurve
  };
}
function byGroup(records, key) {
  const groups = new Map();
  for (const row of records) {
    const value = row[key] || 'UNKNOWN';
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return [...groups.entries()].map(([name, rows]) => ({ name, ...summarize(rows) })).sort((a, b) => b.resolvedTrades - a.resolvedTrades || b.archivedRecommendations - a.archivedRecommendations);
}
function calibration(records) {
  const bins = [
    { min: 0, max: 30, label: '0–30%' },
    { min: 30, max: 40, label: '30–40%' },
    { min: 40, max: 50, label: '40–50%' },
    { min: 50, max: 60, label: '50–60%' },
    { min: 60, max: 101, label: '60%+' }
  ];
  return bins.map(bin => {
    const rows = records.filter(row => {
      const p = num(row.estimatedTargetProbabilityPct);
      return p !== null && p >= bin.min && p < bin.max;
    });
    const resolved = rows.filter(row => ['TARGET_HIT', 'STOP_HIT', 'STOP_HIT_AMBIGUOUS_CONSERVATIVE', 'EXPIRED_POSITIVE', 'EXPIRED_NEGATIVE', 'EXPIRED_FLAT'].includes(row.evaluationStatus));
    const targetHits = resolved.filter(row => row.evaluationStatus === 'TARGET_HIT').length;
    return {
      label: bin.label,
      recommendations: rows.length,
      resolved: resolved.length,
      predictedAveragePct: rows.length ? round(rows.reduce((sum, row) => sum + num(row.estimatedTargetProbabilityPct), 0) / rows.length, 1) : null,
      actualTargetHitPct: resolved.length ? round(targetHits / resolved.length * 100, 1) : null
    };
  });
}

function main() {
  const evaluation = readJson(EVALUATION_PATH, { records: [] });
  const market = readJson(MARKET_PATH, { stocks: [] });
  const histories = new Map();
  for (const item of market.stocks || []) {
    const ticker = String(item.ticker || '').toUpperCase();
    const rows = history(ticker);
    if (rows.length) histories.set(ticker, rows);
  }
  const enriched = (evaluation.records || []).map(row => {
    const benchmark = row.entryDate && row.exitDate ? benchmarkReturn(histories, row.entryDate, row.exitDate) : null;
    const strategyReturn = num(row.netReturnPct);
    return {
      ...row,
      benchmark: {
        methodology: 'Median equal-weight EGX universe return over the same entry/exit dates',
        returnPct: benchmark,
        alphaPct: benchmark !== null && strategyReturn !== null ? round(strategyReturn - benchmark) : null
      }
    };
  });
  const summary = summarize(enriched);
  const resolvedWithBenchmark = enriched.filter(row => num(row.benchmark?.alphaPct) !== null && ['TARGET_HIT', 'STOP_HIT', 'STOP_HIT_AMBIGUOUS_CONSERVATIVE', 'EXPIRED_POSITIVE', 'EXPIRED_NEGATIVE', 'EXPIRED_FLAT'].includes(row.evaluationStatus));
  const averageAlpha = resolvedWithBenchmark.length ? round(resolvedWithBenchmark.reduce((sum, row) => sum + row.benchmark.alphaPct, 0) / resolvedWithBenchmark.length) : null;
  const minimumResolved = 100;
  const minimumObservedDays = 90;
  const readiness = summary.resolvedTrades >= minimumResolved && summary.observedCalendarDays >= minimumObservedDays;
  const out = {
    schemaVersion: '16.2.0',
    generatedAt: new Date().toISOString(),
    methodology: {
      name: 'EGX_PRO_LIVE_EVIDENCE_2.0',
      sourceEvaluationMethodology: evaluation.methodology?.version || null,
      conservativeExecution: true,
      benchmark: 'MEDIAN_EQUAL_WEIGHT_EGX_UNIVERSE',
      principles: [
        'Backtest statistics are never merged into the live track record.',
        'Cancelled and not-entered recommendations remain visible.',
        'Same-session target and stop ambiguity remains a conservative stop.',
        'Professional evidence requires both sample size and elapsed market time.'
      ]
    },
    evidenceTier: readiness ? 'PROFESSIONAL_EVIDENCE' : summary.resolvedTrades >= 30 ? 'ADVANCED_PILOT' : summary.resolvedTrades >= 10 ? 'PILOT' : 'RESEARCH',
    professionalEvidenceReady: readiness,
    professionalGate: {
      minimumResolvedTrades: minimumResolved,
      minimumObservedCalendarDays: minimumObservedDays,
      resolvedTrades: summary.resolvedTrades,
      observedCalendarDays: summary.observedCalendarDays,
      sampleGatePassed: summary.resolvedTrades >= minimumResolved,
      timeGatePassed: summary.observedCalendarDays >= minimumObservedDays,
      disclosureAr: readiness ? 'اكتمل الحد الأدنى التشغيلي للعينة والزمن، مع بقاء الحاجة للمراجعة الدورية.' : 'لم يكتمل بعد الحد الأدنى لإثبات الأداء الحي؛ التطبيق يظل Professional Pilot.'
    },
    summary: { ...summary, averageAlphaVsMarketPct: averageAlpha },
    byStrategy: byGroup(enriched, 'strategyId'),
    byProfile: byGroup(enriched, 'profile'),
    probabilityCalibration: calibration(enriched),
    records: enriched
  };
  writeJson(OUT_PATH, out);
  console.log({ evidenceTier: out.evidenceTier, professionalEvidenceReady: out.professionalEvidenceReady, summary: out.summary });
}

main();
