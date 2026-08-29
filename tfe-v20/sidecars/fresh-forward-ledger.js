import { createHash } from 'node:crypto';

export const FRESH_FORWARD_POLICY = Object.freeze({
  schemaVersion: 'egx.fresh-forward-policy.1',
  entryRule: 'NEXT_SESSION_ONLY',
  entryFillRule: 'ENTRY_ZONE_TOUCH_NO_GAP_DOWN_FILL',
  maxHoldSessions: 3,
  roundTripCostPct: 0.60,
  sameBarTargetStop: 'STOP_FIRST',
  timeExit: 'THIRD_OBSERVED_SESSION_CLOSE',
  scoringImpact: 'NONE',
  productionAuthority: false,
});

const round = (value, digits = 4) => {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
};

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  return createHash('sha256').update(text).digest('hex');
}

function canonicalV16Signal(row) {
  return {
    ticker: String(row?.ticker ?? '').trim().toUpperCase(),
    rank: Number.isFinite(Number(row?.rank)) ? Number(row.rank) : null,
    category: row?.category ?? null,
    strategyId: row?.strategyId ?? null,
    close: round(row?.close),
    entryLow: round(row?.entryLow),
    entryHigh: round(row?.entryHigh),
    stopLoss: round(row?.stopLoss ?? row?.stop),
    target1: round(row?.target1),
    holdingSessions: Number.isFinite(Number(row?.holdingSessions)) ? Number(row.holdingSessions) : null,
    score: round(row?.score ?? row?.combinedScore, 6),
    currentSessionEligible: row?.currentSessionEligible === true,
    referenceOnly: row?.referenceOnly === true,
  };
}

function canonicalMetaRow(row) {
  return {
    ticker: String(row?.ticker ?? '').trim().toUpperCase(),
    decision: row?.decision ?? null,
    metaScore: round(row?.metaScore, 6),
    blocking: Array.isArray(row?.gates?.blocking) ? [...row.gates.blocking].sort() : [],
    engineCount: Number.isFinite(Number(row?.sourceEngineCount)) ? Number(row.sourceEngineCount) : null,
    sourceConsensus: row?.sourceConsensus ?? null,
    sourceSessions: row?.sourceSessions ?? null,
  };
}

function validateGeometry(signal) {
  return Boolean(
    signal.ticker
    && Number(signal.entryLow) > 0
    && Number(signal.entryHigh) >= Number(signal.entryLow)
    && Number(signal.stopLoss) > 0
    && Number(signal.target1) > 0,
  );
}

export function buildFreshForwardSnapshot({
  signalSessionDate,
  capturedAt,
  nextSessionOpenAt,
  sourceCommit,
  sources,
  v16Payload,
  metaShadowPayload,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(signalSessionDate ?? ''))) {
    throw new Error('INVALID_SIGNAL_SESSION_DATE');
  }
  const captureMs = Date.parse(capturedAt);
  const nextOpenMs = Date.parse(nextSessionOpenAt);
  if (!Number.isFinite(captureMs) || !Number.isFinite(nextOpenMs)) throw new Error('INVALID_CAPTURE_TIMING');
  if (captureMs >= nextOpenMs) throw new Error('CAPTURE_NOT_PRE_OUTCOME');
  if (!sourceCommit || !/^[0-9a-f]{7,40}$/i.test(String(sourceCommit))) throw new Error('INVALID_SOURCE_COMMIT');
  if (v16Payload?.sessionDate !== signalSessionDate) throw new Error('V16_SESSION_MISMATCH');
  if (metaShadowPayload?.sessionDate !== signalSessionDate) throw new Error('META_SESSION_MISMATCH');

  const metaByTicker = new Map((metaShadowPayload?.rows ?? []).map((row) => [String(row?.ticker ?? '').toUpperCase(), canonicalMetaRow(row)]));
  const v16Signals = (v16Payload?.recommendations ?? [])
    .map(canonicalV16Signal)
    .filter(validateGeometry)
    .map((signal) => ({
      ...signal,
      metaShadow: metaByTicker.get(signal.ticker) ?? null,
    }));

  const metaShadowRows = (metaShadowPayload?.rows ?? [])
    .map(canonicalMetaRow)
    .filter((row) => row.ticker);

  const normalizedSources = Object.fromEntries(
    Object.entries(sources ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, source]) => [id, {
      url: source?.url ?? null,
      digestSha256: source?.digestSha256 ?? null,
      sessionDate: source?.sessionDate ?? null,
      generatedAt: source?.generatedAt ?? null,
    }]),
  );

  if (!Object.values(normalizedSources).length) throw new Error('MISSING_SOURCE_PROOFS');
  for (const source of Object.values(normalizedSources)) {
    if (!source.url || !/^[0-9a-f]{64}$/i.test(String(source.digestSha256 ?? ''))) throw new Error('INVALID_SOURCE_PROOF');
  }

  const policyHash = sha256(FRESH_FORWARD_POLICY);
  const payload = {
    schemaVersion: 'egx.fresh-forward-ledger.snapshot.1',
    status: 'FROZEN_PRE_OUTCOME_FORWARD_EVIDENCE',
    researchOnly: true,
    immutable: true,
    scoringImpact: 'NONE',
    signalSessionDate,
    capturedAt: new Date(captureMs).toISOString(),
    nextSessionOpenAt: new Date(nextOpenMs).toISOString(),
    capturedBeforeNextSessionOpen: true,
    sourceCommit: String(sourceCommit),
    policy: FRESH_FORWARD_POLICY,
    policyHash,
    sources: normalizedSources,
    sourceBundleHash: sha256(normalizedSources),
    v16PayloadHash: sha256(v16Payload),
    metaShadowPayloadHash: sha256(metaShadowPayload),
    v16Signals,
    metaShadowRows,
  };
  return Object.freeze({ ...payload, snapshotHash: sha256(payload) });
}

