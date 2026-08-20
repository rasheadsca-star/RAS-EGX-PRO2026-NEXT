import { createHash } from 'node:crypto';
import { POLICY } from '../src/policy.js';
import { normalizeBars } from '../src/quality.js';

const round = (x, n = 4) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(n)) : null;
const stable = (value) => JSON.stringify(value, Object.keys(value).sort());
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');

function canonicalSignal(row) {
  return Object.freeze({
    sessionDate: row.sessionDate ?? null,
    rank: row.rank ?? null,
    ticker: String(row.ticker ?? '').trim().toUpperCase(),
    decision: row.decision ?? null,
    publicationState: row.publicationState ?? null,
    price: row.price ?? null,
    entryLow: row.entryLow ?? row.tradePlan?.entryLow ?? null,
    entryHigh: row.entryHigh ?? row.tradePlan?.entryHigh ?? null,
    stop: row.stop ?? row.tradePlan?.stop ?? null,
    target1: row.target1 ?? row.tradePlan?.target1 ?? null,
    target2: row.target2 ?? row.tradePlan?.target2 ?? null,
    fusionRankScore: row.fusionRankScore ?? row.scores?.fusionRank ?? null,
    researchScore: row.researchScore ?? row.scores?.research ?? null,
    technicalScore: row.technicalScore ?? row.scores?.core ?? null,
    sourceCommit: row.sourceCommit ?? null,
  });
}

export function freezeDecisionRows(rows, { generatedAt = new Date().toISOString(), sourceCommit = null } = {}) {
  const signals = Object.freeze((Array.isArray(rows) ? rows : [])
    .map(canonicalSignal)
    .filter((x) => x.ticker && x.sessionDate && Number(x.entryLow) > 0 && Number(x.entryHigh) >= Number(x.entryLow) && Number(x.stop) > 0 && Number(x.target1) > 0)
    .map((signal) => Object.freeze({ ...signal, signalHash: sha256(stable(signal)) })));
  const payload = {
    schemaVersion: 'tfe.forward.1',
    generatedAt,
    sourceCommit,
    researchOnly: true,
    immutable: true,
    scoringImpact: 'NONE',
    signals,
  };
  return Object.freeze({ ...payload, snapshotHash: sha256(JSON.stringify(payload)) });
}

function fill(bar, signal) {
  const low = Number(signal.entryLow), high = Number(signal.entryHigh);
  if (bar.open >= low && bar.open <= high) return bar.open;
  if (bar.open > high && bar.low <= high) return high;
  if (bar.open < low) return null;
  if (bar.low <= high && bar.high >= low) return high;
  return null;
}

export function evaluateFrozenSignal(signal, rows, { asOfDate = null } = {}) {
  const frozen = canonicalSignal(signal);
  const allBars = normalizeBars(rows ?? []).bars;
  const future = allBars.filter((bar) => bar.date > frozen.sessionDate && (!asOfDate || bar.date <= asOfDate));
  const entryWindow = future.slice(0, POLICY.entryExpirySessions);
  let entryIndex = -1, entryPrice = null;
  for (let i = 0; i < entryWindow.length; i += 1) {
    const price = fill(entryWindow[i], frozen);
    if (price != null) { entryIndex = i; entryPrice = price; break; }
  }

  const base = {
    ticker: frozen.ticker,
    signalDate: frozen.sessionDate,
    signalHash: signal.signalHash ?? sha256(stable(frozen)),
    asOfDate: asOfDate ?? allBars.at(-1)?.date ?? null,
    scoringImpact: 'NONE',
  };

  if (entryIndex < 0) {
    if (entryWindow.length < POLICY.entryExpirySessions) return { ...base, status: 'WAITING_FOR_ENTRY', resolved: false };
    return { ...base, status: 'EXPIRED', resolved: true };
  }

  const entryBar = entryWindow[entryIndex];
  const absoluteEntryIndex = future.findIndex((bar) => bar.date === entryBar.date);
  const exitBars = future.slice(absoluteEntryIndex, absoluteEntryIndex + POLICY.maxHoldSessions);
  for (let i = 0; i < exitBars.length; i += 1) {
    const bar = exitBars[i];
    const hitStop = bar.low <= Number(frozen.stop);
    const hitT1 = bar.high >= Number(frozen.target1);
    if (hitStop || hitT1) {
      const sameBar = hitStop && hitT1;
      const outcome = hitStop ? (sameBar ? 'STOP_SAME_BAR' : 'STOP') : 'TARGET1';
      const exitPrice = hitStop ? Number(frozen.stop) : Number(frozen.target1);
      return {
        ...base,
        status: outcome,
        resolved: true,
        entryDate: entryBar.date,
        entryPrice: round(entryPrice),
        exitDate: bar.date,
        exitPrice: round(exitPrice),
        netPct: round((exitPrice - entryPrice) / entryPrice * 100 - POLICY.roundTripCostPct, 2),
        stopFirstApplied: sameBar,
      };
    }
  }

  if (exitBars.length >= POLICY.maxHoldSessions) {
    const bar = exitBars.at(-1);
    return {
      ...base,
      status: 'TIME_EXIT',
      resolved: true,
      entryDate: entryBar.date,
      entryPrice: round(entryPrice),
      exitDate: bar.date,
      exitPrice: round(bar.close),
      netPct: round((bar.close - entryPrice) / entryPrice * 100 - POLICY.roundTripCostPct, 2),
    };
  }

  return {
    ...base,
    status: 'OPEN',
    resolved: false,
    entryDate: entryBar.date,
    entryPrice: round(entryPrice),
    sessionsObservedAfterEntry: exitBars.length,
  };
}

export function summarizeForwardEvidence(results) {
  const rows = Array.isArray(results) ? results : [];
  const resolved = rows.filter((x) => x.resolved && !['EXPIRED'].includes(x.status));
  const entered = rows.filter((x) => !['WAITING_FOR_ENTRY', 'EXPIRED'].includes(x.status));
  const t1 = resolved.filter((x) => x.status === 'TARGET1').length;
  const stops = resolved.filter((x) => String(x.status).startsWith('STOP')).length;
  const positive = resolved.filter((x) => Number(x.netPct) > 0).length;
  return {
    schemaVersion: 'tfe.forward.summary.1',
    scoringImpact: 'NONE',
    totalSignals: rows.length,
    entered: entered.length,
    resolved: resolved.length,
    open: rows.filter((x) => !x.resolved).length,
    expired: rows.filter((x) => x.status === 'EXPIRED').length,
    target1Pct: resolved.length ? round(t1 / resolved.length * 100, 1) : null,
    stopPct: resolved.length ? round(stops / resolved.length * 100, 1) : null,
    positivePct: resolved.length ? round(positive / resolved.length * 100, 1) : null,
  };
}
