#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const HISTORY = path.join(DATA, 'history');
const POLICY_FILE = path.join(DATA, 'v13-10-tiered-confidence-policy.json');
const OUTPUT = path.join(DATA, 'quant', 'freshness-coverage-v13-10.json');

function readJson(file, required = false) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (required) throw new Error(`Missing or invalid ${path.relative(ROOT, file)}: ${error.message}`);
    return null;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
function mapEntries(raw) {
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw || {}).map(([ticker, value]) => ({ ...(value || {}), ticker: value?.ticker || ticker }));
}
function historyRows(doc) {
  const raw = Array.isArray(doc) ? doc : Array.isArray(doc?.sessions) ? doc.sessions : [];
  return raw
    .map(row => ({ ...row, date: dateOnly(row.date || row.sessionDate || row.session) }))
    .filter(row => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function tradingLag(fromDate, toDate) {
  if (!fromDate || !toDate || fromDate >= toDate) return fromDate === toDate ? 0 : null;
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  let lag = 0;
  for (let cursor = new Date(start); cursor < end;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if ([0, 1, 2, 3, 4].includes(day)) lag += 1;
  }
  return lag;
}
function buildReport(policy, refreshRuns = []) {
  const summary = readJson(path.join(DATA, 'history-summary.json'), {}) || {};
  const map = mapEntries(readJson(path.join(DATA, 'symbol-map.json'), {}) || {})
    .map(item => ({ ...item, ticker: safeTicker(item.ticker) }))
    .filter(item => item.ticker && item.active !== false);
  const minimumSessions = Number(policy.freshness.minimumDecisionSessions || 50);
  const histories = [];
  const allDates = [];

  for (const item of map) {
    const file = path.join(HISTORY, `${item.ticker}.json`);
    const doc = readJson(file, null);
    const rows = doc ? historyRows(doc) : [];
    const lastSession = rows.at(-1)?.date || null;
    if (lastSession) allDates.push(lastSession);
    histories.push({
      ticker: item.ticker,
      sessions: rows.length,
      lastSession,
      symbolVerified: doc?.symbolVerified === true,
      staleData: doc?.staleData === true,
      updateFailed: doc?.updateFailed === true,
      averageConfidence: Number(doc?.averageConfidence || 0)
    });
  }

  const latestSession = dateOnly(summary.latestMarketSession) || allDates.sort().at(-1) || null;
  const decisionHistories = histories.filter(item =>
    item.sessions >= minimumSessions &&
    item.symbolVerified &&
    !item.staleData &&
    !item.updateFailed
  );

  const rows = decisionHistories.map(item => ({
    ...item,
    tradingLag: tradingLag(item.lastSession, latestSession)
  }));
  const exactFresh = rows.filter(item => item.tradingLag === 0);
  const lag1 = rows.filter(item => item.tradingLag === 1);
  const lag2Plus = rows.filter(item => Number(item.tradingLag) >= 2);
  const unknownLag = rows.filter(item => item.tradingLag === null);
  const exactFreshCoveragePct = rows.length ? (exactFresh.length / rows.length) * 100 : 0;

  return {
    schemaVersion: '13.10.0',
    generatedAt: new Date().toISOString(),
    latestMarketSession: latestSession,
    refreshAttempted: refreshRuns.length > 0,
    refreshRuns,
    counts: {
      mappedActiveSymbols: map.length,
      historiesAvailable: histories.filter(item => item.sessions > 0).length,
      decisionHistories: rows.length,
      exactFresh: exactFresh.length,
      lagOneTradingDay: lag1.length,
      lagTwoOrMoreTradingDays: lag2Plus.length,
      unknownLag: unknownLag.length
    },
    exactFreshCoveragePct: Number(exactFreshCoveragePct.toFixed(2)),
    minimumTargetPct: Number(policy.freshness.minimumExactFreshCoveragePct || 80),
    targetPassed: exactFreshCoveragePct >= Number(policy.freshness.minimumExactFreshCoveragePct || 80),
    neverUseLaggedHistoryForNewSignals: true,
    laggingSymbols: [...lag1, ...lag2Plus, ...unknownLag]
      .sort((a, b) => Number(b.tradingLag || 999) - Number(a.tradingLag || 999) || a.ticker.localeCompare(b.ticker))
      .slice(0, 250),
    exactFreshTickers: exactFresh.map(item => item.ticker).sort()
  };
}

function runFullRefresh(policy) {
  const skip = String(process.env.V13_10_SKIP_FETCH || 'false').toLowerCase() === 'true';
  if (skip) return [];

  const runner = path.join(ROOT, 'scripts', 'history', 'historical-100-runner.cjs');
  if (!fs.existsSync(runner)) {
    throw new Error('Missing scripts/history/historical-100-runner.cjs. Install the V12.3 history engine first.');
  }

  const symbolMap = mapEntries(readJson(path.join(DATA, 'symbol-map.json'), {}) || {})
    .filter(item => safeTicker(item.ticker) && item.active !== false);
  const batchSize = Math.max(1, Math.min(25, Number(policy.freshness.batchSize || 25)));
  const totalBatches = Math.max(1, Math.ceil(symbolMap.length / batchSize));
  const refreshRuns = [];

  for (let batch = 1; batch <= totalBatches; batch += 1) {
    console.log(`V13.10 full-market refresh batch ${batch}/${totalBatches}`);
    const result = spawnSync(process.execPath, [runner], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        HISTORY_MODE: 'incremental_batch',
        HISTORY_BATCH_NUMBER: String(batch),
        HISTORY_BATCH_SIZE: String(batchSize),
        HISTORY_REQUEST_CONCURRENCY: String(policy.freshness.requestConcurrency || 2),
        HISTORY_BATCH_DELAY_MS: String(policy.freshness.batchDelayMs || 1600),
        HISTORY_SYMBOL_DELAY_MS: String(policy.freshness.symbolDelayMs || 700),
        HISTORY_FORCE_REFRESH: 'true'
      }
    });
    refreshRuns.push({
      batch,
      totalBatches,
      exitCode: result.status === null ? 1 : result.status,
      succeeded: result.status === 0
    });
    if (result.status !== 0) {
      console.warn(`Batch ${batch} failed; continuing so coverage can be measured safely.`);
    }
  }
  return refreshRuns;
}

function main() {
  const policy = readJson(POLICY_FILE, true);
  if (!fs.existsSync(HISTORY)) throw new Error('Missing data/history');
  const refreshRuns = runFullRefresh(policy);
  const report = buildReport(policy, refreshRuns);
  writeJson(OUTPUT, report);
  console.log(`V13.10 exact freshness: ${report.counts.exactFresh}/${report.counts.decisionHistories} (${report.exactFreshCoveragePct}%)`);
  if (!report.targetPassed) {
    console.warn(`Freshness target not reached. Lagged symbols remain blocked from new signals.`);
  }
}

try { main(); }
catch (error) {
  console.error(`V13.10 freshness failed: ${error.stack || error.message}`);
  process.exit(1);
}
