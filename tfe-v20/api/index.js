import { POLICY } from '../src/policy.js';
import { analyzeTicker, rankAnalyses } from '../src/engine.js';
import { backtestHistory, summarizeBacktest } from '../src/backtest.js';
import { buildAblationBenchmark } from '../src/ablation.js';
import { buildDecisionLogRows, toDecisionLogCsv } from '../src/decisionLog.js';
import { normalizeBars } from '../src/quality.js';
import { DATA_SOURCES, fetchJson, rawUrl, loadUniverse, loadHistory, loadV17, loadHistorySummary } from '../src/repository.js';

export function runtimeSourceCommit() {
  return process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GITHUB_SHA
    || process.env.TFE_SOURCE_COMMIT
    || null;
}

function applyRuntimeHeaders(res) {
  res.setHeader('x-tfe-engine', POLICY.engineId);
  const sourceCommit = runtimeSourceCommit();
  if (sourceCommit) res.setHeader('x-tfe-source-commit', sourceCommit);
}

const json = (res, status, body) => {
  res.statusCode = status;
  applyRuntimeHeaders(res);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

function logInternal(scope, error, context = null) {
  const payload = context ? ` ${JSON.stringify(context)}` : '';
  console.error(`[${scope}]${payload}`, error?.stack ?? error?.message ?? error);
}

export function withPublicationGate(result) {
  const technicalEligible = Boolean(result?.eligible);
  const publicationHold = Boolean(result?.quality?.publicationHold);
  const dataNotReady = Array.isArray(result?.reasonCodes) && result.reasonCodes.includes('DATA_NOT_READY');
  const publicationEligible = technicalEligible && !publicationHold;
  return {
    ...result,
    technicalEligible,
    publicationEligible,
    dataNotReady,
    publicationState: dataNotReady
      ? 'DATA_NOT_READY'
      : publicationHold
        ? 'PRICE_RECONCILIATION_REQUIRED'
        : publicationEligible
          ? 'RESEARCH_CANDIDATE'
          : 'REJECTED',
  };
}

function reasonCounts(items) {
  const counts = {};
  for (const x of items) for (const r of x.reasonCodes ?? (x.error ? ['HISTORY_LOAD_ERROR'] : [])) counts[r] = (counts[r] ?? 0) + 1;
  return counts;
}

function warningConflictPct(warnings = []) {
  for (const w of warnings) {
    const m = String(w).match(/latest_close_conflict:([0-9.]+)%/i);
    if (m) return Number(m[1]);
  }
  return null;
}

async function marketIndex() {
  const hs = await loadHistorySummary();
  const latest = hs?.latestMarketSession ?? null;
  const symbols = Array.isArray(hs?.symbols) ? hs.symbols.map((x) => ({
    ticker: x.ticker,
    companyNameAr: x.companyNameAr ?? null,
    companyNameEn: x.companyNameEn ?? null,
    symbolVerified: x.symbolVerified === true,
    availableSessions: x.availableSessions ?? 0,
    firstSession: x.firstSession ?? null,
    lastSession: x.lastSession ?? null,
    historyStatus: x.historyStatus ?? null,
    primarySource: x.primarySource ?? null,
    officiallyVerifiedLatestSession: x.officiallyVerifiedLatestSession === true,
    averageConfidence: x.averageConfidence ?? null,
    staleData: Boolean(x.staleData),
    updateFailed: Boolean(x.updateFailed),
    warnings: Array.isArray(x.warnings) ? x.warnings : [],
    conflictPct: warningConflictPct(x.warnings),
    currentRc2UniverseCandidate: x.symbolVerified === true
      && (x.availableSessions ?? 0) >= POLICY.minBars
      && !x.staleData
      && !x.updateFailed
      && (!latest || x.lastSession === latest),
  })) : [];
  return {
    ok: true,
    engine: POLICY.engineId,
    sourceCommit: runtimeSourceCommit(),
    sessionDate: latest,
    generatedAt: hs?.generatedAt ?? null,
    symbolsTotal: symbols.length,
    currentCandidateCount: symbols.filter((x) => x.currentRc2UniverseCandidate).length,
    symbols,
    dataSources: DATA_SOURCES,
    uiOnly: true,
    scoringImpact: 'NONE',
  };
}

async function historySeries(ticker, limit = 120) {
  const h = await loadHistory(ticker);
  const bars = normalizeBars(h.rows).bars;
  const n = Math.max(20, Math.min(260, Number(limit) || 120));
  return {
    ok: true,
    engine: POLICY.engineId,
    sourceCommit: runtimeSourceCommit(),
    ticker,
    source: h.meta?.primarySource ?? h.meta?.source ?? null,
    sourceBranch: h.sourceBranch ?? DATA_SOURCES.alphaDataBranch,
    lastSession: bars.at(-1)?.date ?? null,
    availableSessions: bars.length,
    bars: bars.slice(-n),
    uiOnly: true,
    scoringImpact: 'NONE',
  };
}

async function scan(outputLimit = 20) {
  const [{ snapshot, historySummary, candidates, discoveryOnlyCandidates = [], expectedSessionDate, universeMode }, v17] = await Promise.all([loadUniverse(), loadV17()]);
  const results = [];
  for (let i = 0; i < candidates.length; i += 16) {
    const batch = await Promise.all(candidates.slice(i, i + 16).map(async (d) => {
      try {
        const h = await loadHistory(d.ticker);
        const analyzed = analyzeTicker({ ticker: d.ticker, nameAr: d.nameAr, nameEn: d.nameEn, rows: h.rows, historyMeta: h.meta, v17, discovery: d, expectedSessionDate });
        return withPublicationGate(analyzed);
      } catch (e) {
        logInternal('TFE_SCAN_SYMBOL_ERROR', e, { ticker: d.ticker });
        return withPublicationGate({ ticker: d.ticker, eligible: false, decision: 'NO_RECOMMENDATION', error: 'DATA_SOURCE_ERROR', permissions: POLICY.permissions });
      }
    }));
    results.push(...batch);
  }

  const technicalEligible = results.filter((x) => x.technicalEligible);
  const publishable = results.filter((x) => x.publicationEligible);
  const withheld = results.filter((x) => x.technicalEligible && !x.publicationEligible);
  const dataNotReady = results.filter((x) => x.publicationState === 'DATA_NOT_READY');
  const rejected = results.filter((x) => !x.technicalEligible && x.publicationState !== 'DATA_NOT_READY');
  const allRanked = rankAnalyses(publishable);
  const recommendations = allRanked.slice(0, outputLimit);

  return {
    ok: true,
    engine: POLICY.engineId,
    schemaVersion: POLICY.schemaVersion,
    sourceCommit: runtimeSourceCommit(),
    generatedAt: new Date().toISOString(),
    mode: 'RESEARCH_ONLY',
    permissions: POLICY.permissions,
    ranking: {
      primary: 'FUSION_RANK',
      hardGatesBeforeHistoricalConfidence: true,
      weightingMode: 'EVIDENCE_AWARE',
      researchWeightRange: [POLICY.fusionRank.researchWeight, 1],
      historicalConfidenceWeightRange: [0, POLICY.fusionRank.historicalConfidenceWeight],
      missingHistoricalEvidence: 'NEUTRAL_NOT_ZERO',
      historicalConfidenceMethod: 'WILSON_95_LOWER_BOUND_WITH_WEIGHT_SCALED_BY_SAMPLE_RELIABILITY',
      minimumHistoricalTradesForFullWeight: POLICY.minHistoricalTrades,
      dataReadinessGate: 'FAIL_CLOSED_BEFORE_SCORING',
      dataNotReadyIsRejection: false,
    },
    universe: {
      mode: universeMode,
      sessionDate: expectedSessionDate,
      historySummaryGeneratedAt: historySummary?.generatedAt ?? null,
      currentVerifiedCandidates: candidates.length,
      discoveryOnlyCandidates: discoveryOnlyCandidates.length,
      fallbackMayEnterRanking: false,
      alphaDataBranch: DATA_SOURCES.alphaDataBranch,
      overlayBranch: DATA_SOURCES.overlayBranch,
      v20NativeSourceEngine: snapshot?.engineId ?? snapshot?.schemaVersion ?? 'V20_CURRENT_MARKET',
      v20NativeSessionDate: snapshot?.sessionDate ?? null,
      nativeOverlayOnly: true,
    },
    v17: v17 ? { status: v17.status, sessionDate: v17.sessionDate, executionReady: Boolean(v17.readiness?.executionReady), executionOverride: false } : { available: false },
    summary: {
      scanned: results.length,
      technicalEligibleTotal: technicalEligible.length,
      publicationEligibleTotal: allRanked.length,
      withheldForPriceReconciliation: withheld.length,
      dataNotReady: dataNotReady.length,
      returned: recommendations.length,
      rejected: rejected.length,
    },
    recommendations,
    withheldForReconciliation: withheld.map((x) => ({
      ticker: x.ticker,
      technicalResearchScore: x.scores?.research ?? null,
      fusionRankScore: x.scores?.fusionRank ?? null,
      conflictPct: x.quality?.conflictPct ?? null,
      holdReason: x.quality?.publicationHoldReason ?? 'PRICE_RECONCILIATION_REQUIRED',
    })),
    dataReadinessReasonCounts: reasonCounts(dataNotReady),
    dataNotReadySample: dataNotReady.slice(0, 40).map((x) => ({
      ticker: x.ticker,
      reasonCodes: x.reasonCodes ?? [],
      readiness: x.dataReadiness ?? null,
      error: x.error ?? null,
    })),
    rejectionReasonCounts: reasonCounts(rejected),
    rejectedSample: rejected.slice(0, 40).map((x) => ({ ticker: x.ticker, reasonCodes: x.reasonCodes ?? [], quality: x.quality?.state ?? null, reviewFlags: x.quality?.reviewFlags ?? [], error: x.error ?? null })),
  };
}

async function simulateMarket(maxSymbols = 220) {
  const { candidates } = await loadUniverse();
  const selected = candidates.slice(0, Math.max(1, Math.min(220, maxSymbols)));
  const allTrades = [], allExpired = [], perTicker = [], errors = [], dataNotReady = [];
  for (let i = 0; i < selected.length; i += 16) {
    const batch = await Promise.all(selected.slice(i, i + 16).map(async (d) => {
      try {
        const h = await loadHistory(d.ticker);
        const bt = backtestHistory({ ticker: d.ticker, rows: h.rows, historyMeta: h.meta });
        return { ticker: d.ticker, bt };
      } catch (e) {
        logInternal('TFE_SIM_SYMBOL_ERROR', e, { ticker: d.ticker });
        return { ticker: d.ticker, error: 'DATA_SOURCE_ERROR' };
      }
    }));
    for (const r of batch) {
      if (r.error) { errors.push({ ticker: r.ticker, error: r.error }); continue; }
      if (r.bt.skipped) {
        dataNotReady.push({ ticker: r.ticker, reason: r.bt.skipReason ?? 'DATA_NOT_READY', readiness: r.bt.dataReadiness ?? null });
        continue;
      }
      allTrades.push(...r.bt.trades);
      allExpired.push(...r.bt.expired.map((x) => ({ ticker: r.ticker, ...x })));
      perTicker.push({ ticker: r.ticker, ...r.bt.summary });
    }
  }
  const aggregate = summarizeBacktest(allTrades, allExpired).summary;
  return {
    ok: true,
    engine: POLICY.engineId,
    sourceCommit: runtimeSourceCommit(),
    scope: 'RECORDED_FULL_MARKET_HISTORY',
    methodology: {
      technicalCore: 'ORIGINAL_SCOREBARS_SMA50_SMA200_RSI14_MACD_ATR_VOLUME',
      hardGates: true,
      noLookahead: true,
      entryAfterSignal: true,
      entryExpirySessions: POLICY.entryExpirySessions,
      maxHoldSessions: POLICY.maxHoldSessions,
      sameBarAmbiguity: 'STOP_FIRST',
      costPct: POLICY.roundTripCostPct,
      presentDayQualityWarningsExcludedFromPastSignals: true,
      alphaDataBranch: DATA_SOURCES.alphaDataBranch,
      dataReadinessGate: 'FULL_HISTORY_FAIL_CLOSED',
      incompleteHistoryAction: 'SKIP_NOT_ZERO_SCORE',
    },
    symbolsRequested: selected.length,
    symbolsCompleted: perTicker.length,
    symbolsDataNotReady: dataNotReady.length,
    dataNotReady,
    errors,
    summary: aggregate,
    perTicker: perTicker.filter((x) => x.entered > 0).sort((a,b) => (b.target1Pct ?? -1) - (a.target1Pct ?? -1) || b.entered - a.entered),
  };
}

async function ablationMarket() {
  const [v20Replay, v17TrackRecord] = await Promise.all([
    fetchJson(rawUrl(DATA_SOURCES.overlayBranch, 'data/v20/retrospective-walk-forward-target-stop.json')),
    fetchJson(rawUrl(DATA_SOURCES.overlayBranch, 'data/v17/recommendation-track-record.json')),
  ]);
  const tickers = [...new Set((v20Replay?.sessions ?? []).flatMap((s) => (s?.members ?? []).map((m) => String(m?.ticker ?? '').trim().toUpperCase())).filter(Boolean))];
  const histories = {}, historyErrors = [];
  for (let i = 0; i < tickers.length; i += 12) {
    const batch = await Promise.all(tickers.slice(i, i + 12).map(async (ticker) => {
      try {
        const h = await loadHistory(ticker);
        return { ticker, rows: h.rows };
      } catch (e) {
        logInternal('TFE_ABLATION_HISTORY_ERROR', e, { ticker });
        return { ticker, error: 'DATA_SOURCE_ERROR' };
      }
    }));
    for (const item of batch) {
      if (item.error) historyErrors.push({ ticker: item.ticker, error: item.error });
      else histories[item.ticker] = item.rows;
    }
  }
  return {
    ok: true,
    engine: POLICY.engineId,
    sourceCommit: runtimeSourceCommit(),
    generatedAt: new Date().toISOString(),
    ...buildAblationBenchmark({ v20Replay, v17TrackRecord, histories, historyErrors }),
  };
}

async function sessionMonitorPayload(url) {
  const tickers = [...new Set(String(url.searchParams.get('tickers') ?? '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter((x) => /^[A-Z0-9._-]{2,12}$/.test(x)))]
    .slice(0, 10);
  if (!tickers.length) return { status: 400, body: { ok: false, error: 'tickers is required' } };
  const force = url.searchParams.get('force') === '1';
  const { fetchMubasherQuote } = await import('../monitor/session-quote.js');
  const settled = await Promise.allSettled(tickers.map((ticker) => fetchMubasherQuote(ticker, { force })));
  const quotes = [], errors = [];
  settled.forEach((result, index) => {
    const ticker = tickers[index];
    if (result.status === 'fulfilled') quotes.push(result.value);
    else {
      logInternal('SESSION_MONITOR_QUOTE_ERROR', result.reason, { ticker });
      errors.push({ ticker, error: 'QUOTE_SOURCE_UNAVAILABLE' });
    }
  });
  return {
    status: 200,
    body: {
      ok: true,
      monitor: 'SESSION_MONITOR_V1',
      generatedAt: new Date().toISOString(),
      monitorOnly: true,
      scoringImpact: 'NONE',
      recommendationMutationAllowed: false,
      executionAllowed: false,
      source: 'MUBASHER_DELAYED_15_MIN',
      delayedMinutes: 15,
      disclaimer: 'Monitoring prices update only the observed status of already-frozen RC2 candidates and never alter Alpha, Fusion Rank, hard gates, or recommendations.',
      requested: tickers.length,
      returned: quotes.length,
      quotes,
      errors,
    },
  };
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const route = url.searchParams.get('route') ?? 'scan';
    if (route === 'session-monitor') {
      const monitor = await sessionMonitorPayload(url);
      return json(res, monitor.status, monitor.body);
    }
    if (route === 'health') return json(res, 200, {
      ok: true,
      engine: POLICY.engineId,
      sourceCommit: runtimeSourceCommit(),
      policy: POLICY,
      dataSources: DATA_SOURCES,
      invariant: 'RESEARCH_ONLY_EXECUTION_BLOCKED',
      technicalCore: 'ORIGINAL_SCOREBARS_PRESERVED',
      dataReadinessGate: 'FAIL_CLOSED_UNKNOWN_NEVER_ZERO',
      dataNotReadyIsRejection: false,
      historicalConfidence: 'WILSON_AFTER_HARD_GATES_WITH_EVIDENCE_AWARE_WEIGHTING',
      missingHistoricalEvidence: 'NEUTRAL_NOT_ZERO',
      decisionLog: 'AVAILABLE',
      ablationBenchmark: 'AVAILABLE_RESEARCH_DIAGNOSTIC',
      professionalUi: 'V16_9_INTERFACE_ADAPTER_ONLY',
    });
    if (route === 'market-index') return json(res, 200, await marketIndex());
    if (route === 'history') {
      const ticker = String(url.searchParams.get('ticker') ?? '').trim().toUpperCase();
      if (!ticker) return json(res, 400, { ok: false, error: 'ticker is required' });
      return json(res, 200, await historySeries(ticker, url.searchParams.get('limit')));
    }
    if (route === 'analyze') {
      const ticker = String(url.searchParams.get('ticker') ?? '').trim().toUpperCase();
      if (!ticker) return json(res, 400, { ok: false, error: 'ticker is required' });
      const [h, v17, hs] = await Promise.all([loadHistory(ticker), loadV17(), loadHistorySummary()]);
      const analyzed = analyzeTicker({ ticker, rows: h.rows, historyMeta: h.meta, v17, expectedSessionDate: hs?.latestMarketSession ?? null });
      return json(res, 200, { ok: true, sourceCommit: runtimeSourceCommit(), result: withPublicationGate(analyzed) });
    }
    if (route === 'decision-log') {
      const limit = Math.max(5, Math.min(50, Number(url.searchParams.get('limit') ?? 50) || 50));
      const scanned = await scan(limit);
      const sourceCommit = runtimeSourceCommit();
      const rows = buildDecisionLogRows(scanned.recommendations, {
        sessionDate: scanned.universe?.sessionDate ?? null,
        generatedAt: scanned.generatedAt,
        sourceCommit,
      });
      if (String(url.searchParams.get('format') ?? 'json').toLowerCase() === 'csv') {
        res.statusCode = 200;
        applyRuntimeHeaders(res);
        res.setHeader('content-type', 'text/csv; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        return res.end(toDecisionLogCsv(rows));
      }
      return json(res, 200, { ok: true, engine: POLICY.engineId, sourceCommit, sessionDate: scanned.universe?.sessionDate ?? null, generatedAt: scanned.generatedAt, rows });
    }
    if (route === 'ablation') return json(res, 200, await ablationMarket());
    if (route === 'simulate') {
      const scope = String(url.searchParams.get('scope') ?? 'ticker').toLowerCase();
      if (scope === 'market') {
        const maxSymbols = Number(url.searchParams.get('symbols') ?? 220) || 220;
        return json(res, 200, await simulateMarket(maxSymbols));
      }
      const ticker = String(url.searchParams.get('ticker') ?? 'ETEL').trim().toUpperCase();
      const h = await loadHistory(ticker);
      return json(res, 200, { ok: true, engine: POLICY.engineId, sourceCommit: runtimeSourceCommit(), ticker, methodology: { technicalCore: 'ORIGINAL_SCOREBARS_SMA50_SMA200_RSI14_MACD_ATR_VOLUME', noLookahead: true, entryAfterSignal: true, sameBarAmbiguity: 'STOP_FIRST', costPct: POLICY.roundTripCostPct, presentDayQualityWarningsExcludedFromPastSignals: true, alphaDataBranch: DATA_SOURCES.alphaDataBranch, dataReadinessGate: 'FULL_HISTORY_FAIL_CLOSED', incompleteHistoryAction: 'SKIP_NOT_ZERO_SCORE' }, ...backtestHistory({ ticker, rows: h.rows, historyMeta: h.meta }) });
    }
    const limit = Math.max(5, Math.min(50, Number(url.searchParams.get('limit') ?? 20) || 20));
    return json(res, 200, await scan(limit));
  } catch (e) {
    logInternal('TFE_API_ERROR', e);
    return json(res, 500, { ok: false, engine: POLICY.engineId, error: 'INTERNAL_SERVER_ERROR' });
  }
}