#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const CURRENT_PATH = P('data/stable/v16-v169-live-evaluation.json');
const STATUS_PATH = P('data/stable/v16-v169-live-integrity-status.json');
const BEFORE_PATH = process.env.EGX_LIVE_BEFORE_PATH
  ? path.resolve(process.env.EGX_LIVE_BEFORE_PATH)
  : null;
const ENGINE = 'V16_9_EQUAL_WEIGHT_BASKET';
const TERMINAL = new Set(['TARGET_HIT', 'STOP_HIT', 'CASH_UNFILLED', 'TIME_EXIT']);

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
function round(value, digits = 6) {
  const parsed = n(value);
  if (parsed === null) return null;
  const f = 10 ** digits;
  return Math.round(parsed * f) / f;
}
function norm(value) { return String(value || '').trim().toUpperCase(); }
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function stableMemberFingerprint(member) {
  return sha({
    ticker: norm(member?.ticker),
    memberStatus: member?.memberStatus || null,
    entryDate: member?.entryDate || null,
    entryPrice: round(member?.entryPrice),
    entryMode: member?.entryMode || null,
    outcomeDate: member?.outcomeDate || null,
    exitPrice: round(member?.exitPrice),
    grossReturnPct: round(member?.grossReturnPct),
    netReturnPct: round(member?.netReturnPct),
    reasonCode: member?.reasonCode || null,
  });
}
function sessionKey(session) { return String(session?.signalDate || ''); }
function memberKey(member) { return norm(member?.ticker); }
function fail(errors, code, detail = {}) { errors.push({ code, ...detail }); }

function validateCurrentLedger(current, errors) {
  if (current?.engine !== ENGINE) fail(errors, 'ENGINE_MISMATCH', { engine: current?.engine || null });
  const sessions = Array.isArray(current?.sessions) ? current.sessions : [];
  const seenDates = new Set();
  let resolvedCount = 0;

  for (const session of sessions) {
    const signalDate = sessionKey(session);
    if (!signalDate) { fail(errors, 'SESSION_WITHOUT_SIGNAL_DATE'); continue; }
    if (seenDates.has(signalDate)) fail(errors, 'DUPLICATE_SIGNAL_DATE', { signalDate });
    seenDates.add(signalDate);

    const members = Array.isArray(session.members) ? session.members : [];
    if (!members.length) fail(errors, 'SESSION_WITHOUT_MEMBERS', { signalDate });
    const waiting = members.filter(m => m?.memberStatus === 'WAITING').length;
    const allTerminal = members.length > 0 && members.every(m => TERMINAL.has(m?.memberStatus));

    if (session.status === 'RESOLVED') {
      resolvedCount += 1;
      if (!allTerminal) fail(errors, 'RESOLVED_SESSION_HAS_NONTERMINAL_MEMBER', { signalDate, waiting });
      if (n(session.netReturnPct) === null) fail(errors, 'RESOLVED_SESSION_MISSING_NET_RETURN', { signalDate });
      if (!['WIN', 'LOSS', 'FLAT'].includes(session.result)) fail(errors, 'RESOLVED_SESSION_INVALID_RESULT', { signalDate, result: session.result || null });
      if (!session.resolvedAt) fail(errors, 'RESOLVED_SESSION_MISSING_RESOLVED_AT', { signalDate });
    } else {
      if (allTerminal) fail(errors, 'PENDING_SESSION_IS_FULLY_TERMINAL', { signalDate });
      if (waiting < 1) fail(errors, 'PENDING_SESSION_WITHOUT_WAITING_MEMBER', { signalDate });
      if (session.netReturnPct !== undefined || session.result !== undefined || session.resolvedAt !== undefined) {
        fail(errors, 'PENDING_SESSION_CARRIES_RESOLVED_FIELDS', { signalDate });
      }
    }

    for (const member of members) {
      const ticker = memberKey(member);
      if (!ticker) { fail(errors, 'MEMBER_WITHOUT_TICKER', { signalDate }); continue; }
      const status = member?.memberStatus;
      if (status === 'WAITING') continue;
      if (!TERMINAL.has(status)) { fail(errors, 'UNKNOWN_MEMBER_STATUS', { signalDate, ticker, status }); continue; }
      if (!member.outcomeDate) fail(errors, 'TERMINAL_MEMBER_MISSING_OUTCOME_DATE', { signalDate, ticker, status });
      if (member.outcomeDate && member.outcomeDate <= signalDate) fail(errors, 'TERMINAL_MEMBER_OUTCOME_NOT_AFTER_SIGNAL', { signalDate, ticker, outcomeDate: member.outcomeDate });
      if (status === 'CASH_UNFILLED') {
        if (n(member.netReturnPct, 0) !== 0 || n(member.grossReturnPct, 0) !== 0) {
          fail(errors, 'CASH_UNFILLED_NONZERO_RETURN', { signalDate, ticker, grossReturnPct: member.grossReturnPct, netReturnPct: member.netReturnPct });
        }
      } else {
        if (!(n(member.entryPrice) > 0) || !member.entryDate) fail(errors, 'TERMINAL_TRADED_MEMBER_MISSING_ENTRY', { signalDate, ticker, status });
        if (!(n(member.exitPrice) > 0)) fail(errors, 'TERMINAL_TRADED_MEMBER_MISSING_EXIT', { signalDate, ticker, status });
        if (n(member.netReturnPct) === null) fail(errors, 'TERMINAL_TRADED_MEMBER_MISSING_RETURN', { signalDate, ticker, status });
      }
    }
  }

  if (n(current?.summary?.resolvedSessions, -1) !== resolvedCount) {
    fail(errors, 'SUMMARY_RESOLVED_COUNT_MISMATCH', { summaryResolvedSessions: current?.summary?.resolvedSessions ?? null, actualResolvedSessions: resolvedCount });
  }

  return { sessions, resolvedCount };
}

