#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const LEDGER_PATH = path.join(ROOT, 'data/stable/v16-v169-live-evaluation.json');
const LOCK_PATH = path.join(ROOT, 'data/stable/v16-v169-release-lock.json');

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
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 4) {
  const parsed = n(value);
  if (parsed === null) return null;
  const f = 10 ** digits;
  return Math.round(parsed * f) / f;
}
function pct(exitPrice, entryPrice) {
  const e = n(entryPrice);
  const x = n(exitPrice);
  if (!(e > 0) || x === null) return null;
  return (x / e - 1) * 100;
}

const TERMINAL = new Set(['TARGET_HIT', 'STOP_HIT', 'CASH_UNFILLED', 'TIME_EXIT']);
const UNFILLED_REASONS = new Set([
  'NOT_ENTERED_GAP_BELOW_STOP',
  'NOT_ENTERED_GAP_ABOVE_ZONE',
  'NOT_ENTERED_FIRST_SESSION',
]);

function normalizeMember(member, costPct) {
  const out = { ...member };
  if (out.memberStatus !== 'WAITING') return out;

  if (UNFILLED_REASONS.has(out.reasonCode)) {
    out.originalReasonCode = out.originalReasonCode || out.reasonCode;
    out.memberStatus = 'CASH_UNFILLED';
    out.statusAr = 'لم تتفعل التوصية في جلسة الدخول المحددة — بقي الوزن نقدًا';
    out.outcomeDate = Array.isArray(out.evaluationWindowDates) && out.evaluationWindowDates.length
      ? out.evaluationWindowDates[0]
      : out.outcomeDate || null;
    out.exitPrice = null;
    out.grossReturnPct = 0;
    out.netReturnPct = 0;
    out.reasonCode = 'UNFILLED_KEEP_CASH';
    return out;
  }

  if (out.reasonCode === 'HOLDING_WINDOW_COMPLETE_UNRESOLVED') {
    const entry = n(out.entryPrice);
    const close = n(out.lastObservedClose);
    const dates = Array.isArray(out.evaluationWindowDates) ? out.evaluationWindowDates : [];
    if (entry > 0 && close !== null && dates.length) {
      const gross = pct(close, entry);
      out.memberStatus = 'TIME_EXIT';
      out.statusAr = 'انتهت مدة الاحتفاظ دون هدف أو وقف — خروج بسعر الإغلاق';
      out.outcomeDate = dates[dates.length - 1];
      out.exitPrice = close;
      out.grossReturnPct = round(gross, 4);
      out.netReturnPct = round(gross - costPct, 4);
      out.reasonCode = 'TIME_EXIT_HOLDING_WINDOW_COMPLETE';
    }
  }

  return out;
}

function sessionSummary(members) {
  return {
    total: members.length,
    targetHits: members.filter(m => m.memberStatus === 'TARGET_HIT').length,
    stopHits: members.filter(m => m.memberStatus === 'STOP_HIT').length,
    cashUnfilled: members.filter(m => m.memberStatus === 'CASH_UNFILLED').length,
    timeExits: members.filter(m => m.memberStatus === 'TIME_EXIT').length,
    waiting: members.filter(m => m.memberStatus === 'WAITING').length,
  };
}

function aggregateResolvedSessions(sessions) {
  const returns = sessions
    .filter(s => s.status === 'RESOLVED')
    .map(s => n(s.netReturnPct))
    .filter(v => v !== null);
  const gains = returns.reduce((sum, v) => sum + Math.max(0, v), 0);
  const losses = Math.abs(returns.reduce((sum, v) => sum + Math.min(0, v), 0));
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const v of returns) {
    equity *= 1 + v / 100;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, (equity / peak - 1) * 100);
  }
  return {
    resolvedSessions: returns.length,
    winningSessions: returns.filter(v => v > 0).length,
    losingSessions: returns.filter(v => v < 0).length,
    flatSessions: returns.filter(v => v === 0).length,
    winningSessionPct: round(returns.length ? returns.filter(v => v > 0).length / returns.length * 100 : 0, 3),
    averageNetReturnPct: round(returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0, 4),
    profitFactor: round(losses > 0 ? gains / losses : null, 3),
    compoundedNetReturnPct: round((equity - 1) * 100, 3),
    maximumDrawdownPct: round(maxDd, 3),
    bestSessionPct: round(returns.length ? Math.max(...returns) : null, 3),
    worstSessionPct: round(returns.length ? Math.min(...returns) : null, 3),
  };
}

