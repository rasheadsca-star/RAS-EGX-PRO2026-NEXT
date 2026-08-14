#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchHistory } = require('../history/adapters/yahoo-history-adapter.cjs');
const { sanitizeSessions } = require('./build-trusted-technical-history.cjs');
const {
  finite, round, researchPlanEligibility, buildConsensusCalendar,
  evaluateLongPlan, aggregateAppliedPortfolio, aggregateResearch,
} = require('./forward-evaluation-core.cjs');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const NETWORK_REFRESH = String(process.env.V20_FORWARD_NETWORK_REFRESH || 'true').toLowerCase() !== 'false';
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.V20_FORWARD_CONCURRENCY || 6)));
const RANGE = process.env.V20_FORWARD_FETCH_RANGE || '3mo';
const CALENDAR_CONSENSUS_PCT = Number(process.env.V20_FORWARD_CALENDAR_CONSENSUS_PCT || 50);
const CALENDAR_MIN_VOTES = Math.max(1, Number(process.env.V20_FORWARD_CALENDAR_MIN_VOTES || 5));
const COST_PCT = Number(process.env.V20_FORWARD_TRANSACTION_COST_PCT || 0.6);

function read(rel, fallback = null) { try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; } }
function write(rel, value) {
  const file = P(rel); fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.renameSync(tmp, file);
}
function safeTicker(value) { return String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9_-]/g, ''); }
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function loadSymbolMap() {
  const raw = read('data/symbol-map.json', []);
  const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
  return new Map(entries.map(entry => [safeTicker(entry.ticker), entry]).filter(([ticker]) => ticker));
}
function cachedDocument(ticker) { return read(`data/history/${ticker}.json`, null); }
function issuedMap(archive) {
  return new Map((archive?.issuedSnapshot?.opportunities || []).map(row => [safeTicker(row.ticker), row]));
}
async function mapPool(items, worker, concurrency) {
  const results = Array(items.length); let cursor = 0;
  async function run() { while (true) { const index = cursor++; if (index >= items.length) return; results[index] = await worker(items[index], index); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, run));
  return results;
}

async function loadHistory(ticker, mapEntry, currentRow, asOfDate) {
  const attempts = [];
  let document = null; let sourceKind = null;
  if (NETWORK_REFRESH && mapEntry) {
    try {
      const fetched = await fetchHistory(mapEntry, {
        range: RANGE, timeoutMs: 7000, maxAttempts: 1, backoffMs: 200,
        localReference: finite(currentRow?.price) > 0 ? { close: finite(currentRow.price) } : undefined,
      });
      document = { symbolVerified: fetched.identity?.verified === true, symbolVerification: fetched.identity || null, primarySource: 'yahoo', sessions: fetched.sessions || [] };
      sourceKind = 'LIVE_YAHOO_REFRESH';
      attempts.push({ source: 'yahoo_live', ok: true, sessions: fetched.sessions?.length || 0 });
    } catch (error) { attempts.push({ source: 'yahoo_live', ok: false, error: error.message }); }
  }
  if (!document) {
    const cached = cachedDocument(ticker);
    if (cached) { document = cached; sourceKind = 'CACHED_VERIFIED_HISTORY_DOCUMENT'; attempts.push({ source: 'cached_history_document', ok: true, sessions: cached.sessions?.length || 0 }); }
  }
  if (!document) return { ticker, ok: false, sourceKind: null, attempts, rows: [], blockers: ['NO_ACCEPTABLE_HISTORY_DOCUMENT'] };
  if (document.symbolVerified !== true) return { ticker, ok: false, sourceKind, attempts, rows: [], blockers: ['SYMBOL_IDENTITY_NOT_VERIFIED'] };
  const sanitized = sanitizeSessions(document.sessions, ticker, asOfDate);
  return {
    ticker, ok: sanitized.rows.length > 0, sourceKind, source: document.primarySource || null,
    attempts, rows: sanitized.rows, rejectedCount: sanitized.rejected.length,
    futureRowsRejected: sanitized.rejected.filter(row => (row.errors || []).includes('FUTURE_ROW_AFTER_AS_OF')).length,
    blockers: sanitized.rows.length ? [] : ['NO_TRUSTED_ROWS_AT_OR_BEFORE_AS_OF'],
  };
}

