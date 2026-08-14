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
function finite(value) {
  if (value === null || value === undefined || value === '') return null;
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
const policy = read('data/v20/policy-registry.json');
const cfg = policy?.tradePlan?.currentPriceAlignment || {};

if (cfg.enabled !== true) throw new Error('Current-price trade-plan alignment policy must be enabled');

const warningDistancePct = finite(cfg.warningDistancePct) ?? 5;
const hardReviewDistancePct = finite(cfg.hardReviewDistancePct) ?? 20;
if (!(warningDistancePct >= 0 && hardReviewDistancePct > warningDistancePct)) {
  throw new Error('Invalid trade-plan alignment thresholds');
}

const auditRows = [];

current.opportunities = (current.opportunities || []).map(row => {
  const plan = row.tradePlan || {};
  const price = finite(row.price);
  const entryLow = finite(plan.entryLow);
  const entryHigh = finite(plan.entryHigh);
  const stop = finite(plan.stop);
  const target1 = finite(plan.target1);
  const entryMidpoint = entryLow !== null && entryHigh !== null ? (entryLow + entryHigh) / 2 : null;
  const distancePct = price !== null && price > 0 && entryMidpoint !== null
    ? Math.abs(entryMidpoint - price) / price * 100
    : null;
  const relationValid = price !== null && price > 0
    && entryLow !== null && entryHigh !== null && stop !== null && target1 !== null
    && stop < entryLow && entryLow <= entryHigh && entryHigh < target1;
  const insideEntryRange = relationValid && price >= entryLow && price <= entryHigh;
  const belowEntryRange = relationValid && price < entryLow;
  const aboveEntryRange = relationValid && price > entryHigh;
  const hardReviewRequired = relationValid && distancePct !== null && distancePct > hardReviewDistancePct;
  const warningRequired = relationValid && distancePct !== null && distancePct > warningDistancePct;

  let alignmentState;
  if (!relationValid) alignmentState = 'INVALID_RELATION';
  else if (hardReviewRequired) alignmentState = 'REBUILD_REQUIRED';
  else if (aboveEntryRange) alignmentState = 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE';
  else if (belowEntryRange) alignmentState = 'BELOW_ENTRY_RANGE_WAITING';
  else alignmentState = 'IN_ENTRY_RANGE';

  const eligibleForActionable = relationValid && insideEntryRange && !hardReviewRequired;
  const previousStatus = row.status;
  let status = previousStatus;
  if (previousStatus !== 'AVOID' && !eligibleForActionable) status = 'WAIT';

  const reasons = [
    ...(row.reasons || []),
    !relationValid ? 'TRADE_PLAN_RELATION_INVALID' : null,
    hardReviewRequired ? 'TRADE_PLAN_REBUILD_REQUIRED_PRICE_SCALE_OR_STALENESS_UNVERIFIED' : null,
    aboveEntryRange ? 'PRICE_ABOVE_ENTRY_RANGE_DO_NOT_CHASE' : null,
    belowEntryRange ? 'PRICE_BELOW_ENTRY_RANGE_WAIT_FOR_ZONE' : null,
    warningRequired ? 'ENTRY_DISTANCE_WARNING_GT_5PCT' : null,
  ].filter(Boolean);

  const alignment = {
    state: alignmentState,
    currentPrice: price,
    entryLow,
    entryHigh,
    entryMidpoint: round(entryMidpoint, 4),
    distanceFromEntryMidpointPct: round(distancePct, 3),
    warningDistancePct,
    hardReviewDistancePct,
    relationshipValid: relationValid,
    insideEntryRange,
    belowEntryRange,
    aboveEntryRange,
    warningRequired,
    hardReviewRequired,
    hardReviewCause: hardReviewRequired ? (cfg.hardReviewCause || 'PRICE_SCALE_OR_STALENESS_UNVERIFIED') : null,
    causeVerified: false,
    eligibleForActionable,
    action: !relationValid
      ? 'FORCE_WAIT_INVALID_PLAN'
      : hardReviewRequired
        ? (cfg.hardReviewAction || 'FORCE_WAIT_REQUIRE_PLAN_REBUILD')
        : aboveEntryRange
          ? (cfg.aboveEntryRangeAction || 'FORCE_WAIT_DO_NOT_CHASE')
          : belowEntryRange
            ? (cfg.belowEntryRangeAction || 'FORCE_WAIT_UNTIL_ENTRY_ZONE')
            : 'NO_ALIGNMENT_BLOCK',
    calibrationStatus: cfg.calibrationStatus || 'OPERATIONAL_SANITY_GUARD_NOT_MODEL_EDGE_CALIBRATION',
  };

  auditRows.push({
    rank: row.rank,
    ticker: row.ticker,
    previousStatus,
    status,
    ...alignment,
  });

  return {
    ...row,
    status,
    confidence: {
      ...(row.confidence || {}),
      executionConfidencePct: eligibleForActionable ? (finite(row.confidence?.executionConfidencePct) ?? 0) : 0,
    },
    tradePlan: {
      ...plan,
      alignment,
    },
    reasons: [...new Set(reasons)],
  };
});

const count = state => auditRows.filter(row => row.state === state).length;
const report = {
  schemaVersion: '20.0.0-trade-plan-audit-1',
  generatedAt: new Date().toISOString(),
  sessionDate: current.sessionDate,
  policy: {
    warningDistancePct,
    hardReviewDistancePct,
    distanceFormula: cfg.distanceFormula || 'ABS(entryMidpoint-currentPrice)/currentPrice*100',
    actionableRequiresCurrentPriceInsideEntryRange: cfg.actionableRequiresCurrentPriceInsideEntryRange === true,
    hardReviewCause: cfg.hardReviewCause || 'PRICE_SCALE_OR_STALENESS_UNVERIFIED',
    causeDiagnosisClaimed: false,
    calibrationStatus: cfg.calibrationStatus || 'OPERATIONAL_SANITY_GUARD_NOT_MODEL_EDGE_CALIBRATION',
  },
  rowCount: auditRows.length,
  eligibleForActionableCount: auditRows.filter(row => row.eligibleForActionable).length,
  inEntryRangeCount: count('IN_ENTRY_RANGE'),
  belowEntryRangeCount: count('BELOW_ENTRY_RANGE_WAITING'),
  aboveEntryRangeCount: count('ABOVE_ENTRY_RANGE_DO_NOT_CHASE'),
  rebuildRequiredCount: count('REBUILD_REQUIRED'),
  invalidRelationCount: count('INVALID_RELATION'),
  warningCount: auditRows.filter(row => row.warningRequired).length,
  forcedWaitCount: auditRows.filter(row => row.previousStatus !== 'AVOID' && row.status === 'WAIT' && !row.eligibleForActionable).length,
  rows: auditRows,
};

current.tradePlanPolicy = {
  currentPriceAlignmentEnabled: true,
  actionableRequiresCurrentPriceInsideEntryRange: true,
  warningDistancePct,
  hardReviewDistancePct,
  auditSource: 'data/v20/trade-plan-audit.json',
  eligibleForActionableCount: report.eligibleForActionableCount,
  rebuildRequiredCount: report.rebuildRequiredCount,
  invalidRelationCount: report.invalidRelationCount,
};

const newWarnings = [
  ...(current.warnings || []),
  report.rebuildRequiredCount > 0 ? `TRADE_PLAN_REBUILD_REQUIRED_COUNT_${report.rebuildRequiredCount}` : null,
  report.invalidRelationCount > 0 ? `TRADE_PLAN_INVALID_RELATION_COUNT_${report.invalidRelationCount}` : null,
].filter(Boolean);
current.warnings = [...new Set(newWarnings)];

write('data/v20/current.json', current);
write('data/v20/trade-plan-audit.json', report);

console.log(JSON.stringify({
  sessionDate: report.sessionDate,
  rowCount: report.rowCount,
  eligibleForActionableCount: report.eligibleForActionableCount,
  inEntryRangeCount: report.inEntryRangeCount,
  belowEntryRangeCount: report.belowEntryRangeCount,
  aboveEntryRangeCount: report.aboveEntryRangeCount,
  rebuildRequiredCount: report.rebuildRequiredCount,
  invalidRelationCount: report.invalidRelationCount,
  forcedWaitCount: report.forcedWaitCount,
}, null, 2));
