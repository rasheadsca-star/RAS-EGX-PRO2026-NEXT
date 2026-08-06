#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const ledgerPath = path.join(root, 'data/v17/ledger.json');
const historyDir = path.join(root, 'data/history');
const COST_PCT = 0.6;

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, filePath);
}

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nextSession(ticker, signalDate) {
  const history = readJson(path.join(historyDir, `${ticker}.json`), {});
  const sessions = Array.isArray(history.sessions) ? history.sessions : [];
  return sessions
    .filter(row => row.date > signalDate)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
}

const ledger = readJson(ledgerPath, {
  schemaVersion: '17.0.0-ledger',
  createdAt: new Date().toISOString(),
  entries: [],
});
if (!Array.isArray(ledger.entries)) ledger.entries = [];

let resolvedEntries = 0;
for (const entry of ledger.entries) {
  if (entry.outcome?.resolved === true) continue;
  const members = Array.isArray(entry.recommendations) ? entry.recommendations : [];
  const sessionRows = members.map(member => ({ member, session: nextSession(member.ticker, entry.sessionDate) }));
  if (!sessionRows.length || sessionRows.some(row => !row.session)) continue;

  const outcomes = sessionRows.map(({ member, session }) => {
    const open = finite(session.open);
    const high = finite(session.high);
    const low = finite(session.low);
    const close = finite(session.close);
    const executable = [open, high, low, close].every(Number.isFinite)
      && open >= finite(member.entryLow)
      && open <= finite(member.entryHigh);

    if (!executable) {
      return {
        ticker: member.ticker,
        outcomeDate: session.date,
        executable: false,
        state: 'NOT_ENTERED_OPEN_OUTSIDE_RANGE',
        open,
        high,
        low,
        close,
        netReturnPct: 0,
      };
    }

    const targetTouched = high >= finite(member.target);
    const stopTouched = low <= finite(member.stop);
    const ambiguousSameSession = targetTouched && stopTouched;
    let exitPrice = close;
    let state = 'CLOSED_AT_SESSION_END';

    if (ambiguousSameSession || stopTouched) {
      exitPrice = finite(member.stop);
      state = ambiguousSameSession ? 'AMBIGUOUS_TREATED_AS_STOP' : 'STOP_TOUCHED';
    } else if (targetTouched) {
      exitPrice = finite(member.target);
      state = 'TARGET_TOUCHED';
    }

    const grossReturnPct = ((exitPrice / open) - 1) * 100;
    const netReturnPct = grossReturnPct - COST_PCT;
    return {
      ticker: member.ticker,
      outcomeDate: session.date,
      executable: true,
      state,
      open,
      high,
      low,
      close,
      exitPrice,
      targetTouched,
      stopTouched,
      ambiguousSameSession,
      grossReturnPct: round(grossReturnPct),
      netReturnPct: round(netReturnPct),
    };
  });

  const basketSleeveReturnPct = outcomes.reduce((sum, outcome, index) => {
    const weight = finite(members[index]?.basketWeightPct, 0) / 100;
    return sum + weight * finite(outcome.netReturnPct, 0);
  }, 0);
  const totalPortfolioReturnPct = outcomes.reduce((sum, outcome, index) => {
    const weight = finite(members[index]?.portfolioWeightPct, 0) / 100;
    return sum + weight * finite(outcome.netReturnPct, 0);
  }, 0);

  entry.outcome = {
    resolved: true,
    resolvedAt: new Date().toISOString(),
    outcomeDate: outcomes[0]?.outcomeDate || null,
    transactionCostPct: COST_PCT,
    conservativeAmbiguityPolicy: true,
    members: outcomes,
    executableMembers: outcomes.filter(row => row.executable).length,
    targetHits: outcomes.filter(row => row.state === 'TARGET_TOUCHED').length,
    stopOutcomes: outcomes.filter(row => ['STOP_TOUCHED', 'AMBIGUOUS_TREATED_AS_STOP'].includes(row.state)).length,
    basketSleeveReturnPct: round(basketSleeveReturnPct),
    totalPortfolioReturnPct: round(totalPortfolioReturnPct),
  };
  entry.status = 'RESOLVED';
  resolvedEntries += 1;
}

ledger.updatedAt = new Date().toISOString();
writeJsonAtomic(ledgerPath, ledger);
console.log(JSON.stringify({ ledgerEntries: ledger.entries.length, resolvedEntries }, null, 2));