function archiveFor(indexEntry) {
  const archive = read(indexEntry.file, null);
  if (!archive) throw new Error(`Archive missing: ${indexEntry.file}`);
  if (archive.immutableSignalHash !== indexEntry.immutableSignalHash) throw new Error(`Archive hash/index mismatch: ${indexEntry.file}`);
  if (sha(archive.immutableCore) !== archive.immutableSignalHash) throw new Error(`Immutable core hash drift: ${indexEntry.file}`);
  return archive;
}

async function main() {
  const current = read('data/v20/current.json', {});
  const snapshot = read('data/v20/current-market-snapshot.json', { rows: [] });
  const policy = read('data/v20/policy-registry.json', {});
  const index = read('data/v20/signal-archive/index.json', { entries: [] });
  const forward = read('data/v20/forward-evaluation.json', { horizonsSessions: [1,3,5,10,20], evaluations: [] });
  const asOfDate = String(current.sessionDate || snapshot.sessionDate || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error('Current V20 session date required for forward resolution');
  if (snapshot.sessionDate && snapshot.sessionDate !== asOfDate) throw new Error('Current snapshot session mismatch');
  if (finite(policy.transactionCosts?.roundTripPct) !== null && finite(policy.transactionCosts.roundTripPct) !== COST_PCT) throw new Error('Forward resolver transaction cost does not match V20 central policy');

  const entries = Array.isArray(index.entries) ? index.entries : [];
  const archives = new Map(entries.map(entry => [entry.immutableSignalHash, archiveFor(entry)]));
  const pendingHashes = new Set((forward.evaluations || []).filter(row => row.status !== 'RESOLVED').map(row => row.immutableSignalHash));
  const neededTickers = [...new Set([...pendingHashes].flatMap(hash => (archives.get(hash)?.immutableCore?.opportunities || []).map(row => safeTicker(row.ticker))).filter(Boolean))];
  const symbolMap = loadSymbolMap();
  const currentMap = new Map((snapshot.rows || []).map(row => [safeTicker(row.ticker), row]));
  const historyResults = await mapPool(neededTickers, ticker => loadHistory(ticker, symbolMap.get(ticker), currentMap.get(ticker), asOfDate), CONCURRENCY);
  const historyByTicker = Object.fromEntries(historyResults.filter(row => row.ok).map(row => [row.ticker, row.rows]));

  const calendarsBySignalDate = new Map();
  for (const archive of archives.values()) {
    const signalDate = archive.sessionDate;
    if (!calendarsBySignalDate.has(signalDate)) {
      calendarsBySignalDate.set(signalDate, buildConsensusCalendar(historyByTicker, signalDate, asOfDate, {
        consensusPct: CALENDAR_CONSENSUS_PCT, minimumVotes: CALENDAR_MIN_VOTES,
      }));
    }
  }

  const evaluations = [];
  for (const existing of forward.evaluations || []) {
    const archive = archives.get(existing.immutableSignalHash);
    if (!archive) { evaluations.push({ ...existing, resolutionAttempt: { attemptedAt: new Date().toISOString(), asOfSessionDate: asOfDate, state: 'ARCHIVE_NOT_FOUND' } }); continue; }
    const horizon = Number(existing.horizonSessions);
    const calendar = calendarsBySignalDate.get(archive.sessionDate);
    const sessions = calendar?.acceptedSessions || [];
    const evaluationDate = sessions.length >= horizon ? sessions[horizon - 1] : null;

    if (!evaluationDate) {
      evaluations.push({
        ...existing,
        status: 'PENDING', evaluationSessionDate: null,
        portfolioReturnGrossPct: null, portfolioReturnNetPct: null,
        resolvedPositionCount: 0, ambiguousPositionCount: 0,
        appliedPortfolio: { status: 'PENDING_HORIZON_SESSION_NOT_AVAILABLE', appliedExposurePct: finite(archive.immutableCore?.portfolio?.recommendedExposurePct) ?? 0, grossReturnPct: null, netReturnPct: null },
        researchEvaluation: { status: 'PENDING_HORIZON_SESSION_NOT_AVAILABLE', candidateCount: null, resolvedCount: 0, equalWeightIssuedGrossReturnPct: null, equalWeightIssuedNetReturnPct: null, decisionUse: 'RESEARCH_DIAGNOSTIC_ONLY_NOT_PRODUCTION_PERFORMANCE', appliedToProduction: false },
        resolutionAttempt: { attemptedAt: new Date().toISOString(), asOfSessionDate: asOfDate, state: 'WAITING_FOR_MARKET_SESSIONS', acceptedFutureSessionCount: sessions.length, requiredHorizonSessions: horizon, calendarRequiredVotes: calendar?.requiredVotes ?? null, calendarHistoryCount: calendar?.historyCount ?? 0 },
        note: 'Horizon remains pending until enough trusted consensus market sessions exist after signal issuance. No return is inferred from weekends or calendar assumptions.',
      });
      continue;
    }

    const issued = issuedMap(archive);
    const memberOutcomes = [];
    let candidateCount = 0;
    for (const coreRow of archive.immutableCore?.opportunities || []) {
      const ticker = safeTicker(coreRow.ticker);
      const issuedRow = issued.get(ticker) || null;
      const eligibility = researchPlanEligibility(coreRow, issuedRow);
      if (eligibility.eligible) candidateCount += 1;
      const rows = historyByTicker[ticker] || [];
      const outcome = eligibility.eligible
        ? evaluateLongPlan(eligibility.plan, rows, sessions, horizon, COST_PCT)
        : { resolved: true, entered: false, state: 'EXCLUDED_FROM_RESEARCH_EVALUATION', exclusionReasons: eligibility.reasons, grossReturnPct: null, netReturnPct: null, ambiguous: false };
      memberOutcomes.push({ ticker, researchEligible: eligibility.eligible, issuedStatus: eligibility.status, exclusionReasons: eligibility.reasons, outcome });
    }

    const research = aggregateResearch(memberOutcomes, candidateCount);
    const applied = aggregateAppliedPortfolio(archive.immutableCore, memberOutcomes);
    const fullyResolved = research.resolved === true && applied.resolved === true;
    evaluations.push({
      ...existing,
      schemaVersion: '20.0.0-forward-evaluation-entry-2',
      status: fullyResolved ? 'RESOLVED' : 'PENDING',
      evaluationSessionDate: fullyResolved ? evaluationDate : null,
      portfolioReturnGrossPct: fullyResolved ? applied.grossReturnPct : null,
      portfolioReturnNetPct: fullyResolved ? applied.netReturnPct : null,
      resolvedPositionCount: fullyResolved ? (applied.appliedPositionCount || 0) : 0,
      ambiguousPositionCount: fullyResolved ? (research.ambiguousCount || 0) : 0,
      appliedPortfolio: applied,
      researchEvaluation: { ...research, members: memberOutcomes },
      resolutionAttempt: {
        attemptedAt: new Date().toISOString(), asOfSessionDate: asOfDate,
        state: fullyResolved ? 'RESOLVED_FROM_TRUSTED_SESSION_PATH' : 'PENDING_MEMBER_DATA',
        evaluationSessionDate: evaluationDate,
        acceptedFutureSessionCount: sessions.length,
        requiredHorizonSessions: horizon,
        calendarRequiredVotes: calendar?.requiredVotes ?? null,
        calendarHistoryCount: calendar?.historyCount ?? 0,
      },
      note: fullyResolved
        ? 'Applied portfolio performance and research opportunity outcomes are resolved separately. Research outcomes never become production performance.'
        : 'Horizon date exists, but at least one required research/applied member path lacks trusted OHLC. Return remains null until complete.',
    });
  }

  const out = {
    schemaVersion: '20.0.0-forward-evaluation-2',
    horizonsSessions: [1,3,5,10,20],
    updatedAt: new Date().toISOString(),
    asOfSessionDate: asOfDate,
    resolutionPolicy: {
      immutableSignalArchiveMutationAllowed: false,
      appliedPortfolioAndResearchSeparated: true,
      legacyPortfolioReturnFieldsMeaning: 'APPLIED_PORTFOLIO_ONLY',
      pendingReturnMustRemainNull: true,
      marketSessionCalendar: 'MULTI_SYMBOL_TRUSTED_OHLC_DATE_CONSENSUS',
      calendarConsensusPct: CALENDAR_CONSENSUS_PCT,
      calendarMinimumVotes: CALENDAR_MIN_VOTES,
      entryPolicy: 'FIRST_CONSENSUS_MARKET_SESSION_OPEN_ONLY_WITHIN_ISSUED_ENTRY_RANGE',
      delayedEntryAfterFirstSessionAllowed: false,
      sameSessionTargetStopAmbiguity: 'TREAT_AS_STOP',
      gapBelowStopPolicy: 'EXIT_AT_ACTUAL_OPEN_IF_WORSE_THAN_STOP',
      gapAboveTargetPolicy: 'CREDIT_CAPPED_AT_TARGET1',
      horizonClosePolicy: 'CLOSE_AT_HORIZON_SESSION_CLOSE_IF_NO_PRIOR_EXIT',
      roundTripTransactionCostPct: COST_PCT,
      avoidStatusResearchEvaluationAllowed: false,
      hardReviewOrInvalidPlanResearchEvaluationAllowed: false,
      futureRowsAllowed: false,
      syntheticOhlcAllowed: false,
    },
    calendarEvidence: [...calendarsBySignalDate.entries()].map(([signalDate, cal]) => ({ signalDate, asOfSessionDate: asOfDate, historyCount: cal.historyCount, requiredVotes: cal.requiredVotes, consensusPct: cal.consensusPct, acceptedSessions: cal.acceptedSessions, candidates: cal.candidates })),
    historyEvidence: {
      requestedTickerCount: neededTickers.length,
      trustedHistoryTickerCount: historyResults.filter(row => row.ok).length,
      liveYahooRefreshCount: historyResults.filter(row => row.sourceKind === 'LIVE_YAHOO_REFRESH' && row.ok).length,
      cachedFallbackCount: historyResults.filter(row => row.sourceKind === 'CACHED_VERIFIED_HISTORY_DOCUMENT' && row.ok).length,
      unavailableTickers: historyResults.filter(row => !row.ok).map(row => ({ ticker: row.ticker, blockers: row.blockers, attempts: row.attempts })),
      futureRowsRejected: historyResults.reduce((sum,row) => sum + Number(row.futureRowsRejected || 0), 0),
    },
    evaluations,
  };
  write('data/v20/forward-evaluation.json', out);
  const report = {
    schemaVersion: '20.0.0-forward-resolution-status-1',
    generatedAt: new Date().toISOString(),
    asOfSessionDate: asOfDate,
    signalCount: new Set(evaluations.map(row => row.immutableSignalHash)).size,
    evaluationCount: evaluations.length,
    resolvedCount: evaluations.filter(row => row.status === 'RESOLVED').length,
    pendingCount: evaluations.filter(row => row.status === 'PENDING').length,
    appliedCashResolvedCount: evaluations.filter(row => row.status === 'RESOLVED' && row.appliedPortfolio?.status === 'CASH_NO_APPLIED_EXPOSURE').length,
    researchResolvedCount: evaluations.filter(row => row.researchEvaluation?.resolved === true).length,
    researchAmbiguousCount: evaluations.reduce((sum,row) => sum + Number(row.researchEvaluation?.ambiguousCount || 0), 0),
    acceptedFutureSessionsBySignalDate: out.calendarEvidence.map(row => ({ signalDate: row.signalDate, sessions: row.acceptedSessions })),
  };
  write('data/v20/forward-resolution-status.json', report);
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
