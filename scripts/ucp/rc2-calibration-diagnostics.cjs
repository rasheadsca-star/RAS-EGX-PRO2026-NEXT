'use strict';

const fs = require('fs');

const BASE = process.env.RC2_PRODUCTION_URL || 'https://egx-tfe-v20-fusion-rc2.vercel.app';
const MARKET_PATH = process.env.RC2_MARKET_PATH || '/tmp/rc2-market.json';
const OUTPUT_PATH = process.env.RC2_CALIBRATION_OUTPUT || '/tmp/rc2-calibration.json';
const BATCH_SIZE = Math.max(1, Number(process.env.RC2_CALIBRATION_BATCH_SIZE || 12));

const THRESHOLDS = Object.freeze({
  core: 70,
  research: 72,
  liquidity: 55,
  sr: 55,
  structuralNetRR: 0.70,
});

const SCORE_GATES = new Set([
  'CORE_SCORE_LOW',
  'RESEARCH_SCORE_LOW',
  'LIQUIDITY_GATE_FAIL',
  'SR_CONFLUENCE_FAIL',
  'STRUCTURAL_RR_LOW',
]);

const CRITICAL_REASONS = new Set([
  'QUALITY_BLOCKED',
  'INSUFFICIENT_HISTORY',
  'TRADE_PLAN_UNAVAILABLE',
  'DO_NOT_CHASE',
  'BELOW_ENTRY_WAIT',
]);

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function quantile(values, q) {
  const a = values.map(finiteNumber).filter(v => v !== null).sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return a[lo];
  const w = pos - lo;
  return Number((a[lo] * (1 - w) + a[hi] * w).toFixed(4));
}

function stats(rows, key) {
  const a = rows.map(x => x[key]).map(finiteNumber).filter(v => v !== null).sort((x, y) => x - y);
  if (!a.length) return { n: 0, min: null, p10: null, p25: null, p50: null, p75: null, p90: null, p95: null, max: null, mean: null };
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  return {
    n: a.length,
    min: a[0],
    p10: quantile(a, .10),
    p25: quantile(a, .25),
    p50: quantile(a, .50),
    p75: quantile(a, .75),
    p90: quantile(a, .90),
    p95: quantile(a, .95),
    max: a[a.length - 1],
    mean: Number(mean.toFixed(4)),
  };
}

function passRate(rows, fn) {
  if (!rows.length) return { count: 0, pct: 0 };
  const count = rows.filter(fn).length;
  return { count, pct: Number((count / rows.length * 100).toFixed(2)) };
}

function deficits(row, t = THRESHOLDS) {
  const out = {};
  for (const key of Object.keys(t)) {
    const v = finiteNumber(row[key]);
    out[key] = v === null ? null : Number(Math.max(0, t[key] - v).toFixed(4));
  }
  return out;
}

function allNumericGatesPass(row, t = THRESHOLDS) {
  return finiteNumber(row.core) !== null && row.core >= t.core
    && finiteNumber(row.research) !== null && row.research >= t.research
    && finiteNumber(row.liquidity) !== null && row.liquidity >= t.liquidity
    && finiteNumber(row.sr) !== null && row.sr >= t.sr
    && finiteNumber(row.structuralNetRR) !== null && row.structuralNetRR >= t.structuralNetRR;
}

function noCriticalReason(row) {
  return !(row.reasons || []).some(r => CRITICAL_REASONS.has(r));
}

function normalizedCloseness(row, t = THRESHOLDS) {
  const weights = { core: .28, research: .32, liquidity: .10, sr: .10, structuralNetRR: .20 };
  let score = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(weights)) {
    const v = finiteNumber(row[key]);
    if (v === null) continue;
    score += Math.min(1, Math.max(0, v / t[key])) * w;
    weight += w;
  }
  return weight ? Number((score / weight).toFixed(4)) : 0;
}

function gateDistanceScore(row, t = THRESHOLDS) {
  const scales = { core: 15, research: 15, liquidity: 15, sr: 15, structuralNetRR: .5 };
  let total = 0;
  for (const key of Object.keys(t)) {
    const v = finiteNumber(row[key]);
    if (v === null) return Infinity;
    total += Math.max(0, t[key] - v) / scales[key];
  }
  return Number(total.toFixed(4));
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache', 'user-agent': 'Rasheed-EGX-RC2-Calibration/1.0' } });
  if (!r.ok) throw new Error(`HTTP_${r.status}:${url}`);
  return r.json();
}