function comparePrevious(previous, current, errors) {
  const previousSessions = Array.isArray(previous?.sessions) ? previous.sessions : [];
  const currentSessions = Array.isArray(current?.sessions) ? current.sessions : [];
  const currentByDate = new Map(currentSessions.map(s => [sessionKey(s), s]));
  const newlyResolvedDates = [];

  for (const beforeSession of previousSessions) {
    const signalDate = sessionKey(beforeSession);
    if (!signalDate) continue;
    const afterSession = currentByDate.get(signalDate);
    if (!afterSession) { fail(errors, 'PREVIOUS_SESSION_DISAPPEARED', { signalDate }); continue; }

    if (beforeSession.status === 'RESOLVED' && afterSession.status !== 'RESOLVED') {
      fail(errors, 'RESOLVED_SESSION_REGRESSED', { signalDate, afterStatus: afterSession.status || null });
    }

    const afterMembers = new Map((afterSession.members || []).map(m => [memberKey(m), m]));
    for (const beforeMember of beforeSession.members || []) {
      if (!TERMINAL.has(beforeMember?.memberStatus)) continue;
      const ticker = memberKey(beforeMember);
      const afterMember = afterMembers.get(ticker);
      if (!afterMember) { fail(errors, 'TERMINAL_MEMBER_DISAPPEARED', { signalDate, ticker }); continue; }
      if (stableMemberFingerprint(beforeMember) !== stableMemberFingerprint(afterMember)) {
        fail(errors, 'TERMINAL_MEMBER_MUTATED', {
          signalDate,
          ticker,
          beforeStatus: beforeMember.memberStatus,
          afterStatus: afterMember.memberStatus,
          beforeReason: beforeMember.reasonCode || null,
          afterReason: afterMember.reasonCode || null,
        });
      }
    }
  }

  const previousResolved = new Set(previousSessions.filter(s => s.status === 'RESOLVED').map(sessionKey));
  for (const session of currentSessions) {
    if (session.status === 'RESOLVED' && !previousResolved.has(sessionKey(session))) newlyResolvedDates.push(sessionKey(session));
  }

  const beforeResolved = n(previous?.summary?.resolvedSessions, previousSessions.filter(s => s.status === 'RESOLVED').length) || 0;
  const afterResolved = n(current?.summary?.resolvedSessions, currentSessions.filter(s => s.status === 'RESOLVED').length) || 0;
  if (afterResolved < beforeResolved) fail(errors, 'RESOLVED_SESSION_COUNT_REGRESSED', { beforeResolved, afterResolved });

  return { beforeResolved, afterResolved, newlyResolvedDates };
}

