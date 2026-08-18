#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = relative => path.join(ROOT, relative);
const FILES = {
  decision: P('data/stable/v16-v169-primary-decision.json'),
  priceTruth: P('data/stable/v15-price-truth.json'),
  fetchStatus: P('data/fetch-status.json'),
  market: P('data/market.json'),
  scanStatus: P('data/stable/v16-immediate-scan-status.json'),
  snapshot: P('data/stable/v16-main-app-current.json'),
  ledger: P('data/stable/v16-main-app-signal-ledger.json'),
};

const ENGINE_ID = 'V16_9_EQUAL_WEIGHT_BASKET';
const MAX_TOTAL_ALLOCATION_PCT = 50;
const ALLOCATION_ROUNDING_TOLERANCE_PCT = 0.03;
const MIN_SOURCE_SESSION_COVERAGE_PCT = 80;
const HEALTHY_SOURCE_SESSION_COVERAGE_PCT = 98;

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 4) {
  const parsed = finite(value);
  if (parsed === null) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function splitAllocation(totalPct, count, digits = 4) {
  if (!(count > 0)) return [];
  const factor = 10 ** digits;
  const totalUnits = Math.round(totalPct * factor);
  const baseUnits = Math.floor(totalUnits / count);
  const remainder = totalUnits - baseUnits * count;
  return Array.from({ length: count }, (_, index) => (baseUnits + (index < remainder ? 1 : 0)) / factor);
}
function isoAgeMinutes(value, now = Date.now()) {
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) ? round(Math.max(0, now - ts) / 60000, 1) : null;
}
function cairoTimestamp(value) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).format(new Date(value)).replace(',', '');
  } catch { return null; }
}