function scenarioCount(rows, thresholds) {
  const qualified = rows.filter(row => noCriticalReason(row) && allNumericGatesPass(row, thresholds));
  return {
    thresholds,
    numericAndCriticalQualified: qualified.length,
    tickers: qualified.slice(0, 20).map(x => x.ticker),
  };
}

async function main() {
  const market = JSON.parse(fs.readFileSync(MARKET_PATH, 'utf8'));
  if (market?.ok !== true || !Array.isArray(market?.symbols)) throw new Error('MARKET_INDEX_INVALID');

  const tickers = market.symbols
    .filter(x => x.currentRc2UniverseCandidate)
    .map(x => String(x.ticker || '').trim().toUpperCase())
    .filter(Boolean);

  const rows = [];
  const errors = [];
  const stamp = Date.now();

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(async ticker => {
      const x = await fetchJson(`${BASE}/api/index?route=analyze&ticker=${encodeURIComponent(ticker)}&calibration=1&t=${stamp}`);
      const r = x?.result || {};
      return {
        ticker,
        sessionDate: r.sessionDate || null,
        eligible: Boolean(r.eligible),
        publicationEligible: Boolean(r.publicationEligible),
        core: finiteNumber(r.scores?.core),
        research: finiteNumber(r.scores?.research),
        liquidity: finiteNumber(r.scores?.liquidity),
        sr: finiteNumber(r.scores?.supportResistance),
        quality: finiteNumber(r.scores?.dataQuality),
        structuralNetRR: finiteNumber(r.tradePlan?.structuralNetRR),
        alignmentState: r.tradePlan?.alignmentState ?? null,
        reasons: Array.isArray(r.reasonCodes) ? r.reasonCodes : [],
        qualityState: r.quality?.state ?? null,
        publicationHold: Boolean(r.quality?.publicationHold),
      };
    }));
    settled.forEach((result, j) => {
      if (result.status === 'fulfilled') rows.push(result.value);
      else errors.push({ ticker: batch[j], error: String(result.reason?.message || result.reason) });
    });
  }

  const reasonCounts = {};
  for (const row of rows) for (const reason of row.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;

  const enriched = rows.map(row => {
    const d = deficits(row);
    const numericFailed = Object.entries(d).filter(([,v]) => v === null || v > 0).map(([k]) => k);
    const criticalReasons = row.reasons.filter(r => CRITICAL_REASONS.has(r));
    const otherReasons = row.reasons.filter(r => !CRITICAL_REASONS.has(r) && !SCORE_GATES.has(r));
    const singleScoreGateMiss = criticalReasons.length === 0 && otherReasons.length === 0 && numericFailed.length === 1;
    const nearMiss = criticalReasons.length === 0
      && otherReasons.length === 0
      && numericFailed.length <= 2
      && (d.core === null || d.core <= 10)
      && (d.research === null || d.research <= 10)
      && (d.liquidity === null || d.liquidity <= 10)
      && (d.sr === null || d.sr <= 10)
      && (d.structuralNetRR === null || d.structuralNetRR <= .25);

    return {
      ...row,
      deficits: d,
      numericFailed,
      criticalReasons,
      otherReasons,
      singleScoreGateMiss,
      nearMiss,
      closeness: normalizedCloseness(row),
      gateDistance: gateDistanceScore(row),
    };
  });

  const bestRejected = enriched
    .filter(x => !x.eligible)
    .sort((a,b) => a.gateDistance - b.gateDistance || b.closeness - a.closeness || (b.research ?? -1) - (a.research ?? -1) || a.ticker.localeCompare(b.ticker))
    .slice(0, 30);

  const nearMisses = enriched
    .filter(x => x.nearMiss)
    .sort((a,b) => a.gateDistance - b.gateDistance || b.closeness - a.closeness || a.ticker.localeCompare(b.ticker))
    .slice(0, 30);

  const singleGateMisses = enriched
    .filter(x => x.singleScoreGateMiss)
    .sort((a,b) => a.gateDistance - b.gateDistance || b.closeness - a.closeness || a.ticker.localeCompare(b.ticker))
    .slice(0, 30);

  const gatePassRates = {
    core: passRate(rows, x => x.core !== null && x.core >= THRESHOLDS.core),
    research: passRate(rows, x => x.research !== null && x.research >= THRESHOLDS.research),
    liquidity: passRate(rows, x => x.liquidity !== null && x.liquidity >= THRESHOLDS.liquidity),
    supportResistance: passRate(rows, x => x.sr !== null && x.sr >= THRESHOLDS.sr),
    structuralNetRR: passRate(rows, x => x.structuralNetRR !== null && x.structuralNetRR >= THRESHOLDS.structuralNetRR),
    allNumeric: passRate(rows, x => allNumericGatesPass(x)),
    allNumericAndNoCritical: passRate(rows, x => allNumericGatesPass(x) && noCriticalReason(x)),
  };

  const calibrationFlags = [];
  if (gatePassRates.core.pct < 5) calibrationFlags.push('CORE_GATE_EXTREME_TAIL');
  if (gatePassRates.research.pct < 5) calibrationFlags.push('RESEARCH_GATE_EXTREME_TAIL');
  if (gatePassRates.allNumericAndNoCritical.count === 0 && nearMisses.length > 0) calibrationFlags.push('ZERO_QUALIFIED_WITH_NEAR_MISSES');
  if (rows.filter(x => x.qualityState === 'REVIEW').length / Math.max(1, rows.length) > .80) calibrationFlags.push('QUALITY_REVIEW_DOMINANT_UNIVERSE');

  const scenarios = [
    scenarioCount(rows, { ...THRESHOLDS }),
    scenarioCount(rows, { ...THRESHOLDS, core: 68, research: 70 }),
    scenarioCount(rows, { ...THRESHOLDS, core: 65, research: 68 }),
    scenarioCount(rows, { ...THRESHOLDS, core: 65, research: 65 }),
    scenarioCount(rows, { ...THRESHOLDS, core: 62, research: 65 }),
  ];

  const report = {
    schemaVersion: 'rasheed-egx-rc2-calibration-diagnostics/v1',
    generatedAt: new Date().toISOString(),
    sessionDate: market.sessionDate || null,
    source: 'RC2_PRODUCTION_ANALYZE_ROUTE',
    requested: tickers.length,
    completed: rows.length,
    errorCount: errors.length,
    errors: errors.slice(0, 20),
    frozenThresholds: THRESHOLDS,
    actualEligible: rows.filter(x => x.eligible).length,
    actualPublicationEligible: rows.filter(x => x.publicationEligible).length,
    gatePassRates,
    distributions: {
      core: stats(rows, 'core'),
      research: stats(rows, 'research'),
      liquidity: stats(rows, 'liquidity'),
      supportResistance: stats(rows, 'sr'),
      dataQuality: stats(rows, 'quality'),
      structuralNetRR: stats(rows, 'structuralNetRR'),
    },
    reasonCounts: Object.entries(reasonCounts).sort((a,b) => b[1] - a[1]).map(([reason,count]) => ({ reason, count })),
    calibrationFlags,
    nearMissCount: enriched.filter(x => x.nearMiss).length,
    singleScoreGateMissCount: enriched.filter(x => x.singleScoreGateMiss).length,
    nearMisses,
    singleGateMisses,
    bestRejected,
    sensitivityScenarios: scenarios,
    safety: {
      scoringModelChanged: false,
      productionThresholdsChanged: false,
      executionBehaviorChanged: false,
      executionAllowed: false,
      purpose: 'Measure score distribution and threshold sensitivity before any calibration proposal.',
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    sessionDate: report.sessionDate,
    completed: report.completed,
    actualEligible: report.actualEligible,
    gatePassRates: report.gatePassRates,
    distributions: report.distributions,
    calibrationFlags: report.calibrationFlags,
    nearMissCount: report.nearMissCount,
    singleScoreGateMissCount: report.singleScoreGateMissCount,
    sensitivityScenarios: report.sensitivityScenarios,
    topNearMisses: report.nearMisses.slice(0, 10).map(x => ({
      ticker: x.ticker,
      core: x.core,
      research: x.research,
      liquidity: x.liquidity,
      sr: x.sr,
      structuralNetRR: x.structuralNetRR,
      numericFailed: x.numericFailed,
      reasons: x.reasons,
      gateDistance: x.gateDistance,
    })),
  }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