export function verifyFreshForwardSnapshot(snapshot) {
  const errors = [];
  if (snapshot?.schemaVersion !== 'egx.fresh-forward-ledger.snapshot.1') errors.push('SCHEMA');
  if (snapshot?.immutable !== true || snapshot?.researchOnly !== true || snapshot?.scoringImpact !== 'NONE') errors.push('LOCKS');
  if (snapshot?.capturedBeforeNextSessionOpen !== true) errors.push('PRE_OUTCOME_FLAG');
  const captureMs = Date.parse(snapshot?.capturedAt);
  const nextOpenMs = Date.parse(snapshot?.nextSessionOpenAt);
  if (!Number.isFinite(captureMs) || !Number.isFinite(nextOpenMs) || captureMs >= nextOpenMs) errors.push('TIMING');
  if (snapshot?.policyHash !== sha256(FRESH_FORWARD_POLICY)) errors.push('POLICY_HASH');
  if (canonicalJson(snapshot?.policy) !== canonicalJson(FRESH_FORWARD_POLICY)) errors.push('POLICY_MUTATION');
  if (snapshot?.sourceBundleHash !== sha256(snapshot?.sources ?? {})) errors.push('SOURCE_BUNDLE_HASH');
  const withoutHash = { ...snapshot };
  delete withoutHash.snapshotHash;
  if (snapshot?.snapshotHash !== sha256(withoutHash)) errors.push('SNAPSHOT_HASH');
  return { ok: errors.length === 0, errors };
}

function normalizeBars(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      date: String(row?.date ?? row?.sessionDate ?? '').slice(0, 10),
      open: Number(row?.open),
      high: Number(row?.high),
      low: Number(row?.low),
      close: Number(row?.close),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && [row.open, row.high, row.low, row.close].every(Number.isFinite))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function nextSessionFill(bar, signal) {
  const low = Number(signal.entryLow);
  const high = Number(signal.entryHigh);
  if (bar.open >= low && bar.open <= high) return bar.open;
  if (bar.open > high && bar.low <= high) return high;
  if (bar.open < low) return null;
  if (bar.low <= high && bar.high >= low) return high;
  return null;
}

