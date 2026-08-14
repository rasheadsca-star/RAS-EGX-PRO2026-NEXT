#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function read(rel, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function write(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function rowsOf(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['rows', 'items', 'data', 'recommendations']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}
function symbolOf(value) {
  return String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
}
function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function positive(value) {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
}
function nonNegative(value) {
  const n = finite(value);
  return n !== null && n >= 0 ? n : null;
}
function round(value, digits = 2) {
  const n = finite(value);
  if (n === null) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
function asciiOnly(value) {
  const s = String(value || '').trim();
  return s ? /^[\x00-\x7F]+$/.test(s) : false;
}
function semanticMarketQuality(row) {
  const issues = [];
  const raw = {
    price: row?.price ?? row?.last,
    previousClose: row?.previousClose,
    open: row?.open,
    high: row?.high,
    low: row?.low,
    volume: row?.volume,
    turnover: row?.valueTraded ?? row?.turnover,
    trades: row?.trades,
  };

  const normalized = {
    price: positive(raw.price),
    previousClose: positive(raw.previousClose),
    open: positive(raw.open),
    high: positive(raw.high),
    low: positive(raw.low),
    volume: nonNegative(raw.volume),
    turnover: nonNegative(raw.turnover),
    trades: nonNegative(raw.trades),
  };

  for (const field of ['price', 'previousClose', 'open', 'high', 'low']) {
    if (normalized[field] === null) issues.push(`${field.toUpperCase()}_NON_POSITIVE_OR_MISSING`);
  }
  if (normalized.volume === null) issues.push('VOLUME_MISSING_OR_NEGATIVE');
  if (normalized.turnover === null) issues.push('TURNOVER_MISSING_OR_NEGATIVE');
  if (normalized.trades === null) issues.push('TRADES_MISSING_OR_NEGATIVE');

  let ohlcValid = false;
  if (
    normalized.price !== null &&
    normalized.open !== null &&
    normalized.high !== null &&
    normalized.low !== null
  ) {
    ohlcValid = (
      normalized.high >= normalized.low &&
      normalized.high >= normalized.open &&
      normalized.high >= normalized.price &&
      normalized.low <= normalized.open &&
      normalized.low <= normalized.price
    );
    if (!ohlcValid) {
      issues.push('OHLC_INVARIANT_FAILED');
      normalized.open = null;
      normalized.high = null;
      normalized.low = null;
    }
  } else {
    issues.push('OHLC_INCOMPLETE');
  }

  if (normalized.volume === 0 && normalized.turnover !== null && normalized.turnover > 0) {
    issues.push('ZERO_VOLUME_WITH_POSITIVE_TURNOVER');
  }
  if (normalized.turnover === 0 && normalized.volume !== null && normalized.volume > 0) {
    issues.push('ZERO_TURNOVER_WITH_POSITIVE_VOLUME');
  }

  const critical = [
    normalized.price,
    normalized.previousClose,
    normalized.open,
    normalized.high,
    normalized.low,
    normalized.volume,
    normalized.turnover,
  ];
  const criticalFieldCompletenessPct = round(
    (critical.filter(value => value !== null).length / critical.length) * 100,
    1
  );

  const dataQualityState = normalized.price === null
    ? 'CURRENT_PRICE_UNAVAILABLE'
    : ohlcValid && criticalFieldCompletenessPct >= 85
      ? 'COMPLETE_FOR_CURRENT_SCOPE'
      : criticalFieldCompletenessPct >= 50
        ? 'PARTIAL'
        : 'INSUFFICIENT_CURRENT_FIELDS';

  return {
    normalized,
    ohlcValid,
    criticalFieldCompletenessPct,
    dataQualityState,
    dataQualityIssues: [...new Set(issues)],
  };
}

const market = read('data/market.json');
const ranking = read('data/final-opportunity-ranking.json');
const gate = read('data/v17/resilient-session-status.json');
const internalSr = read('data/v17/internal-ohlc-support-resistance.json');
const liquidity = read('data/v17/liquidity-gate.json');

const marketRows = rowsOf(market);
const rankingRows = rowsOf(ranking);
const srRows = rowsOf(internalSr);
const liquidityRows = rowsOf(liquidity);

const sessionDate = gate?.priceTruth?.verifiedSessionDate || gate?.sessionDate || market?.sessionDate || null;
const sessionAligned = gate?.sessionAligned === true;
const marketMap = new Map(marketRows.map(row => [symbolOf(row.symbol || row.ticker), row]).filter(([s]) => s));
const rankMap = new Map(rankingRows.map(row => [symbolOf(row.symbol || row.ticker), row]).filter(([s]) => s));
const srMap = new Map(srRows.map(row => [symbolOf(row.symbol || row.ticker), row]).filter(([s]) => s));
const liquidityMap = new Map(liquidityRows.map(row => [symbolOf(row.symbol || row.ticker), row]).filter(([s]) => s));
const executionEligibleSymbols = new Set((liquidity?.executionEligibleSymbols || []).map(symbolOf).filter(Boolean));
const conflictSymbols = new Set((gate?.sourceConflicts || []).map(row => symbolOf(row.symbol || row.ticker)).filter(Boolean));

const allSymbols = [...new Set([
  ...marketMap.keys(),
  ...rankMap.keys(),
  ...srMap.keys(),
  ...liquidityMap.keys(),
])].sort();

const universeRows = allSymbols.map(ticker => {
  const m = marketMap.get(ticker) || {};
  const r = rankMap.get(ticker) || {};
  const rawAr = m.name_ar || r.name || r.companyNameAr || null;
  const rawEn = m.name_en || r.companyNameEn || null;
  return {
    ticker,
    nameAr: rawAr,
    nameEn: rawEn,
    nameArVerified: Boolean(rawAr) && !asciiOnly(rawAr),
    presentInCurrentMarket: marketMap.has(ticker),
    presentInCurrentRanking: rankMap.has(ticker),
    presentInInternalSupportResistance: srMap.has(ticker),
    presentInLiquidityEvidence: liquidityMap.has(ticker) || executionEligibleSymbols.has(ticker),
    sourceConflict: conflictSymbols.has(ticker),
  };
});

const snapshotRows = marketRows.map(row => {
  const ticker = symbolOf(row.symbol || row.ticker);
  const sr = srMap.get(ticker) || null;
  const liquidityRow = liquidityMap.get(ticker) || null;
  const quality = semanticMarketQuality(row);
  const rawAr = row.name_ar || rankMap.get(ticker)?.name || null;
  return {
    ticker,
    nameAr: rawAr,
    nameEn: row.name_en || null,
    nameArVerified: Boolean(rawAr) && !asciiOnly(rawAr),
    sessionDate,
    price: quality.normalized.price,
    previousClose: quality.normalized.previousClose,
    open: quality.normalized.open,
    high: quality.normalized.high,
    low: quality.normalized.low,
    volume: quality.normalized.volume,
    turnover: quality.normalized.turnover,
    trades: quality.normalized.trades,
    change: finite(row.change),
    changePct: finite(row.changePct),
    sourceTimestamp: row.updatedAt || market.updatedAt || market.generatedAt || null,
    source: row.source || market.source || null,
    sourceUrl: row.sourceUrl || null,
    provenance: 'data/market.json',
    sessionAligned,
    criticalFieldCompletenessPct: quality.criticalFieldCompletenessPct,
    dataQualityState: quality.dataQualityState,
    dataQualityIssues: quality.dataQualityIssues,
    ohlcValid: quality.ohlcValid,
    semanticCompleteness: true,
    liquidityExecutionEligible: executionEligibleSymbols.has(ticker) || liquidityRow?.executionLiquidityOk === true,
    supportResistanceAvailable: Boolean(sr),
    supportResistanceExecutionEligible: sr?.executionEligible === true,
    sourceConflict: conflictSymbols.has(ticker),
  };
});

const qualitySummary = {
  semanticCompleteness: true,
  completeRows: snapshotRows.filter(row => row.dataQualityState === 'COMPLETE_FOR_CURRENT_SCOPE').length,
  partialRows: snapshotRows.filter(row => row.dataQualityState === 'PARTIAL').length,
  insufficientRows: snapshotRows.filter(row => row.dataQualityState === 'INSUFFICIENT_CURRENT_FIELDS').length,
  currentPriceUnavailableRows: snapshotRows.filter(row => row.dataQualityState === 'CURRENT_PRICE_UNAVAILABLE').length,
  ohlcValidRows: snapshotRows.filter(row => row.ohlcValid === true).length,
  ohlcInvalidOrIncompleteRows: snapshotRows.filter(row => row.ohlcValid !== true).length,
  rowsWithQualityIssues: snapshotRows.filter(row => (row.dataQualityIssues || []).length > 0).length,
  nonPositiveOhlcExposedAsNumeric: snapshotRows.filter(row =>
    ['open', 'high', 'low'].some(field => row[field] !== null && !(Number(row[field]) > 0))
  ).length,
};

const sourceHealth = {
  schemaVersion: '20.0.0-source-health-2',
  generatedAt: new Date().toISOString(),
  sessionDate,
  status: gate?.status || 'BLOCKED',
  executionGrade: gate?.executionGrade === true,
  sessionAligned,
  coveragePct: finite(gate?.coveragePct),
  freshnessPct: finite(gate?.freshnessPct),
  criticalFieldsPct: finite(gate?.criticalFieldsPct),
  marketCoveragePct: finite(gate?.priceTruth?.marketCoveragePct),
  sourceCoveragePct: finite(gate?.priceTruth?.sourceCoveragePct),
  sourceAgeMinutes: finite(gate?.priceTruth?.sourceAgeMinutes),
  lastSourceUpdate: gate?.priceTruth?.lastSourceUpdate || null,
  sourcesUsed: gate?.sourcesUsed || [],
  sourceConflicts: gate?.sourceConflicts || [],
  missingSymbols: gate?.missingSymbols || [],
  semanticRowQuality: qualitySummary,
  liquidityGate: {
    passed: liquidity?.gatePassed === true || gate?.liquidity?.gatePassed === true,
    sessionAligned: liquidity?.sessionAligned === true || gate?.liquidity?.sessionAligned === true,
    executionEligibleSymbolCount: executionEligibleSymbols.size,
  },
  supportResistance: {
    rowCount: srRows.length,
    researchReady: internalSr?.researchReady === true || gate?.supportResistance?.researchReady === true,
    executionCandidateReady: internalSr?.executionCandidateReady === true || gate?.supportResistance?.executionCandidateReady === true,
  },
  provenance: {
    gate: 'data/v17/resilient-session-status.json',
    market: 'data/market.json',
    supportResistance: 'data/v17/internal-ohlc-support-resistance.json',
    liquidity: 'data/v17/liquidity-gate.json',
  },
};

const masterUniverse = {
  schemaVersion: '20.0.0-master-universe-1',
  generatedAt: new Date().toISOString(),
  scope: 'UNION_OF_CURRENT_MARKET_RANKING_SUPPORT_RESISTANCE_AND_LIQUIDITY',
  sessionDate,
  count: universeRows.length,
  rows: universeRows,
  warnings: universeRows.some(row => row.nameAr && !row.nameArVerified)
    ? ['ARABIC_NAME_FIELD_REQUIRES_LOCALIZATION_AUDIT_FOR_ASCII_VALUES']
    : [],
};

const currentSnapshot = {
  schemaVersion: '20.0.0-current-market-snapshot-2',
  generatedAt: new Date().toISOString(),
  sessionDate,
  sessionAligned,
  decisionSupportOnly: true,
  semanticQuality: qualitySummary,
  sourceTruth: {
    authoritativeGate: 'data/v17/resilient-session-status.json',
    currentPriceSource: 'data/market.json',
    v20DoesNotUpgradeExecutionGrade: true,
    globalCoverageMetricsRemainAuthoritativeFromV17: true,
  },
  globalQuality: {
    status: gate?.status || 'BLOCKED',
    executionGrade: gate?.executionGrade === true,
    coveragePct: finite(gate?.coveragePct),
    freshnessPct: finite(gate?.freshnessPct),
    criticalFieldsPct: finite(gate?.criticalFieldsPct),
  },
  rowCount: snapshotRows.length,
  rows: snapshotRows,
};

write('data/v20/master-universe.json', masterUniverse);
write('data/v20/current-market-snapshot.json', currentSnapshot);
write('data/v20/source-health.json', sourceHealth);

console.log(JSON.stringify({
  sessionDate,
  universeCount: masterUniverse.count,
  currentSnapshotRows: currentSnapshot.rowCount,
  sourceHealthStatus: sourceHealth.status,
  executionGrade: sourceHealth.executionGrade,
  sourceConflicts: sourceHealth.sourceConflicts.length,
  semanticQuality: qualitySummary,
}, null, 2));
