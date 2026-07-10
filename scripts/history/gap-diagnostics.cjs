#!/usr/bin/env node
'use strict';

const path = require('path');
const { inspectYahooCandidate } = require('./adapters/yahoo-gap-diagnostic-adapter.cjs');
const {
  nowIso,
  readJson,
  safeTicker,
  sleep,
  unique,
  writeJsonAtomic,
} = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA, 'history-gap-diagnostics-config.json');
const MAP_PATH = path.join(DATA, 'symbol-map.json');
const GAP_REPORT_PATH = path.join(DATA, 'history-gap-completion-report.json');
const SUMMARY_PATH = path.join(DATA, 'history-summary.json');
const REPORT_PATH = path.join(DATA, 'history-gap-diagnostics-report.json');
const QUEUE_PATH = path.join(DATA, 'history-approved-gap-queue.json');
const LIVE = String(process.env.GAP_LIVE_YAHOO_DIAGNOSTICS || 'true').toLowerCase() === 'true';
const ONLY_TICKER = safeTicker(process.env.GAP_DIAGNOSTIC_TICKER || '');
const DELAY_MS = Math.max(0, Number(process.env.GAP_DIAGNOSTIC_DELAY_MS || 500));

function normalizeMap(raw) {
  const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
  const result = new Map();
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const ticker = safeTicker(item.ticker);
    if (ticker) result.set(ticker, { ...item, ticker });
  }
  return result;
}

function historyDocument(ticker) {
  return readJson(path.join(DATA, 'history', `${ticker}.json`), null);
}

function classifyFromPrior(result, document) {
  const error = String(result?.error || '');
  if ((document?.sessions?.length || 0) >= 100 && document?.staleData) return 'stale_complete_100';
  if (/identity evidence failed/i.test(error)) return 'identity_evidence_failed';
  if (/seed overlap failed \(0\/0\)/i.test(error)) return 'no_overlap';
  if (/HTTP 404/i.test(error)) return 'yahoo_http_404';
  if (/rate limit|429/i.test(error)) return 'yahoo_rate_limited';
  return 'approved_import_required';
}

function classifyAttempts(attempts, fallbackClass) {
  if (!attempts.length) return fallbackClass;
  const responses = attempts.filter((item) => item.status === 'response_received');
  if (responses.some((item) => item.identity?.exactSymbol && item.identity?.exchangeConfirmed && item.identity?.currencyAcceptable && item.overlap?.verified)) {
    return 'yahoo_continuity_possible_manual_review';
  }
  if (responses.some((item) => item.identity && (!item.identity.exactSymbol || !item.identity.exchangeConfirmed || !item.identity.currencyAcceptable))) {
    return 'identity_evidence_failed';
  }
  if (responses.some((item) => item.overlap?.overlapRows === 0)) return 'no_overlap';
  if (attempts.every((item) => item.failureClass === 'yahoo_http_404')) return 'yahoo_http_404';
  if (attempts.some((item) => item.failureClass === 'yahoo_rate_limited')) return 'yahoo_rate_limited';
  return fallbackClass;
}

function requiredFromDate(document) {
  return document?.lastSession || document?.sessions?.at(-1)?.date || null;
}

function acceptedSources(config) {
  return Array.isArray(config.acceptedImportSources) ? config.acceptedImportSources : [
    'egx_official', 'mubasher', 'investing', 'approved_csv',
  ];
}

