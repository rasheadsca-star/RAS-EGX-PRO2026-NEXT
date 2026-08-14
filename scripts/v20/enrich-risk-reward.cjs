#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function read(rel) { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); }
function write(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function round(value, digits = 3) {
  const n = finite(value);
  if (n === null) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

const current = read('data/v20/current.json');
const auditRows = [];

current.opportunities = (current.opportunities || []).map(row => {
  const plan = row.tradePlan || {};
  const legacy = finite(plan.legacyGrossRiskReward);
  const gross = finite(plan.target1Metrics?.grossRiskReward);
  const net = finite(plan.target1Metrics?.netRiskReward);
  const entryLow = finite(plan.entryLow);
  const price = finite(row.price);
  const absoluteDifference = legacy !== null && gross !== null ? Math.abs(legacy - gross) : null;
  const mismatchThreshold = gross === null ? null : Math.max(0.5, Math.abs(gross) * 0.5);
  const materialMismatch = absoluteDifference !== null && mismatchThreshold !== null && absoluteDifference >= mismatchThreshold;
  const currentPriceBelowEntryRange = price !== null && entryLow !== null && price < entryLow;
  const auditReasons = [
    legacy !== null ? 'LEGACY_RR_REFERENCE_UNVERIFIED' : null,
    currentPriceBelowEntryRange ? 'CURRENT_PRICE_BELOW_ENTRY_RANGE' : null,
    materialMismatch ? 'LEGACY_RR_MATERIAL_MISMATCH_VS_CONSERVATIVE_ENTRY_HIGH_REFERENCE' : null,
  ].filter(Boolean);

  const riskReward = {
    primaryMetric: 'CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS',
    primaryTarget: 'TARGET_1',
    primaryTarget1NetRiskReward: net,
    target1GrossRiskReward: gross,
    target1NetRiskReward: net,
    target2GrossRiskReward: finite(plan.target2Metrics?.grossRiskReward),
    target2NetRiskReward: finite(plan.target2Metrics?.netRiskReward),
    legacyRiskReward: legacy,
    legacyReference: legacy === null ? 'NOT_PROVIDED' : 'UNVERIFIED_PRICE_REFERENCE',
    legacyIsPrimary: false,
    absoluteDifferenceVsConservativeGross: round(absoluteDifference),
    materialMismatch,
    auditReasons,
    methodology: {
      direction: plan.direction || 'LONG',
      entryReference: 'ENTRY_HIGH',
      entryReferencePrice: finite(plan.entryReferenceForRiskMath),
      roundTripTransactionCostPct: finite(plan.transactionCostRoundTripPct),
      note: 'Net R/R is conservative and cost-aware. The legacy R/R remains audit-only because its exact price reference has not been independently verified.',
    },
  };

  auditRows.push({
    rank: row.rank,
    ticker: row.ticker,
    price,
    entryLow,
    entryHigh: finite(plan.entryHigh),
    stop: finite(plan.stop),
    target1: finite(plan.target1),
    legacyRiskReward: legacy,
    conservativeGrossRiskReward: gross,
    conservativeNetRiskReward: net,
    absoluteDifferenceVsConservativeGross: riskReward.absoluteDifferenceVsConservativeGross,
    materialMismatch,
    currentPriceBelowEntryRange,
    legacyReference: riskReward.legacyReference,
    auditReasons,
  });

  return {
    ...row,
    riskReward,
    tradePlan: {
      ...plan,
      primaryRiskRewardMetric: riskReward.primaryMetric,
      primaryTarget1NetRiskReward: net,
      legacyRiskRewardAuditOnly: legacy,
    },
  };
});

const materialRows = auditRows
  .filter(row => row.materialMismatch)
  .sort((a, b) => (b.absoluteDifferenceVsConservativeGross || 0) - (a.absoluteDifferenceVsConservativeGross || 0));

const audit = {
  schemaVersion: '20.0.0-risk-reward-audit-1',
  generatedAt: new Date().toISOString(),
  sessionDate: current.sessionDate,
  primaryMetric: 'CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS',
  legacyMetricPolicy: 'AUDIT_ONLY_REFERENCE_UNVERIFIED',
  rowCount: auditRows.length,
  materialMismatchCount: materialRows.length,
  currentPriceBelowEntryRangeCount: auditRows.filter(row => row.currentPriceBelowEntryRange).length,
  legacyReferenceUnverifiedCount: auditRows.filter(row => row.legacyRiskReward !== null).length,
  methodology: {
    conservativeLongEntryReference: 'ENTRY_HIGH',
    transactionCostsIncluded: true,
    exactLegacyFormulaClaimed: false,
    mismatchThreshold: 'ABS(legacyRR - conservativeGrossRR) >= MAX(0.5, 50% of ABS(conservativeGrossRR))',
  },
  materialMismatches: materialRows,
  rows: auditRows,
};

current.riskRewardPolicy = {
  primaryMetric: audit.primaryMetric,
  legacyMetricPolicy: audit.legacyMetricPolicy,
  materialMismatchCount: audit.materialMismatchCount,
  auditSource: 'data/v20/risk-reward-audit.json',
};
if (audit.materialMismatchCount > 0) {
  current.warnings = [...new Set([...(current.warnings || []), `LEGACY_RR_MATERIAL_MISMATCH_COUNT_${audit.materialMismatchCount}`])];
}

write('data/v20/current.json', current);
write('data/v20/risk-reward-audit.json', audit);

console.log(JSON.stringify({
  sessionDate: audit.sessionDate,
  primaryMetric: audit.primaryMetric,
  rows: audit.rowCount,
  materialMismatchCount: audit.materialMismatchCount,
  currentPriceBelowEntryRangeCount: audit.currentPriceBelowEntryRangeCount,
  largestMismatch: materialRows[0] || null,
}, null, 2));