function buildMainAppGovernance() {
  const decision = readJson(FILES.decision, {});
  const priceTruth = readJson(FILES.priceTruth, {});
  const fetchStatus = readJson(FILES.fetchStatus, {});
  const market = readJson(FILES.market, {});
  const scanStatus = readJson(FILES.scanStatus, {});
  const now = new Date().toISOString();

  const criticalErrors = [];
  const warnings = [];
  const engineId = decision?.selectedModel?.id || null;
  if (engineId !== ENGINE_ID) criticalErrors.push(`UNEXPECTED_ENGINE:${engineId || 'MISSING'}`);

  const sourceRecommendations = Array.isArray(decision.recommendations) ? decision.recommendations : [];
  const recommendations = sourceRecommendations.map((row, index) => ({
    ...row,
    ticker: String(row?.ticker || '').trim().toUpperCase(),
    rank: finite(row?.rank, index + 1),
    portfolioWeightPct: finite(row?.portfolioWeightPct, 0),
  }));

  const tickers = recommendations.map(row => row.ticker).filter(Boolean);
  if (tickers.length !== recommendations.length) criticalErrors.push('MISSING_TICKER');
  if (new Set(tickers).size !== tickers.length) criticalErrors.push('DUPLICATE_TICKER');

  for (const row of recommendations) {
    const entryLow = finite(row.entryLow);
    const entryHigh = finite(row.entryHigh);
    const stop = finite(row.stopLoss);
    const target = finite(row.target1);
    if (![entryLow, entryHigh, stop, target].every(Number.isFinite)) {
      criticalErrors.push(`INCOMPLETE_PRICE_PLAN:${row.ticker}`);
      continue;
    }
    if (!(stop < entryLow && entryLow <= entryHigh && target > entryHigh)) {
      criticalErrors.push(`INVALID_PRICE_RELATIONSHIP:${row.ticker}`);
    }
  }

  const sourceRoundedAllocationPct = round(
    recommendations.reduce((sum, row) => sum + finite(row.portfolioWeightPct, 0), 0),
    4,
  );
  const declaredTotalAllocationPct = finite(decision?.basketPlan?.totalAllocationPct, sourceRoundedAllocationPct || 0);
  const sourceWeights = recommendations.map(row => finite(row.portfolioWeightPct, 0));
  const nearlyEqualWeights = sourceWeights.length > 0
    && Math.max(...sourceWeights) - Math.min(...sourceWeights) <= 0.02;
  const overflowPct = round(sourceRoundedAllocationPct - MAX_TOTAL_ALLOCATION_PCT, 4);
  const canNormalizeRoundedEqualWeights = (
    engineId === ENGINE_ID
    && recommendations.length > 0
    && declaredTotalAllocationPct <= MAX_TOTAL_ALLOCATION_PCT
    && Math.abs(sourceRoundedAllocationPct - declaredTotalAllocationPct) <= ALLOCATION_ROUNDING_TOLERANCE_PCT
    && overflowPct > 0
    && overflowPct <= ALLOCATION_ROUNDING_TOLERANCE_PCT
    && nearlyEqualWeights
  );

  let allocationRoundingAdjusted = false;
  if (canNormalizeRoundedEqualWeights) {
    const weights = splitAllocation(declaredTotalAllocationPct, recommendations.length, 4);
    recommendations.forEach((row, index) => { row.portfolioWeightPct = weights[index]; });
    allocationRoundingAdjusted = true;
    warnings.push('EQUAL_WEIGHT_ROUNDING_NORMALIZED');
  }

  const plannedAllocationPct = round(
    recommendations.reduce((sum, row) => sum + finite(row.portfolioWeightPct, 0), 0),
    4,
  );
  if (plannedAllocationPct > MAX_TOTAL_ALLOCATION_PCT) {
    criticalErrors.push(`ALLOCATION_BREACH:${plannedAllocationPct}`);
  }

  const decisionSession = decision.sessionDate || decision.expectedLatestSession || null;
  const marketSession = priceTruth.expectedSession || decision.expectedLatestSession || null;
  const sourceSession = decision?.freshness?.sourceSession
    || priceTruth?.focusAudit?.find(row => row?.historyLastSession)?.historyLastSession
    || marketSession;
  const sessionAligned = Boolean(decisionSession && marketSession && decisionSession === marketSession);
  if (!decisionSession) criticalErrors.push('DECISION_SESSION_MISSING');
  if (!marketSession) criticalErrors.push('MARKET_SESSION_MISSING');

  const sourceCoveragePct = finite(priceTruth?.source?.sourceSessionEvidenceCoveragePct, finite(fetchStatus?.sourceSessionEvidenceCoveragePct, 0));
  const acceptedRows = finite(priceTruth.acceptedRows, finite(fetchStatus.marketRows, 0));
  const rejectedRows = finite(priceTruth.rejectedRows, 0);
  const droppedRows = finite(priceTruth.droppedRows, 0);
  const executionGrade = priceTruth.executionGrade === true;
  const sourceSessionReady = sourceCoveragePct >= MIN_SOURCE_SESSION_COVERAGE_PCT
    && acceptedRows >= finite(priceTruth.minimumExecutionRows, 80);
  const researchReady = sessionAligned && recommendations.length >= 3 && criticalErrors.length === 0;
  const executionReady = researchReady && executionGrade && sourceSessionReady;

  let systemState;
  if (criticalErrors.length > 0 || !sessionAligned) {
    systemState = 'BLOCKED';
  } else if (!executionReady) {
    systemState = 'RESEARCH_ONLY';
  } else if (sourceCoveragePct < HEALTHY_SOURCE_SESSION_COVERAGE_PCT || rejectedRows > 0 || droppedRows > 0) {
    systemState = 'DEGRADED';
  } else {
    systemState = 'HEALTHY';
  }

  const executionAllowed = executionReady && (systemState === 'HEALTHY' || systemState === 'DEGRADED');
  const marketUpdatedAt = market.updatedAt || market.generatedAt || fetchStatus.generatedAt || null;
  const decisionBuiltAt = decision.generatedAt || null;
  const priceTruthAt = priceTruth.generatedAt || null;

  const ledger = readJson(FILES.ledger, {
    schemaVersion: '16.9.2-main-app-immutable-ledger',
    createdAt: now,
    entries: [],
  });
  if (!Array.isArray(ledger.entries)) ledger.entries = [];

  let signalId = null;
  let signalHash = null;
  let ledgerConflict = false;
  if (executionAllowed) {
    const immutablePayload = {
      sessionDate: decisionSession,
      engineId: ENGINE_ID,
      recommendations: recommendations.map(row => ({
        ticker: row.ticker,
        entryLow: finite(row.entryLow),
        entryHigh: finite(row.entryHigh),
        stopLoss: finite(row.stopLoss),
        target1: finite(row.target1),
        portfolioWeightPct: finite(row.portfolioWeightPct),
      })),
    };
    signalId = `${decisionSession}:${ENGINE_ID}`;
    signalHash = hash(immutablePayload);
    const existing = ledger.entries.find(entry => entry.signalId === signalId);
    if (existing && existing.signalHash !== signalHash) {
      ledgerConflict = true;
      criticalErrors.push(`IMMUTABLE_LEDGER_CONFLICT:${signalId}`);
      systemState = 'BLOCKED';
    } else if (!existing) {
      ledger.entries.push({
        signalId,
        signalHash,
        issuedAt: now,
        status: 'ISSUED_PENDING_NEXT_SESSION',
        ...immutablePayload,
      });
    }
  }
  ledger.updatedAt = now;
  writeJsonAtomic(FILES.ledger, ledger);

  const finalExecutionAllowed = executionAllowed && !ledgerConflict && criticalErrors.length === 0;
  const finalState = criticalErrors.length > 0 ? 'BLOCKED' : systemState;
  const snapshotCore = {
    ...decision,
    schemaVersion: '16.9.2-main-app-canonical-governance-snapshot',
    canonicalSnapshot: true,
    snapshotGeneratedAt: now,
    recommendations,
    systemState: finalState,
    state: finalState,
    executionAllowed: finalExecutionAllowed,
    researchReady,
    executionReady: finalExecutionAllowed,
    governance: {
      engineLocked: engineId === ENGINE_ID,
      activeEngine: ENGINE_ID,
      automaticPromotionAllowed: false,
      failClosed: true,
      conservativeAmbiguity: true,
      silentSignalRewriteAllowed: false,
      canonicalSnapshot: true,
      immutableLedger: true,
      sessionAligned,
      sourceSessionReady,
      allocationGuardPassed: plannedAllocationPct <= MAX_TOTAL_ALLOCATION_PCT,
      criticalErrors,
      warnings,
    },
    dataTruth: {
      marketSession,
      decisionSession,
      sourceSession,
      sessionAligned,
      marketScanAt: marketUpdatedAt,
      marketScanAtCairo: cairoTimestamp(marketUpdatedAt),
      decisionBuiltAt,
      decisionBuiltAtCairo: cairoTimestamp(decisionBuiltAt),
      priceTruthAt,
      priceTruthAtCairo: cairoTimestamp(priceTruthAt),
      marketSource: market.source || fetchStatus.sourceName || null,
      executionGrade,
      sourceSessionEvidenceCoveragePct: sourceCoveragePct,
      acceptedRows,
      rejectedRows,
      droppedRows,
      marketRows: Array.isArray(market.rows) ? market.rows.length : finite(fetchStatus.inputRows, null),
      marketDataAgeMinutes: isoAgeMinutes(marketUpdatedAt),
      decisionAgeMinutes: isoAgeMinutes(decisionBuiltAt),
      priceTruthAgeMinutes: isoAgeMinutes(priceTruthAt),
    },
    readiness: {
      marketDataHealth: finalState === 'HEALTHY' ? 'HEALTHY' : finalState === 'DEGRADED' ? 'DEGRADED' : 'BLOCKED',
      researchReadiness: researchReady,
      executionReadiness: finalExecutionAllowed,
      modelConfidenceSeparatedFromExecution: true,
    },
    portfolioPolicy: {
      ...(decision.basketPlan || {}),
      maximumTotalAllocationPct: MAX_TOTAL_ALLOCATION_PCT,
      plannedAllocationPct,
      cashReservePct: round(100 - plannedAllocationPct, 4),
      sourceRoundedAllocationPct,
      declaredTotalAllocationPct,
      roundingAdjustmentApplied: allocationRoundingAdjusted,
      roundingAdjustmentPct: allocationRoundingAdjusted ? round(plannedAllocationPct - sourceRoundedAllocationPct, 4) : 0,
      unfilledMemberPolicy: 'KEEP_CASH',
      automaticOrders: false,
      sameSessionAmbiguityPolicy: 'CONSERVATIVE_STOP',
    },
    immutableSignal: {
      signalId,
      signalHash,
      ledgerConflict,
      ledgerEntries: ledger.entries.length,
    },
    scanCycle: {
      latestStatusAt: scanStatus.generatedAt || null,
      attempts: finite(scanStatus.attempts, 0),
      final: scanStatus.final === true,
      pagesPublished: scanStatus.pagesPublished === true,
      nominalCairoSlots: ['10:15', '14:15'],
      postCloseHourlyFrom: '15:00',
      postCloseHourlyUntil: '21:00',
    },
  };

  const snapshotHash = hash({
    engine: ENGINE_ID,
    state: finalState,
    executionAllowed: finalExecutionAllowed,
    marketSession,
    decisionSession,
    sourceCoveragePct,
    plannedAllocationPct,
    recommendations: recommendations.map(row => ({
      ticker: row.ticker,
      entryLow: row.entryLow,
      entryHigh: row.entryHigh,
      stopLoss: row.stopLoss,
      target1: row.target1,
      portfolioWeightPct: row.portfolioWeightPct,
    })),
  });
  const snapshot = { ...snapshotCore, snapshotHash };
  writeJsonAtomic(FILES.snapshot, snapshot);

  console.log(JSON.stringify({
    systemState: finalState,
    executionAllowed: finalExecutionAllowed,
    sessionAligned,
    marketSession,
    decisionSession,
    sourceSessionEvidenceCoveragePct: sourceCoveragePct,
    plannedAllocationPct,
    sourceRoundedAllocationPct,
    roundingAdjustmentApplied: allocationRoundingAdjusted,
    recommendationTickers: recommendations.map(row => row.ticker),
    ledgerEntries: ledger.entries.length,
    criticalErrors,
    warnings,
    snapshotPath: path.relative(ROOT, FILES.snapshot),
  }, null, 2));

  if (criticalErrors.length > 0) process.exitCode = 2;
  return snapshot;
}

if (require.main === module) buildMainAppGovernance();
module.exports = { buildMainAppGovernance };
