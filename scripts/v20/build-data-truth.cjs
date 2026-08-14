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
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
function fieldCompleteness(row) {
  const values = [
    row?.price ?? row?.last,
    row?.previousClose,
    row?.open,
    row?.high,
    row?.low,
    row?.volume,
    row?.valueTraded ?? row?.turnover,
  ];
  return round((values.filter(v => finite(v) !== null).length / values.length) * 100, 1);
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
  const completenessPct = fieldCompleteness(row);
  const rawAr = row.name_ar || rankMap.get(ticker)?.name || null;
  return {
    ticker,
    nameAr: rawAr,
    nameEn: row.name_en || null,
    nameArVerified: Boolean(rawAr) && !asciiOnly(rawAr),
    sessionDate,
    price: finite(row.price ?? row.last),
    previousClose: finite(row.previousClose),
    open: finite(row.open),
    high: finite(row.high),
    low: finite(row.low),
    volume: finite(row.volume),
    turnover: finite(row.valueTraded ?? row.turnover),
    trades: finite(row.trades),
    change: finite(row.change),
    changePct: finite(row.changePct),
    sourceTimestamp: row.updatedAt || market.updatedAt || market.generatedAt || null,
    source: row.source || market.source || null,
    sourceUrl: row.sourceUrl || null,
    provenance: 'data/market.json',
    sessionAligned,
    criticalFieldCompletenessPct: completenessPct,
    dataQualityState: completenessPct >= 85 ? 'COMPLETE_FOR_CURRENT_SCOPE' : 'PARTIAL',
    liquidityExecutionEligible: executionEligibleSymbols.has(ticker) || liquidityRow?.executionLiquidityOk === true,
    supportResistanceAvailable: Boolean(sr),
    supportResistanceExecutionEligible: sr?.executionEligible === true,
    sourceConflict: conflictSymbols.has(ticker),
  };
});

const sourceHealth = {
  schemaVersion: '20.0.0-source-health-1',
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
  schemaVersion: '20.0.0-current-market-snapshot-1',
  generatedAt: new Date().toISOString(),
  sessionDate,
  sessionAligned,
  decisionSupportOnly: true,
  sourceTruth: {
    authoritativeGate: 'data/v17/resilient-session-status.json',
    currentPriceSource: 'data/market.json',
    v20DoesNotUpgradeExecutionGrade: true,
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
}, null, 2));
