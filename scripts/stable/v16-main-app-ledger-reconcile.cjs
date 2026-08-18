#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const SNAPSHOT_PATH = path.join(ROOT, 'data/stable/v16-main-app-current.json');
const LEDGER_PATH = path.join(ROOT, 'data/stable/v16-main-app-signal-ledger.json');
const REPORT_PATH = path.join(ROOT, 'data/stable/v16-main-app-ledger-reconcile.json');
const ENGINE_ID = 'V16_9_EQUAL_WEIGHT_BASKET';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function ticker(value) { return String(value || '').trim().toUpperCase(); }
function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}
function sortedTickers(rows) { return (rows || []).map(row => ticker(row?.ticker)).filter(Boolean).sort(); }
function sameTickerSet(a, b) { return JSON.stringify(sortedTickers(a)) === JSON.stringify(sortedTickers(b)); }

function main() {
  if (!fs.existsSync(SNAPSHOT_PATH) || !fs.existsSync(LEDGER_PATH)) {
    throw new Error('Missing canonical snapshot or immutable ledger');
  }
  const snapshot = readJson(SNAPSHOT_PATH);
  const ledger = readJson(LEDGER_PATH);
  const signalId = snapshot?.immutableSignal?.signalId;
  const conflict = snapshot?.immutableSignal?.ledgerConflict === true;
  const currentRows = Array.isArray(snapshot.recommendations) ? snapshot.recommendations : [];
  const entry = (ledger.entries || []).find(row => row?.signalId === signalId);

  const report = {
    schemaVersion: '16.9.2-ledger-reconcile-2-stability-lock',
    generatedAt: new Date().toISOString(),
    policy: 'PUBLISHED_SIGNAL_IS_AUTHORITY',
    signalId: signalId || null,
    conflictDetected: conflict,
    reconciled: false,
    reason: null,
    publishedSignalHash: entry?.signalHash || null,
    recomputedSignalHash: snapshot?.immutableSignal?.signalHash || null,
    sameTickerSet: entry ? sameTickerSet(currentRows, entry.recommendations) : false,
    preservedRecommendationSelection: false,
    preservedPublishedOrder: false,
  };

  if (!conflict) {
    report.reason = 'NO_LEDGER_CONFLICT';
    report.preservedRecommendationSelection = true;
    report.preservedPublishedOrder = true;
    writeJsonAtomic(REPORT_PATH, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!entry) {
    report.reason = 'PUBLISHED_LEDGER_ENTRY_MISSING';
    writeJsonAtomic(REPORT_PATH, report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 2;
    return;
  }
  if (entry.engineId !== ENGINE_ID || snapshot?.governance?.activeEngine !== ENGINE_ID) {
    report.reason = 'ENGINE_MISMATCH';
    writeJsonAtomic(REPORT_PATH, report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 2;
    return;
  }
  if (!sameTickerSet(currentRows, entry.recommendations)) {
    report.reason = 'MATERIAL_SELECTION_CHANGE_REQUIRES_NEW_VERSION';
    writeJsonAtomic(REPORT_PATH, report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 2;
    return;
  }

  const currentByTicker = new Map(currentRows.map(row => [ticker(row?.ticker), row]));
  const shadowRecomputedPlan = currentRows.map(row => ({
    ticker: ticker(row?.ticker),
    rank: finite(row?.rank),
    entryLow: finite(row?.entryLow),
    entryHigh: finite(row?.entryHigh),
    stopLoss: finite(row?.stopLoss),
    target1: finite(row?.target1),
    portfolioWeightPct: finite(row?.portfolioWeightPct),
  }));

  // The ledger array order is the published ranking authority for this signal.
  // Same-session recalculation may be observed as shadow evidence, but it may not
  // silently reorder or rewrite an already-issued recommendation.
  const publishedRows = entry.recommendations.map((published, index) => {
    const symbol = ticker(published?.ticker);
    const current = currentByTicker.get(symbol) || {};
    return {
      ...current,
      ticker: symbol,
      rank: index + 1,
      localRank: index + 1,
      entryLow: finite(published.entryLow),
      entryHigh: finite(published.entryHigh),
      stopLoss: finite(published.stopLoss),
      target1: finite(published.target1),
      portfolioWeightPct: finite(published.portfolioWeightPct),
    };
  });

  const publishedByTicker = new Map(publishedRows.map(row => [row.ticker, row]));
  if (Array.isArray(snapshot.researchWatchlist)) {
    const watchByTicker = new Map(snapshot.researchWatchlist.map(row => [ticker(row?.ticker), row]));
    snapshot.researchWatchlist = publishedRows.map((published, index) => {
      const row = watchByTicker.get(published.ticker) || {};
      return {
        ...row,
        rank: index + 1,
        ticker: published.ticker,
        entryLow: published.entryLow,
        entryHigh: published.entryHigh,
        stopLoss: published.stopLoss,
        target1: published.target1,
      };
    });
  }

  snapshot.recommendations = publishedRows;
  snapshot.immutableSignal = {
    ...(snapshot.immutableSignal || {}),
    signalId,
    signalHash: entry.signalHash,
    ledgerConflict: false,
    reconciledToPublishedLedger: true,
    reconciledAt: report.generatedAt,
    shadowRecomputedSignalHash: report.recomputedSignalHash,
  };
  snapshot.governance = snapshot.governance || {};
  snapshot.governance.criticalErrors = (snapshot.governance.criticalErrors || [])
    .filter(code => !String(code).startsWith('IMMUTABLE_LEDGER_CONFLICT:'));
  snapshot.governance.warnings = [...new Set([
    ...(snapshot.governance.warnings || []),
    'IMMUTABLE_LEDGER_RECONCILED_TO_PUBLISHED_SIGNAL',
  ])];

  const sessionAligned = snapshot?.governance?.sessionAligned === true;
  const executionGrade = snapshot?.dataTruth?.executionGrade === true;
  const sourceSessionReady = snapshot?.governance?.sourceSessionReady === true;
  const hasOtherCriticalErrors = snapshot.governance.criticalErrors.length > 0;
  const sourceCoverage = finite(snapshot?.dataTruth?.sourceSessionEvidenceCoveragePct, 0);
  const rejectedRows = finite(snapshot?.dataTruth?.rejectedRows, 0);
  const droppedRows = finite(snapshot?.dataTruth?.droppedRows, 0);
  const canExecute = !hasOtherCriticalErrors && sessionAligned && executionGrade && sourceSessionReady;
  const finalState = hasOtherCriticalErrors || !sessionAligned
    ? 'BLOCKED'
    : !canExecute
      ? 'RESEARCH_ONLY'
      : sourceCoverage < 98 || rejectedRows > 0 || droppedRows > 0
        ? 'DEGRADED'
        : 'HEALTHY';

  snapshot.systemState = finalState;
  snapshot.state = finalState;
  snapshot.executionAllowed = canExecute && ['HEALTHY', 'DEGRADED'].includes(finalState);
  snapshot.executionReady = snapshot.executionAllowed;
  snapshot.readiness = {
    ...(snapshot.readiness || {}),
    marketDataHealth: finalState,
    executionReadiness: snapshot.executionAllowed,
  };

  const plannedAllocationPct = round(publishedRows.reduce((sum, row) => sum + finite(row.portfolioWeightPct, 0), 0));
  snapshot.portfolioPolicy = {
    ...(snapshot.portfolioPolicy || {}),
    plannedAllocationPct,
    totalAllocationPct: plannedAllocationPct,
    cashReservePct: round(100 - plannedAllocationPct),
  };

  snapshot.ledgerReconciliation = {
    mode: 'PUBLISHED_SIGNAL_IS_AUTHORITY',
    reason: 'SAME_TICKER_RECOMPUTE_CHANGED_PUBLISHED_FIELDS_AFTER_IMMUTABLE_ISSUE',
    publishedSignalHash: entry.signalHash,
    shadowRecomputedSignalHash: report.recomputedSignalHash,
    shadowRecomputedPlan,
    recommendationSelectionChanged: false,
    publishedRecommendationSelectionPreserved: true,
    publishedOrderPreserved: true,
    changesRanking: false,
    changesSelectionTechnique: false,
  };
  snapshot.stabilityPolicy = {
    version: '16.9.2-stability-lock-1',
    canonicalSignalAuthority: 'IMMUTABLE_LEDGER',
    sameSessionRecomputePolicy: 'SHADOW_ONLY_RESTORE_PUBLISHED_SIGNAL',
    materialTickerChangePolicy: 'BLOCK_AND_REQUIRE_NEW_VERSION',
    comparisonCanRewriteCanonicalSignal: false,
    comparisonCanChangeProfessionalReadiness: false,
  };

  snapshot.snapshotHash = sha({
    engine: ENGINE_ID,
    state: finalState,
    executionAllowed: snapshot.executionAllowed,
    marketSession: snapshot?.dataTruth?.marketSession || null,
    decisionSession: snapshot?.dataTruth?.decisionSession || null,
    sourceCoveragePct: sourceCoverage,
    plannedAllocationPct,
    recommendations: publishedRows.map(row => ({
      ticker: row.ticker,
      entryLow: row.entryLow,
      entryHigh: row.entryHigh,
      stopLoss: row.stopLoss,
      target1: row.target1,
      portfolioWeightPct: row.portfolioWeightPct,
    })),
  });

  report.reconciled = true;
  report.reason = 'RESTORED_PUBLISHED_LEDGER_PLAN_AND_ORDER';
  report.preservedRecommendationSelection = true;
  report.preservedPublishedOrder = true;
  report.finalState = finalState;
  report.executionAllowed = snapshot.executionAllowed;
  report.reconciledSnapshotHash = snapshot.snapshotHash;
  report.publishedTickers = publishedRows.map(row => row.ticker);
  report.plannedAllocationPct = plannedAllocationPct;

  writeJsonAtomic(SNAPSHOT_PATH, snapshot);
  writeJsonAtomic(REPORT_PATH, report);
  console.log(JSON.stringify(report, null, 2));
}

main();