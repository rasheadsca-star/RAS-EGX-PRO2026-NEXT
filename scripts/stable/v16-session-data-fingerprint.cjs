#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const HISTORY_DIR = path.join(ROOT, 'data/history');
const PRICE_TRUTH_PATH = path.join(ROOT, 'data/stable/v15-price-truth.json');

const dateOnly = value => (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const numberOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function fingerprintSession(sessionDate) {
  const expectedSession = dateOnly(sessionDate);
  if (!expectedSession || !fs.existsSync(HISTORY_DIR)) {
    return { sessionDate: expectedSession, hash: null, rows: 0, tickers: [] };
  }

  const records = [];
  for (const name of fs.readdirSync(HISTORY_DIR).filter(file => file.endsWith('.json')).sort()) {
    const document = readJson(path.join(HISTORY_DIR, name), {});
    const ticker = String(document?.ticker || path.basename(name, '.json')).trim().toUpperCase();
    const sessions = Array.isArray(document?.sessions) ? document.sessions : [];
    const row = sessions.find(item => (
      dateOnly(item?.date || item?.sessionDate) === expectedSession
      && dateOnly(item?.sourceSessionDate) === expectedSession
      && String(item?.validationStatus || '') === 'precise_public_source_session_confirmed'
    ));
    if (!row) continue;

    records.push([
      ticker,
      expectedSession,
      numberOrNull(row.open),
      numberOrNull(row.high),
      numberOrNull(row.low),
      numberOrNull(row.close),
      numberOrNull(row.volume),
      String(row.primarySource || row.source || ''),
      String(row.sourceSessionEvidence || ''),
    ]);
  }

  records.sort((a, b) => a[0].localeCompare(b[0]));
  const canonical = JSON.stringify(records);
  const hash = records.length
    ? crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')
    : null;

  return {
    sessionDate: expectedSession,
    hash,
    rows: records.length,
    tickers: records.map(row => row[0]),
  };
}

function main() {
  const priceTruth = readJson(PRICE_TRUTH_PATH, {});
  const requested = process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  const sessionDate = requested || priceTruth?.expectedSession || null;
  const result = fingerprintSession(sessionDate);
  const minimumRows = Number(priceTruth?.minimumExecutionRows || process.env.EGX_MIN_EXECUTION_ROWS || 80);
  const output = {
    ...result,
    minimumRows,
    priceTruthReady: priceTruth?.ready === true,
    executionGrade: priceTruth?.executionGrade === true,
    sufficientRows: result.rows >= minimumRows,
  };

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, [
      `session_date=${output.sessionDate || ''}`,
      `session_data_hash=${output.hash || ''}`,
      `session_data_rows=${output.rows}`,
      `minimum_rows=${minimumRows}`,
      `price_truth_ready=${output.priceTruthReady ? 'true' : 'false'}`,
      `execution_grade=${output.executionGrade ? 'true' : 'false'}`,
      `sufficient_rows=${output.sufficientRows ? 'true' : 'false'}`,
      '',
    ].join('\n'), 'utf8');
  }

  console.log(JSON.stringify(output, null, 2));
}

module.exports = { fingerprintSession };

if (require.main === module) main();