async function main() {
  const startedAt = nowIso();
  const config = readJson(CONFIG_PATH, {});
  const map = normalizeMap(readJson(MAP_PATH, {}));
  const gapReport = readJson(GAP_REPORT_PATH, { results: [] });
  const summary = readJson(SUMMARY_PATH, {});
  let priorResults = Array.isArray(gapReport.results) ? gapReport.results : [];
  if (ONLY_TICKER) priorResults = priorResults.filter((item) => safeTicker(item.ticker) === ONLY_TICKER);

  const results = [];
  for (const prior of priorResults) {
    const ticker = safeTicker(prior.ticker);
    const entry = map.get(ticker);
    const document = historyDocument(ticker);
    if (!ticker || !entry || !document) {
      results.push({
        ticker,
        status: 'missing_repository_context',
        classification: 'manual_review_required',
        error: !entry ? 'symbol_map_entry_missing' : 'history_document_missing',
        attempts: [],
      });
      continue;
    }

    const baseClass = classifyFromPrior(prior, document);
    let attempts = [];
    let liveError = null;
    if (LIVE) {
      try {
        attempts = await inspectYahooCandidate(entry, document, config);
      } catch (error) {
        liveError = error.message;
      }
    }
    const classification = classifyAttempts(attempts, baseClass);
    const needsApprovedImport = !['yahoo_continuity_possible_manual_review'].includes(classification);
    results.push({
      ticker,
      companyNameAr: entry.companyNameAr || null,
      companyNameEn: entry.companyNameEn || null,
      isin: entry.isin || null,
      status: 'diagnosed',
      classification,
      needsApprovedImport,
      beforeSessions: Array.isArray(document.sessions) ? document.sessions.length : 0,
      firstSession: document.firstSession || document.sessions?.[0]?.date || null,
      lastSession: requiredFromDate(document),
      staleData: Boolean(document.staleData),
      priorError: prior.error || null,
      liveDiagnosticsEnabled: LIVE,
      liveError,
      attempts,
    });
    if (DELAY_MS) await sleep(DELAY_MS);
  }

  const completedAt = nowIso();
  const counts = {
    total: results.length,
    staleComplete100: results.filter((item) => item.classification === 'stale_complete_100').length,
    identityEvidenceFailed: results.filter((item) => item.classification === 'identity_evidence_failed').length,
    noOverlap: results.filter((item) => item.classification === 'no_overlap').length,
    yahoo404: results.filter((item) => item.classification === 'yahoo_http_404').length,
    yahooRateLimited: results.filter((item) => item.classification === 'yahoo_rate_limited').length,
    continuityPossibleManualReview: results.filter((item) => item.classification === 'yahoo_continuity_possible_manual_review').length,
    approvedImportRequired: results.filter((item) => item.needsApprovedImport).length,
  };

  const report = {
    schemaVersion: '12.8.0',
    startedAt,
    completedAt,
    mode: 'gap_diagnostics',
    latestMarketSession: summary.latestMarketSession || gapReport.latestMarketSession || null,
    liveYahooDiagnostics: LIVE,
    counts,
    results,
    warnings: [
      'Diagnostics never modify stored history files.',
      'Yahoo metadata is evidence only and does not constitute independent verification.',
      'Approved imports require a recognized source, URL or file reference, admin identity approval, and valid OHLCV rows.',
    ],
  };

  const queue = {
    schemaVersion: '12.8.0',
    generatedAt: completedAt,
    targetLatestMarketSession: report.latestMarketSession,
    acceptedSources: acceptedSources(config),
    total: results.filter((item) => item.needsApprovedImport).length,
    items: results.filter((item) => item.needsApprovedImport).map((item) => ({
      ticker: item.ticker,
      companyNameAr: item.companyNameAr,
      companyNameEn: item.companyNameEn,
      isin: item.isin,
      beforeSessions: item.beforeSessions,
      lastSession: item.lastSession,
      requiredAfterDate: item.lastSession,
      targetLatestMarketSession: report.latestMarketSession,
      reason: item.classification,
      approvedImportStatus: 'waiting_for_reviewed_data',
      acceptedSources: acceptedSources(config),
    })),
  };

  writeJsonAtomic(REPORT_PATH, report);
  writeJsonAtomic(QUEUE_PATH, queue);
  console.log(`V12.8 diagnostics complete: ${counts.total} symbols, ${counts.approvedImportRequired} require approved import.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