function normalizeLedger() {
  const ledger = readJson(LEDGER_PATH, {});
  const lock = readJson(LOCK_PATH, {});
  const costPct = n(lock?.pilotRules?.estimatedRoundTripCostPct, 0.6);
  const sessions = Array.isArray(ledger.sessions) ? ledger.sessions : [];

  let normalizedMembers = 0;
  let newlyResolvedSessions = 0;

  for (const session of sessions) {
    const beforeStatus = session.status;
    const members = (Array.isArray(session.members) ? session.members : []).map(member => {
      const before = member.memberStatus;
      const normalized = normalizeMember(member, costPct);
      if (normalized.memberStatus !== before) normalizedMembers += 1;
      return normalized;
    });
    session.members = members;
    session.memberSummary = sessionSummary(members);

    const allTerminal = members.length > 0 && members.every(m => TERMINAL.has(m.memberStatus));
    if (allTerminal) {
      const returns = members.map(m => n(m.netReturnPct, 0));
      const sessionNet = returns.reduce((a, b) => a + b, 0) / returns.length;
      session.status = 'RESOLVED';
      session.netReturnPct = round(sessionNet, 4);
      session.result = sessionNet > 0 ? 'WIN' : sessionNet < 0 ? 'LOSS' : 'FLAT';
      session.resolvedAt = session.resolvedAt || new Date().toISOString();
      session.outcomeDate = members
        .map(m => m.outcomeDate)
        .filter(Boolean)
        .sort()
        .at(-1) || session.outcomeDate || null;
      if (beforeStatus !== 'RESOLVED') newlyResolvedSessions += 1;
    } else {
      session.status = 'PENDING_OUTCOME';
      delete session.netReturnPct;
      delete session.result;
      delete session.resolvedAt;
    }
  }

  const summary = aggregateResolvedSessions(sessions);
  const allMembers = sessions.flatMap(s => Array.isArray(s.members) ? s.members : []);
  const targetHits = allMembers.filter(m => m.memberStatus === 'TARGET_HIT').length;
  const stopHits = allMembers.filter(m => m.memberStatus === 'STOP_HIT').length;
  const cashUnfilled = allMembers.filter(m => m.memberStatus === 'CASH_UNFILLED').length;
  const timeExits = allMembers.filter(m => m.memberStatus === 'TIME_EXIT').length;
  const waiting = allMembers.filter(m => m.memberStatus === 'WAITING').length;
  const resolvedRecommendations = allMembers.filter(m => TERMINAL.has(m.memberStatus)).length;

  ledger.summary = summary;
  ledger.memberSummary = {
    totalRecommendations: allMembers.length,
    targetHits,
    stopHits,
    cashUnfilled,
    timeExits,
    waiting,
    resolvedRecommendations,
    targetVsStopSuccessRatePct: round((targetHits + stopHits) ? targetHits / (targetHits + stopHits) * 100 : null, 2),
  };

  const gate = lock.promotionGate || {};
  ledger.promotionChecks = {
    minimumResolvedSessions: summary.resolvedSessions >= n(gate.minimumResolvedSessions, 20),
    positiveAverageNetReturn: n(summary.averageNetReturnPct, 0) > 0,
    minimumProfitFactor: n(summary.profitFactor, 0) >= n(gate.minimumProfitFactor, 1.2),
    minimumWinningSessionPct: n(summary.winningSessionPct, 0) >= n(gate.minimumWinningSessionPct, 45),
    maximumDrawdown: n(summary.maximumDrawdownPct, -100) >= n(gate.maximumDrawdownFloorPct, -15),
  };
  ledger.promotionEligible = Object.values(ledger.promotionChecks).every(Boolean);
  ledger.nextCheckpoint = (lock.reviewCheckpoints || [5, 10, 20, 30]).find(v => v > summary.resolvedSessions) || null;
  ledger.normalization = {
    schemaVersion: '16.9.2-live-resolution-accounting-v1',
    generatedAt: new Date().toISOString(),
    policy: {
      unfilledMemberPolicy: lock?.pilotRules?.unfilledMemberPolicy || 'KEEP_CASH',
      noEntryOutcome: 'CASH_UNFILLED_0_RETURN',
      holdingWindowCompleteOutcome: 'TIME_EXIT_LAST_CLOSE',
      futureDataStillRequired: true,
      changesAlphaOrPublishedSignal: false,
    },
    normalizedMembers,
    newlyResolvedSessions,
    totalTrackedSessions: sessions.length,
    resolvedSessions: summary.resolvedSessions,
    pendingSessions: sessions.filter(s => s.status !== 'RESOLVED').length,
  };

  ledger.evaluationPolicy = {
    ...(ledger.evaluationPolicy || {}),
    unfilledMemberPolicy: 'KEEP_CASH_AND_RESOLVE_ZERO_RETURN',
    holdingWindowExpiryRule: 'EXIT_AT_LAST_OBSERVED_CLOSE',
    unresolvedState: 'WAITING_ONLY_WHEN_FUTURE_MARKET_DATA_IS_GENUINELY_REQUIRED',
  };

  writeJsonAtomic(LEDGER_PATH, ledger);
  console.log(JSON.stringify({
    totalTrackedSessions: sessions.length,
    resolvedSessions: summary.resolvedSessions,
    pendingSessions: sessions.filter(s => s.status !== 'RESOLVED').length,
    normalizedMembers,
    newlyResolvedSessions,
    memberSummary: ledger.memberSummary,
    summary,
    promotionChecks: ledger.promotionChecks,
  }, null, 2));
  return ledger;
}

if (require.main === module) normalizeLedger();
module.exports = { normalizeLedger };
