#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const RELATIVE = 'data/stable/v16-v169-live-evaluation.json';
const CURRENT_PATH = path.join(ROOT, RELATIVE);
const ENGINE = 'V16_9_EQUAL_WEIGHT_BASKET';
const TERMINAL = new Set(['TARGET_HIT', 'STOP_HIT', 'CASH_UNFILLED', 'TIME_EXIT']);

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const n = value => Number.isFinite(Number(value)) ? Number(value) : null;
const norm = value => String(value || '').trim().toUpperCase();
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = (value, d = 6) => n(value) === null ? null : Number(Number(value).toFixed(d));

function previousCommittedLedger() {
  try {
    const raw = execFileSync('git', ['show', `HEAD:${RELATIVE}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(raw);
  } catch {
    return { engine: ENGINE, sessions: [], summary: { resolvedSessions: 0 } };
  }
}

function memberFingerprint(member) {
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

function main() {
  const before = previousCommittedLedger();
  const after = read(CURRENT_PATH);
  const errors = [];
  if (after.engine !== ENGINE) errors.push({ code: 'ENGINE_MISMATCH', engine: after.engine || null });

  const beforeSessions = Array.isArray(before.sessions) ? before.sessions : [];
  const afterSessions = Array.isArray(after.sessions) ? after.sessions : [];
  const afterByDate = new Map(afterSessions.map(s => [String(s.signalDate || ''), s]));
  const seen = new Set();

  for (const session of afterSessions) {
    const signalDate = String(session.signalDate || '');
    if (!signalDate) errors.push({ code: 'SESSION_WITHOUT_SIGNAL_DATE' });
    if (seen.has(signalDate)) errors.push({ code: 'DUPLICATE_SIGNAL_DATE', signalDate });
    seen.add(signalDate);

    const members = Array.isArray(session.members) ? session.members : [];
    const allTerminal = members.length > 0 && members.every(m => TERMINAL.has(m.memberStatus));
    const waiting = members.filter(m => m.memberStatus === 'WAITING').length;
    if (session.status === 'RESOLVED') {
      if (!allTerminal) errors.push({ code: 'RESOLVED_SESSION_HAS_NONTERMINAL_MEMBER', signalDate, waiting });
      if (n(session.netReturnPct) === null) errors.push({ code: 'RESOLVED_SESSION_MISSING_NET_RETURN', signalDate });
      if (!['WIN', 'LOSS', 'FLAT'].includes(session.result)) errors.push({ code: 'RESOLVED_SESSION_INVALID_RESULT', signalDate, result: session.result || null });
    } else if (allTerminal) {
      errors.push({ code: 'PENDING_SESSION_FULLY_TERMINAL', signalDate });
    }
  }

  for (const oldSession of beforeSessions) {
    const signalDate = String(oldSession.signalDate || '');
    if (!signalDate) continue;
    const newSession = afterByDate.get(signalDate);
    if (!newSession) {
      errors.push({ code: 'PREVIOUS_SESSION_DISAPPEARED', signalDate });
      continue;
    }
    if (oldSession.status === 'RESOLVED' && newSession.status !== 'RESOLVED') {
      errors.push({ code: 'RESOLVED_SESSION_REGRESSED', signalDate, newStatus: newSession.status || null });
    }

    const newMembers = new Map((newSession.members || []).map(m => [norm(m.ticker), m]));
    for (const oldMember of oldSession.members || []) {
      if (!TERMINAL.has(oldMember.memberStatus)) continue;
      const ticker = norm(oldMember.ticker);
      const currentMember = newMembers.get(ticker);
      if (!currentMember) {
        errors.push({ code: 'TERMINAL_MEMBER_DISAPPEARED', signalDate, ticker });
        continue;
      }
      if (memberFingerprint(oldMember) !== memberFingerprint(currentMember)) {
        errors.push({
          code: 'TERMINAL_MEMBER_MUTATED',
          signalDate,
          ticker,
          beforeStatus: oldMember.memberStatus,
          afterStatus: currentMember.memberStatus,
          beforeReason: oldMember.reasonCode || null,
          afterReason: currentMember.reasonCode || null,
        });
      }
    }
  }

  const beforeResolved = n(before?.summary?.resolvedSessions) ?? beforeSessions.filter(s => s.status === 'RESOLVED').length;
  const afterResolved = n(after?.summary?.resolvedSessions) ?? afterSessions.filter(s => s.status === 'RESOLVED').length;
  if (afterResolved < beforeResolved) errors.push({ code: 'RESOLVED_COUNT_REGRESSED', beforeResolved, afterResolved });

  const newlyResolvedSignalDates = afterSessions
    .filter(s => s.status === 'RESOLVED' && !beforeSessions.some(b => b.signalDate === s.signalDate && b.status === 'RESOLVED'))
    .map(s => s.signalDate);

  const result = {
    status: errors.length ? 'FAIL' : 'PASS',
    engine: after.engine || null,
    resolvedSessionsBefore: beforeResolved,
    resolvedSessionsAfter: afterResolved,
    newlyResolvedSignalDates,
    pendingSignalDates: afterSessions.filter(s => s.status !== 'RESOLVED').map(s => s.signalDate),
    checks: {
      resolvedSessionsNeverRegress: !errors.some(e => ['RESOLVED_SESSION_REGRESSED', 'RESOLVED_COUNT_REGRESSED', 'PREVIOUS_SESSION_DISAPPEARED'].includes(e.code)),
      terminalOutcomesImmutable: !errors.some(e => ['TERMINAL_MEMBER_MUTATED', 'TERMINAL_MEMBER_DISAPPEARED'].includes(e.code)),
      newlyResolvedSessionsFullyTerminal: !errors.some(e => ['RESOLVED_SESSION_HAS_NONTERMINAL_MEMBER', 'RESOLVED_SESSION_MISSING_NET_RETURN', 'RESOLVED_SESSION_INVALID_RESULT'].includes(e.code)),
    },
    policy: {
      frozenV169Pilot: true,
      noSyntheticSessionIncrement: true,
      noAlphaOrRankingChange: true,
      noPublishedSignalMutation: true,
    },
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exit(2);
}

main();
