#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const FILES = {
  policy: path.join(ROOT, 'data', 'v13-15-evidence-policy.json'),
  center: path.join(ROOT, 'data', 'quant', 'unified-autonomous-center-v13-14.json'),
  ledger: path.join(ROOT, 'data', 'evidence', 'paper-signals-v13-15.json'),
  history: path.join(ROOT, 'data', 'history')
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function A(value) { return Array.isArray(value) ? value : []; }
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function validPlan(plan) {
  return n(plan?.entryLow, 0) > 0 &&
    n(plan?.entryHigh, 0) >= n(plan?.entryLow, 0) &&
    n(plan?.stopLoss, 0) > 0 &&
    n(plan?.entryLow, 0) > n(plan?.stopLoss, 0) &&
    n(plan?.target1, 0) > n(plan?.entryHigh, 0);
}
function historyRows(doc) {
  const rows = Array.isArray(doc) ? doc
    : Array.isArray(doc?.sessions) ? doc.sessions
    : Array.isArray(doc?.rows) ? doc.rows
    : Array.isArray(doc?.history) ? doc.history
    : [];
  return rows.map(row => ({
    ...row,
    date: dateOnly(row.date || row.sessionDate || row.session),
    open: n(row.open), high: n(row.high), low: n(row.low),
    close: n(row.close), volume: n(row.volume)
  })).filter(row => row.date && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function registrationFields(signal) {
  return {
    schemaVersion: signal.schemaVersion,
    id: signal.id,
    signalDate: signal.signalDate,
    ticker: signal.ticker,
    strategyId: signal.strategyId,
    tier: signal.tier,
    unifiedRank: signal.unifiedRank,
    recommendationScore: signal.recommendationScore,
    riskPct: signal.riskPct,
    entryLow: signal.entryLow,
    entryHigh: signal.entryHigh,
    stopLoss: signal.stopLoss,
    target1: signal.target1,
    target2: signal.target2,
    sourcePatchVersion: signal.sourcePatchVersion,
    sourceCenterHash: signal.sourceCenterHash
  };
}
function makeSignal(candidate, center, nowIso) {
  const base = {
    schemaVersion: '13.15.0',
    signalDate: dateOnly(center.analysisSession),
    ticker: safeTicker(candidate.ticker),
    strategyId: String(candidate.strategyId || '').trim(),
    tier: candidate.tier,
    unifiedRank: n(candidate.unifiedRank),
    recommendationScore: n(candidate.recommendationScore),
    riskPct: n(candidate.riskPct, 0.10),
    entryLow: round(candidate.plan.entryLow),
    entryHigh: round(candidate.plan.entryHigh),
    stopLoss: round(candidate.plan.stopLoss),
    target1: round(candidate.plan.target1),
    target2: round(candidate.plan.target2),
    sourcePatchVersion: center.patchVersion || null,
    sourceCenterHash: hash({
      analysisSession: center.analysisSession,
      marketDate: center.marketDate,
      ticker: candidate.ticker,
      strategyId: candidate.strategyId,
      tier: candidate.tier,
      plan: candidate.plan
    })
  };
  base.id = hash({
    signalDate: base.signalDate,
    ticker: base.ticker,
    strategyId: base.strategyId,
    entryLow: base.entryLow,
    entryHigh: base.entryHigh,
    stopLoss: base.stopLoss,
    target1: base.target1
  }).slice(0, 32);
  const signal = {
    ...base,
    registeredAt: nowIso,
    registrationHash: null,
    status: 'PENDING_ENTRY',
    entryDate: null,
    entryPrice: null,
    exitDate: null,
    exitPrice: null,
    outcome: null,
    grossR: null,
    netR: null,
    evaluatedThrough: null,
    evaluationNote: 'Registered before outcome. Paper evidence only.'
  };
  signal.registrationHash = hash(registrationFields(signal));
  return signal;
}
function chooseEntryPrice(row, signal) {
  if (row.open >= signal.entryLow && row.open <= signal.entryHigh) return row.open;
  if (row.open > signal.entryHigh && row.low <= signal.entryHigh) return signal.entryHigh;
  if (row.open < signal.entryLow && row.high >= signal.entryLow) return signal.entryLow;
  return Math.min(signal.entryHigh, Math.max(signal.entryLow, (signal.entryLow + signal.entryHigh) / 2));
}
function closeSignal(signal, status, row, exitPrice, grossR, policy, note) {
  const costR = n(policy.evaluation.transactionCostR, 0.05);
  return {
    ...signal,
    status,
    exitDate: row.date,
    exitPrice: round(exitPrice),
    outcome: status,
    grossR: round(grossR),
    netR: round(grossR - costR),
    evaluatedThrough: row.date,
    evaluationNote: note
  };
}
function evaluateSignal(signal, rows, policy) {
  if (['CLOSED_TARGET1', 'CLOSED_STOP', 'CLOSED_TIME', 'EXPIRED_NO_ENTRY'].includes(signal.status)) {
    return signal;
  }

  const afterSignal = rows.filter(row => row.date > signal.signalDate);
  const expiry = Math.max(1, n(policy.evaluation.entryExpirySessions, 5));
  const maxHold = Math.max(1, n(policy.evaluation.maximumHoldSessions, 10));
  let working = { ...signal };
  let entryIndex = -1;

  if (working.entryDate) {
    entryIndex = rows.findIndex(row => row.date === working.entryDate);
  } else {
    const entryWindow = afterSignal.slice(0, expiry);
    for (const row of entryWindow) {
      const touched = row.low <= working.entryHigh && row.high >= working.entryLow;
      if (!touched) continue;
      const entryPrice = chooseEntryPrice(row, working);
      working = {
        ...working,
        status: 'OPEN',
        entryDate: row.date,
        entryPrice: round(entryPrice),
        evaluatedThrough: row.date,
        evaluationNote: 'Entry zone touched using conservative paper fill.'
      };
      entryIndex = rows.findIndex(item => item.date === row.date);
      break;
    }
    if (entryIndex < 0 && afterSignal.length >= expiry) {
      const last = afterSignal[Math.min(expiry, afterSignal.length) - 1];
      return {
        ...working,
        status: 'EXPIRED_NO_ENTRY',
        outcome: 'EXPIRED_NO_ENTRY',
        evaluatedThrough: last?.date || working.signalDate,
        evaluationNote: 'Entry zone was not reached before expiry.'
      };
    }
    if (entryIndex < 0) {
      return {
        ...working,
        evaluatedThrough: afterSignal.at(-1)?.date || working.signalDate
      };
    }
  }

  const entryPrice = n(working.entryPrice);
  const risk = entryPrice - n(working.stopLoss);
  if (!(risk > 0)) {
    return {
      ...working,
      status: 'DATA_ERROR',
      evaluationNote: 'Invalid risk distance after entry.'
    };
  }

  const holdRows = rows.slice(entryIndex, entryIndex + maxHold);
  for (const row of holdRows) {
    const stopHit = row.low <= working.stopLoss;
    const targetHit = row.high >= working.target1;

    // Conservative resolution for daily OHLC ambiguity.
    if (stopHit) {
      return closeSignal(
        working, 'CLOSED_STOP', row, working.stopLoss, -1, policy,
        targetHit
          ? 'Stop and target were both inside the same daily bar; STOP_FIRST conservative rule applied.'
          : 'Stop loss reached.'
      );
    }
    if (targetHit) {
      const grossR = (working.target1 - entryPrice) / risk;
      return closeSignal(
        working, 'CLOSED_TARGET1', row, working.target1, grossR, policy,
        'Primary target reached.'
      );
    }
  }

  if (holdRows.length >= maxHold) {
    const last = holdRows.at(-1);
    const grossR = (last.close - entryPrice) / risk;
    return closeSignal(
      working, 'CLOSED_TIME', last, last.close, grossR, policy,
      'Maximum holding period reached; closed at session close.'
    );
  }

  return {
    ...working,
    status: 'OPEN',
    evaluatedThrough: holdRows.at(-1)?.date || working.entryDate
  };
}
function main() {
  const nowIso = new Date().toISOString();
  const policy = readJson(FILES.policy);
  const center = readJson(FILES.center);
  if (!policy) throw new Error('Missing data/v13-15-evidence-policy.json');
  if (!center) throw new Error('Missing unified center output');
  if (!fs.existsSync(FILES.history)) throw new Error('Missing data/history');

  const previous = readJson(FILES.ledger, {
    schemaVersion: '13.15.0',
    createdAt: nowIso,
    signals: []
  });
  const existing = new Map(A(previous.signals).map(signal => [signal.id, signal]));

  let registered = 0;
  const canRegister = center.sessionIntegrity?.ok === true && Boolean(dateOnly(center.analysisSession));
  if (canRegister) {
    const allowed = new Set(A(policy.registration.allowedTiers));
    const selected = A(center.candidates).filter(candidate =>
      allowed.has(candidate.tier) &&
      validPlan(candidate.plan) &&
      String(candidate.strategyId || '').trim() &&
      n(candidate.hardFailureCount, 0) <= n(policy.registration.maximumHardFailureCount, 0)
    ).slice(0, n(policy.registration.maximumSignalsPerSession, 20));

    for (const candidate of selected) {
      const signal = makeSignal(candidate, center, nowIso);
      if (!existing.has(signal.id)) {
        existing.set(signal.id, signal);
        registered += 1;
      }
    }
  }

  const evaluated = [];
  let updated = 0;
  for (const signal of existing.values()) {
    const file = path.join(FILES.history, `${safeTicker(signal.ticker)}.json`);
    const rows = historyRows(readJson(file, []));
    const next = evaluateSignal(signal, rows, policy);
    if (JSON.stringify(next) !== JSON.stringify(signal)) updated += 1;
    evaluated.push(next);
  }

  evaluated.sort((a, b) =>
    String(a.signalDate).localeCompare(String(b.signalDate)) ||
    String(a.ticker).localeCompare(String(b.ticker)) ||
    String(a.id).localeCompare(String(b.id))
  );

  const counts = evaluated.reduce((acc, signal) => {
    acc.total += 1;
    acc[signal.status] = (acc[signal.status] || 0) + 1;
    return acc;
  }, { total: 0 });

  const output = {
    schemaVersion: '13.15.0',
    createdAt: previous.createdAt || nowIso,
    generatedAt: nowIso,
    sourceAnalysisSession: center.analysisSession || null,
    sourceMarketDate: center.marketDate || null,
    registrationAllowed: canRegister,
    immutableRegistration: true,
    conservativeSameBarResolution: policy.evaluation.sameSessionStopAndTargetRule,
    counts,
    run: { registered, updated },
    signals: evaluated
  };
  writeJson(FILES.ledger, output);
  console.log(`V13.15 ledger: total=${counts.total}, registered=${registered}, updated=${updated}, closed=${(counts.CLOSED_TARGET1 || 0) + (counts.CLOSED_STOP || 0) + (counts.CLOSED_TIME || 0)}`);
}

try { main(); }
catch (error) {
  console.error(`V13.15 paper ledger failed: ${error.stack || error.message}`);
  process.exit(1);
}
