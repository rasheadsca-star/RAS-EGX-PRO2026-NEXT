#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('../data-health/g11-data-health.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => { try { return JSON.parse(fs.readFileSync(R(p), 'utf8')); } catch { return d; } };
const write = (p, v) => { fs.mkdirSync(path.dirname(R(p)), { recursive: true }); fs.writeFileSync(R(p), JSON.stringify(v, null, 2) + '\n', 'utf8'); };
const norm = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');

const index = read('data/quant/stock-intelligence-index.json', {});
const policy = read('data/v13-7-native-policy.json', {});
const symbolRaw = read('data/symbol-map.json', {});
const symbolRows = Array.isArray(symbolRaw) ? symbolRaw : Object.entries(symbolRaw || {}).map(([ticker, value]) => ({ ...(value || {}), ticker: value?.ticker || ticker }));
const symbolBy = new Map(symbolRows.map((x) => [norm(x.ticker), x]));
const minimumSessions = Number(policy?.history?.minimumSessions || 20);
const expectedSession = H.expectedSession(new Date().toISOString(), read('data/v13-3-daily-production-policy.json', {}));

const records = (index.failures || []).map((failure) => {
  const ticker = norm(failure.ticker);
  const doc = read(`data/history/${ticker}.json`, {});
  const parsed = H.parseHistory(doc || {});
  const validSessions = parsed.validated.length;
  const latestValidSession = parsed.validated.at(-1)?.date || null;
  const currentSessionAvailable = parsed.validated.some((x) => x.date === expectedSession);
  const symbol = symbolBy.get(ticker) || {};
  const explicitInsufficientHistory = String(failure.reason || '') === 'insufficient_history' && validSessions < minimumSessions;
  const classification = explicitInsufficientHistory ? 'DIAGNOSED_UNAVAILABLE_INSUFFICIENT_HISTORY' : 'UNEXPLAINED_DERIVED_BUILD_FAILURE';
  return {
    ticker,
    securityId: `EGX:${ticker}`,
    active: symbol.active !== false,
    failedComponent: 'V13_7_STOCK_INTELLIGENCE',
    originalDiagnostic: failure.reason || 'UNKNOWN',
    classification,
    explained: explicitInsufficientHistory,
    inputState: {
      expectedSession,
      currentSessionAvailable,
      validHistorySessions: validSessions,
      requiredMinimumSessions: minimumSessions,
      latestValidSession,
      symbolVerified: doc?.symbolVerified === true,
      sourceStatus: doc?.historyStatus || null,
    },
    rootCause: explicitInsufficientHistory
      ? `Only ${validSessions} validation-approved sessions are available; V13.7 requires at least ${minimumSessions}.`
      : 'The derived builder failed despite inputs not proving the documented insufficient-history condition; implementation/root-cause repair is required.',
    productionImpact: symbol.active === false
      ? 'NONE_INACTIVE_SECURITY'
      : 'STOCK_INTELLIGENCE_DERIVATION_UNAVAILABLE; production/regime readiness remains governed separately by canonical G11 strategy-readiness checks and must not infer values.',
    evidence: [`data/history/${ticker}.json`, 'data/quant/stock-intelligence-index.json', 'scripts/quant/v13-7-stock-intelligence.cjs'],
  };
});

const explained = records.filter((x) => x.explained).length;
const unexplained = records.length - explained;
const artifact = {
  schemaVersion: 'astra-g11-derived-build-failures-1',
  generatedAt: new Date().toISOString(),
  expectedSession,
  component: 'V13_7_STOCK_INTELLIGENCE',
  stockIntelligenceRecordsBuilt: Number(index?.counts?.stocksBuilt || 0),
  totalBuildFailures: records.length,
  diagnosedUnavailable: explained,
  unexplainedBuildFailures: unexplained,
  accountingCloses: explained + unexplained === records.length,
  records,
};
write('docs/astra/G11_DERIVED_BUILD_FAILURES.json', artifact);
console.log('ASTRA_G11_DERIVED_BUILD_FAILURES ' + JSON.stringify({ built: artifact.stockIntelligenceRecordsBuilt, total: records.length, diagnosed: explained, unexplained }));