function main() {
  const current = readJson(CURRENT_PATH, {});
  const previous = BEFORE_PATH ? readJson(BEFORE_PATH, {}) : {};
  const errors = [];
  const currentState = validateCurrentLedger(current, errors);
  const comparison = BEFORE_PATH && Array.isArray(previous?.sessions)
    ? comparePrevious(previous, current, errors)
    : { beforeResolved: null, afterResolved: currentState.resolvedCount, newlyResolvedDates: [] };

  const checks = {
    engineLocked: current?.engine === ENGINE,
    noResolvedSessionRegression: !errors.some(e => ['RESOLVED_SESSION_REGRESSED', 'RESOLVED_SESSION_COUNT_REGRESSED', 'PREVIOUS_SESSION_DISAPPEARED'].includes(e.code)),
    terminalOutcomesImmutable: !errors.some(e => ['TERMINAL_MEMBER_MUTATED', 'TERMINAL_MEMBER_DISAPPEARED'].includes(e.code)),
    resolvedSessionsFullyTerminal: !errors.some(e => e.code === 'RESOLVED_SESSION_HAS_NONTERMINAL_MEMBER'),
    accountingConsistent: !errors.some(e => ['SUMMARY_RESOLVED_COUNT_MISMATCH', 'RESOLVED_SESSION_MISSING_NET_RETURN', 'RESOLVED_SESSION_INVALID_RESULT', 'PENDING_SESSION_CARRIES_RESOLVED_FIELDS', 'PENDING_SESSION_IS_FULLY_TERMINAL'].includes(e.code)),
    noSyntheticSessionClosure: !errors.some(e => ['TERMINAL_MEMBER_MISSING_OUTCOME_DATE', 'TERMINAL_MEMBER_OUTCOME_NOT_AFTER_SIGNAL', 'TERMINAL_TRADED_MEMBER_MISSING_ENTRY', 'TERMINAL_TRADED_MEMBER_MISSING_EXIT', 'TERMINAL_TRADED_MEMBER_MISSING_RETURN'].includes(e.code)),
  };
  const pass = errors.length === 0 && Object.values(checks).every(Boolean);

  const out = {
    schemaVersion: '16.9.2-live-forward-integrity-guard-v1',
    generatedAt: new Date().toISOString(),
    status: pass ? 'PASS' : 'FAIL',
    engine: current?.engine || null,
    beforeLedgerPath: BEFORE_PATH || null,
    resolvedSessionsBefore: comparison.beforeResolved,
    resolvedSessionsAfter: comparison.afterResolved,
    newlyResolvedSessions: comparison.newlyResolvedDates.length,
    newlyResolvedSignalDates: comparison.newlyResolvedDates,
    pendingSessionsAfter: currentState.sessions.filter(s => s.status !== 'RESOLVED').map(sessionKey),
    checks,
    policy: {
      frozenPilotMethodology: true,
      terminalMemberOutcomesImmutable: true,
      resolvedSessionsMayNeverRegress: true,
      newSessionCountRequiresAllMembersTerminal: true,
      noSyntheticFutureSessionClosure: true,
      changesAlphaOrRanking: false,
      changesPublishedSignal: false,
    },
    errors,
    ledgerHash: sha(current),
  };
  writeJsonAtomic(STATUS_PATH, out);
  console.log(JSON.stringify(out, null, 2));
  if (!pass) process.exit(2);
}

main();
