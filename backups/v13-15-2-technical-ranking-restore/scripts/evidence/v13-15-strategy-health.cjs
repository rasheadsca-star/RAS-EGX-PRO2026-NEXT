#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const FILES = {
  policy: path.join(ROOT, 'data', 'v13-15-evidence-policy.json'),
  ledger: path.join(ROOT, 'data', 'evidence', 'paper-signals-v13-15.json'),
  legacy: path.join(ROOT, 'data', 'quant', 'strategy-health.json'),
  output: path.join(ROOT, 'data', 'quant', 'strategy-health-v13-15.json')
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
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function profitFactor(values) {
  const wins = values.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses === 0) return wins > 0 ? 999 : 0;
  return wins / losses;
}
function equityStats(signals) {
  let equity = 100;
  let peak = 100;
  let maxDrawdownPct = 0;
  const curve = [];
  for (const signal of signals) {
    const riskPct = Math.max(0, n(signal.riskPct, 0.10));
    equity *= 1 + (n(signal.netR, 0) * riskPct / 100);
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);
    curve.push({
      date: signal.exitDate,
      signalId: signal.id,
      equity: round(equity, 4),
      drawdownPct: round(drawdown, 4)
    });
  }
  return { endingEquity: round(equity, 4), maxDrawdownPct: round(maxDrawdownPct, 4), curve };
}
function passes(metrics, gate) {
  return metrics.closedTrades >= n(gate.minimumClosedTrades, Infinity) &&
    metrics.forwardSessions >= n(gate.minimumForwardSessions, Infinity) &&
    metrics.profitFactor >= n(gate.minimumProfitFactor, Infinity) &&
    metrics.averageR > n(gate.minimumAverageR, 0) &&
    metrics.medianR > n(gate.minimumMedianR, 0) &&
    metrics.maxDrawdownPct <= n(gate.maximumDrawdownPct, -Infinity);
}
function main() {
  const nowIso = new Date().toISOString();
  const policy = readJson(FILES.policy);
  const ledger = readJson(FILES.ledger, { signals: [] });
  const legacy = readJson(FILES.legacy, { strategies: [] });
  if (!policy) throw new Error('Missing evidence policy');

  const legacyMap = new Map(A(legacy.strategies).map(item => [String(item.strategyId || ''), item]));
  const grouped = new Map();
  for (const signal of A(ledger.signals)) {
    const id = String(signal.strategyId || '').trim();
    if (!id) continue;
    const list = grouped.get(id) || [];
    list.push(signal);
    grouped.set(id, list);
  }

  // Keep known legacy strategies visible even before the first evidence signal.
  for (const id of legacyMap.keys()) {
    if (!grouped.has(id)) grouped.set(id, []);
  }

  const strategies = [];
  for (const [strategyId, signals] of grouped.entries()) {
    const closed = signals.filter(signal =>
      ['CLOSED_TARGET1', 'CLOSED_STOP', 'CLOSED_TIME'].includes(signal.status) &&
      Number.isFinite(Number(signal.netR))
    ).sort((a, b) =>
      String(a.exitDate || '').localeCompare(String(b.exitDate || '')) ||
      String(a.id).localeCompare(String(b.id))
    );
    const rs = closed.map(signal => Number(signal.netR));
    const sessions = [...new Set(signals.map(signal => signal.signalDate).filter(Boolean))].sort();
    const eq = equityStats(closed);
    const metrics = {
      registeredSignals: signals.length,
      pendingEntry: signals.filter(signal => signal.status === 'PENDING_ENTRY').length,
      openTrades: signals.filter(signal => signal.status === 'OPEN').length,
      expiredNoEntry: signals.filter(signal => signal.status === 'EXPIRED_NO_ENTRY').length,
      closedTrades: closed.length,
      wins: rs.filter(value => value > 0).length,
      losses: rs.filter(value => value < 0).length,
      flat: rs.filter(value => value === 0).length,
      winRatePct: closed.length ? round(rs.filter(value => value > 0).length / closed.length * 100, 2) : 0,
      profitFactor: round(profitFactor(rs), 4),
      averageR: closed.length ? round(rs.reduce((sum, value) => sum + value, 0) / closed.length, 4) : 0,
      medianR: closed.length ? round(median(rs), 4) : 0,
      totalR: round(rs.reduce((sum, value) => sum + value, 0), 4),
      maxDrawdownPct: eq.maxDrawdownPct,
      endingPaperEquity: eq.endingEquity,
      forwardSessions: sessions.length,
      firstSignalDate: sessions[0] || null,
      latestSignalDate: sessions.at(-1) || null
    };

    let status = 'RESEARCH_ONLY';
    let riskScale = 0;
    let activationReason = 'Insufficient forward paper evidence.';
    if (passes(metrics, policy.activation.activeLimited)) {
      status = 'ACTIVE_LIMITED';
      riskScale = n(policy.activation.activeLimited.riskScale, 0.25);
      activationReason = 'Passed limited paper activation gate. Live execution remains disabled.';
    } else if (passes(metrics, policy.activation.activePaper)) {
      status = 'ACTIVE_PAPER';
      riskScale = n(policy.activation.activePaper.riskScale, 0.10);
      activationReason = 'Passed paper activation gate. Live execution remains disabled.';
    }

    const legacyItem = legacyMap.get(strategyId) || {};
    strategies.push({
      strategyId,
      strategyNameAr: legacyItem.strategyNameAr || legacyItem.nameAr || strategyId,
      status,
      evidenceStatus: status,
      validationSource: 'FORWARD_PAPER_LEDGER_V13_15',
      riskScale,
      activationReason,
      metrics,
      legacyStatus: legacyItem.status || null,
      liveExecutionEnabled: false,
      automaticOrderSubmission: false
    });
  }

  strategies.sort((a, b) =>
    ({ ACTIVE_LIMITED: 3, ACTIVE_PAPER: 2, RESEARCH_ONLY: 1 }[b.status] || 0) -
    ({ ACTIVE_LIMITED: 3, ACTIVE_PAPER: 2, RESEARCH_ONLY: 1 }[a.status] || 0) ||
    b.metrics.closedTrades - a.metrics.closedTrades ||
    a.strategyId.localeCompare(b.strategyId)
  );

  const summary = {
    registeredSignals: A(ledger.signals).length,
    closedTrades: strategies.reduce((sum, item) => sum + item.metrics.closedTrades, 0),
    activeLimitedStrategies: strategies.filter(item => item.status === 'ACTIVE_LIMITED').length,
    activePaperStrategies: strategies.filter(item => item.status === 'ACTIVE_PAPER').length,
    researchOnlyStrategies: strategies.filter(item => item.status === 'RESEARCH_ONLY').length,
    liveExecutionEnabled: false,
    evidenceGate: strategies.some(item => ['ACTIVE_PAPER', 'ACTIVE_LIMITED'].includes(item.status))
      ? 'PAPER_GATE_PASSED'
      : 'RESEARCH_ONLY'
  };

  const output = {
    schemaVersion: '13.15.0',
    generatedAt: nowIso,
    sessionId: ledger.sourceAnalysisSession || null,
    validationMode: 'FORWARD_PAPER_EVIDENCE',
    summary,
    activationPolicy: policy.activation,
    strategies
  };
  writeJson(FILES.output, output);
  console.log(`V13.15 health: strategies=${strategies.length}, closed=${summary.closedTrades}, activePaper=${summary.activePaperStrategies}, activeLimited=${summary.activeLimitedStrategies}`);
}

try { main(); }
catch (error) {
  console.error(`V13.15 strategy health failed: ${error.stack || error.message}`);
  process.exit(1);
}
