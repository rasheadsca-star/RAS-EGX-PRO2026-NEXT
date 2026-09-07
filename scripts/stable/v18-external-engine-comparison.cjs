#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const OUT = path.join(ROOT, 'data/stable/v18-global-strategy-ensemble.json');
const REGISTRY = path.join(ROOT, 'data/stable/v18-external-engine-snapshots.json');
const STOCKS = path.join(ROOT, 'data/quant/stocks');
const TRACKING_START = '2026-09-07';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, digits = 2) {
  const n = num(v);
  return n == null ? null : Number(n.toFixed(digits));
}

function pct(a, b) {
  return b > 0 ? round((a / b) * 100, 1) : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadStocks() {
  const map = new Map();
  for (const file of fs.readdirSync(STOCKS).filter(x => x.endsWith('.json'))) {
    const stock = readJson(path.join(STOCKS, file));
    if (stock?.ticker) map.set(String(stock.ticker).toUpperCase(), stock);
  }
  return map;
}

function barsAfter(stock, issueSession) {
  const chart = stock?.chart || {};
  const dates = Array.isArray(chart.dates) ? chart.dates : [];
  const idx = dates.indexOf(issueSession);
  if (idx < 0) return [];
  const rows = [];
  for (let i = idx + 1; i < dates.length; i += 1) {
    if (dates[i] < TRACKING_START) continue;
    rows.push({
      date: dates[i],
      open: num(chart.open?.[i]),
      high: num(chart.high?.[i]),
      low: num(chart.low?.[i]),
      close: num(chart.close?.[i])
    });
  }
  return rows;
}

function evaluate(rec, sessionId, stock) {
  const entryLow = num(rec.entryLow);
  const entryHigh = num(rec.entryHigh);
  const stop = num(rec.stopLoss);
  const target = num(rec.target1);
  const referenceClose = num(rec.referenceClose);

  if ([entryLow, entryHigh, stop, target].some(x => x == null)) {
    return { status: 'NO_EVALUABLE_PLAN', referenceActivation: false, resolved: false };
  }

  const bars = barsAfter(stock, sessionId);
  if (!bars.length) {
    return { status: 'PENDING_FUTURE_SESSION', referenceActivation: false, resolved: false };
  }

  const first = bars[0];
  const gapPct = referenceClose > 0 && first.open != null
    ? round(((first.open / referenceClose) - 1) * 100)
    : null;

  if (first.open != null && first.open > entryHigh) {
    return { status: 'CANCELLED_NO_CHASE_GAP', referenceActivation: false, resolved: false, gapPct };
  }
  if (first.open != null && first.open <= stop) {
    return { status: 'CANCELLED_OPEN_BELOW_STOP', referenceActivation: false, resolved: false, gapPct };
  }

  const openInBand = first.open != null && first.open >= entryLow && first.open <= entryHigh;
  const intradayTouch = first.low != null && first.high != null && first.low <= entryHigh && first.high >= entryLow;
  if (!openInBand && !intradayTouch) {
    return { status: 'NOT_TRIGGERED_NEXT_SESSION', referenceActivation: false, resolved: false, gapPct };
  }

  const maxHold = Math.max(1, Math.min(10, Number(rec.maximumHoldingSessions || 5)));
  const observed = bars.slice(0, maxHold);
  for (let i = 0; i < observed.length; i += 1) {
    const bar = observed[i];
    const hitTarget = bar.high != null && bar.high >= target;
    const hitStop = bar.low != null && bar.low <= stop;
    if (hitTarget && hitStop) {
      return {
        status: 'AMBIGUOUS_TARGET_STOP_SAME_BAR',
        referenceActivation: true,
        resolved: false,
        ambiguous: true,
        resolutionSession: bar.date
      };
    }
    if (hitTarget) {
      return {
        status: 'TARGET1_HIT',
        referenceActivation: true,
        resolved: true,
        outcome: 'TARGET',
        resolutionSession: bar.date
      };
    }
    if (hitStop) {
      if (i === 0 && !openInBand) {
        return {
          status: 'AMBIGUOUS_ENTRY_STOP_SEQUENCE',
          referenceActivation: true,
          resolved: false,
          ambiguous: true,
          resolutionSession: bar.date
        };
      }
      return {
        status: 'STOP_HIT',
        referenceActivation: true,
        resolved: true,
        outcome: 'STOP',
        resolutionSession: bar.date
      };
    }
  }

  return { status: 'OPEN_UNRESOLVED', referenceActivation: true, resolved: false };
}

if (!fs.existsSync(OUT)) throw new Error('V18 output missing');
if (!fs.existsSync(REGISTRY)) throw new Error('External engine snapshot registry missing');

const source = readJson(OUT);
const registry = readJson(REGISTRY);
const stocks = loadStocks();
const league = source.enginePerformanceLeague;
if (!league || !Array.isArray(league.engines)) throw new Error('Engine Performance League missing before external adapter');

const externalRows = [];
for (const engine of registry.engines || []) {
  const captured = (engine.snapshots || []).filter(s =>
    s.sessionId >= TRACKING_START &&
    s.captureStatus === 'CAPTURED' &&
    Array.isArray(s.publishedRecommendations)
  );

  const recommendations = [];
  for (const snap of captured) {
    for (const rec of snap.publishedRecommendations || []) {
      const ticker = String(rec.ticker || '').toUpperCase();
      const stock = stocks.get(ticker);
      recommendations.push({
        sessionId: snap.sessionId,
        ticker,
        rank: Number(rec.rank || 0),
        result: stock
          ? evaluate(rec, snap.sessionId, stock)
          : { status: 'CANONICAL_STOCK_MISSING', referenceActivation: false, resolved: false }
      });
    }
  }

  const results = recommendations.map(x => x.result);
  const evaluable = results.filter(x => !['NO_EVALUABLE_PLAN', 'PENDING_FUTURE_SESSION', 'CANONICAL_STOCK_MISSING'].includes(x.status));
  const activated = results.filter(x => x.referenceActivation);
  const targetHits = results.filter(x => x.outcome === 'TARGET').length;
  const stopHits = results.filter(x => x.outcome === 'STOP').length;
  const ambiguous = results.filter(x => x.ambiguous).length;
  const unresolved = results.filter(x => x.referenceActivation && !x.resolved && !x.ambiguous).length;
  const cancelled = results.filter(x => ['CANCELLED_NO_CHASE_GAP', 'CANCELLED_OPEN_BELOW_STOP', 'NOT_TRIGGERED_NEXT_SESSION'].includes(x.status)).length;
  const resolvedSignals = targetHits + stopHits;
  const currentSnapshot = (engine.snapshots || []).find(s => s.sessionId === TRACKING_START);
  const snapshotRequired = !currentSnapshot || currentSnapshot.captureStatus === 'PENDING_SOURCE_CAPTURE';

  externalRows.push({
    engineId: engine.engineId,
    label: engine.label,
    labelAr: engine.labelAr,
    sourceUrl: engine.sourceUrl,
    externalIndependent: true,
    collectionMode: engine.collectionMode,
    sourceAccessStatus: engine.sourceAccessStatus,
    trackingStartsOn: TRACKING_START,
    issuedSignals: recommendations.length,
    evaluableSignals: evaluable.length,
    referenceActivated: activated.length,
    target1Hits: targetHits,
    stopHits,
    ambiguous,
    unresolved,
    cancelledOrNotTriggered: cancelled,
    resolvedSignals,
    activationRatePct: pct(activated.length, evaluable.length),
    targetHitRateResolvedPct: pct(targetHits, resolvedSignals),
    targetHitRateActivatedPct: pct(targetHits, activated.length),
    stopRateResolvedPct: pct(stopHits, resolvedSignals),
    rankingEligible: resolvedSignals >= Number(league.rankingMinimumResolvedSignals || 5),
    leagueRank: null,
    status: snapshotRequired
      ? 'SOURCE_SNAPSHOT_REQUIRED'
      : recommendations.length === 0
        ? 'NO_PUBLISHED_SIGNALS'
        : results.some(x => x.resolved || x.referenceActivation)
          ? 'TRACKING'
          : 'WAITING_FOR_FUTURE_SESSION',
    snapshotAudit: {
      capturedSessionsFromTrackingStart: captured.length,
      latestKnownSnapshotSession: (engine.snapshots || []).map(x => x.sessionId).sort().at(-1) || null,
      nearConfirmationsExcludedFromPerformance: true
    }
  });
}

const externalIds = new Set(externalRows.map(x => x.engineId));
league.engines = league.engines.filter(x => !externalIds.has(x.engineId)).concat(externalRows);
league.engines.sort((a, b) => {
  if (a.rankingEligible !== b.rankingEligible) return Number(b.rankingEligible) - Number(a.rankingEligible);
  const ar = a.targetHitRateResolvedPct ?? -1;
  const br = b.targetHitRateResolvedPct ?? -1;
  if (ar !== br) return br - ar;
  if (a.resolvedSignals !== b.resolvedSignals) return b.resolvedSignals - a.resolvedSignals;
  if (a.issuedSignals !== b.issuedSignals) return b.issuedSignals - a.issuedSignals;
  return String(a.engineId).localeCompare(String(b.engineId));
});

let formalRank = 0;
for (const row of league.engines) {
  row.leagueRank = row.rankingEligible ? ++formalRank : null;
}

league.summary = {
  ...(league.summary || {}),
  enginesTracked: league.engines.length,
  enginesWithSignals: league.engines.filter(x => x.issuedSignals > 0).length,
  externalIndependentEngines: externalRows.length
};

source.externalEngineRegistry = {
  schemaVersion: registry.schemaVersion,
  trackingStartsOn: registry.trackingStartsOn,
  engines: (registry.engines || []).map(x => ({
    engineId: x.engineId,
    label: x.label,
    labelAr: x.labelAr,
    sourceUrl: x.sourceUrl,
    collectionMode: x.collectionMode,
    sourceAccessStatus: x.sourceAccessStatus,
    comparisonPolicy: x.comparisonPolicy,
    snapshots: x.snapshots
  }))
};

writeJson(OUT, source);
console.log(JSON.stringify({
  externalEnginesAdded: externalRows.map(x => ({
    engineId: x.engineId,
    status: x.status,
    issuedSignals: x.issuedSignals,
    target1Hits: x.target1Hits,
    stopHits: x.stopHits
  })),
  enginesTracked: league.engines.length
}, null, 2));