export function evaluateFreshForwardSignal(signal, bars, { asOfDate = null } = {}) {
  const allBars = normalizeBars(bars);
  const future = allBars.filter((bar) => bar.date > signal.sessionDate && (!asOfDate || bar.date <= asOfDate));
  const base = {
    ticker: signal.ticker,
    signalDate: signal.sessionDate,
    category: signal.category ?? null,
    metaDecision: signal.metaShadow?.decision ?? null,
    policyHash: sha256(FRESH_FORWARD_POLICY),
    scoringImpact: 'NONE',
  };

  if (!future.length) return { ...base, status: 'WAITING_FOR_NEXT_SESSION', resolved: false };
  const entryBar = future[0];
  const entryPrice = nextSessionFill(entryBar, signal);
  if (entryPrice == null) return { ...base, status: 'NO_ENTRY_NEXT_SESSION', resolved: true, entryDate: entryBar.date };

  const exitBars = future.slice(0, FRESH_FORWARD_POLICY.maxHoldSessions);
  for (const bar of exitBars) {
    const stopHit = bar.low <= Number(signal.stopLoss);
    const targetHit = bar.high >= Number(signal.target1);
    if (stopHit || targetHit) {
      const sameBar = stopHit && targetHit;
      const stopFirst = stopHit;
      const exitPrice = stopFirst ? Number(signal.stopLoss) : Number(signal.target1);
      return {
        ...base,
        status: sameBar ? 'STOP_SAME_BAR' : stopFirst ? 'STOP' : 'TARGET1',
        resolved: true,
        entryDate: entryBar.date,
        entryPrice: round(entryPrice),
        exitDate: bar.date,
        exitPrice: round(exitPrice),
        stopFirstApplied: sameBar,
        netReturnPct: round((exitPrice - entryPrice) / entryPrice * 100 - FRESH_FORWARD_POLICY.roundTripCostPct, 4),
      };
    }
  }

  if (exitBars.length < FRESH_FORWARD_POLICY.maxHoldSessions) {
    return {
      ...base,
      status: 'OPEN',
      resolved: false,
      entryDate: entryBar.date,
      entryPrice: round(entryPrice),
      sessionsObserved: exitBars.length,
    };
  }

  const exitBar = exitBars.at(-1);
  return {
    ...base,
    status: 'TIME_EXIT',
    resolved: true,
    entryDate: entryBar.date,
    entryPrice: round(entryPrice),
    exitDate: exitBar.date,
    exitPrice: round(exitBar.close),
    netReturnPct: round((exitBar.close - entryPrice) / entryPrice * 100 - FRESH_FORWARD_POLICY.roundTripCostPct, 4),
  };
}

function returnMetrics(returns) {
  const clean = returns.filter(Number.isFinite);
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let gains = 0;
  let losses = 0;
  for (const value of clean) {
    if (value > 0) gains += value;
    if (value < 0) losses += Math.abs(value);
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, (equity / peak - 1) * 100);
  }
  return {
    count: clean.length,
    averageNetReturnPct: clean.length ? round(clean.reduce((a, b) => a + b, 0) / clean.length, 4) : null,
    profitFactor: losses > 0 ? round(gains / losses, 4) : (gains > 0 ? null : 0),
    compoundedNetReturnPct: clean.length ? round((equity - 1) * 100, 4) : null,
    maximumDrawdownPct: clean.length ? round(maxDrawdown, 4) : null,
  };
}

export function summarizeFreshForward(results) {
  const rows = Array.isArray(results) ? results : [];
  const entered = rows.filter((row) => !['WAITING_FOR_NEXT_SESSION', 'NO_ENTRY_NEXT_SESSION'].includes(row.status));
  const resolved = entered.filter((row) => row.resolved === true);
  const primary = resolved.filter((row) => String(row.category ?? '').startsWith('PRIMARY'));
  const metaReady = primary.filter((row) => ['BUY', 'READY'].includes(row.metaDecision));
  return {
    schemaVersion: 'egx.fresh-forward-ledger.summary.1',
    policyHash: sha256(FRESH_FORWARD_POLICY),
    scoringImpact: 'NONE',
    all: {
      signals: rows.length,
      entered: entered.length,
      resolved: resolved.length,
      waiting: rows.filter((row) => row.resolved === false).length,
      noEntryNextSession: rows.filter((row) => row.status === 'NO_ENTRY_NEXT_SESSION').length,
    },
    v16Primary: {
      resolved: primary.length,
      target1: primary.filter((row) => row.status === 'TARGET1').length,
      stops: primary.filter((row) => String(row.status).startsWith('STOP')).length,
      metrics: returnMetrics(primary.map((row) => Number(row.netReturnPct))),
    },
    metaReadyOnV16Primary: {
      resolved: metaReady.length,
      metrics: returnMetrics(metaReady.map((row) => Number(row.netReturnPct))),
      note: 'Shadow cohort only. No positive alpha weight or production authority is granted by this summary.',
    },
  };
}
