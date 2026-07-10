#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateSession } = require('./history-validator.cjs');
const { readJson, safeTicker } = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const MODE = String(process.env.GAP_V128_MODE || 'diagnose_and_import');
const MIN_IMPORTED = Math.max(0, Number(process.env.GAP_MIN_IMPORTED || 0));

function fail(message) {
  console.error(`V12.8 acceptance failed: ${message}`);
  process.exitCode = 1;
}

function validateHistoryFile(ticker) {
  const file = path.join(DATA, 'history', `${ticker}.json`);
  const document = readJson(file, null);
  if (!document || !Array.isArray(document.sessions) || !document.sessions.length) {
    throw new Error(`${ticker}: history file missing or empty`);
  }
  if (document.sessions.length > 100) throw new Error(`${ticker}: more than 100 stored sessions`);
  let previous = null;
  const seen = new Set();
  for (const session of document.sessions) {
    const result = validateSession(session);
    if (!result.valid) throw new Error(`${ticker} ${session.date}: ${result.errors.join(',')}`);
    if (seen.has(session.date)) throw new Error(`${ticker}: duplicate date ${session.date}`);
    if (previous && session.date <= previous) throw new Error(`${ticker}: sessions are not strictly ascending`);
    seen.add(session.date);
    previous = session.date;
  }
}

try {
  if (MODE !== 'import_approved') {
    const diagnostics = readJson(path.join(DATA, 'history-gap-diagnostics-report.json'), null);
    const queue = readJson(path.join(DATA, 'history-approved-gap-queue.json'), null);
    if (!diagnostics || diagnostics.schemaVersion !== '12.8.0') throw new Error('diagnostics report missing or invalid');
    if (!queue || !Array.isArray(queue.items)) throw new Error('approved gap queue missing or invalid');
    if (Number(diagnostics.counts?.total || 0) !== (diagnostics.results || []).length) throw new Error('diagnostics count mismatch');
  }

  if (MODE !== 'diagnose') {
    const report = readJson(path.join(DATA, 'history-approved-gap-import-report.json'), null);
    const quarantine = readJson(path.join(DATA, 'history-approved-gap-quarantine.json'), null);
    if (!report || report.schemaVersion !== '12.8.0') throw new Error('approved import report missing or invalid');
    if (!quarantine || !Array.isArray(quarantine.rows)) throw new Error('approved import quarantine missing or invalid');
    const imported = (report.results || []).filter((item) => item.status === 'imported');
    if (imported.length < MIN_IMPORTED) throw new Error(`only ${imported.length} imported; minimum required is ${MIN_IMPORTED}`);
    for (const item of imported) validateHistoryFile(safeTicker(item.ticker));
    if (Number(report.counts?.rowsQuarantined || 0) !== quarantine.rows.length) throw new Error('quarantine count mismatch');
  }

  for (const protectedPath of ['index.html', 'service-worker.js']) {
    if (!fs.existsSync(path.join(ROOT, protectedPath))) continue;
  }
  console.log(`V12.8 acceptance passed for mode=${MODE}.`);
} catch (error) {
  fail(error.message);
}
