import { POLICY } from '../src/policy.js';
import { analyzeTicker, rankAnalyses } from '../src/engine.js';
import { backtestHistory, summarizeBacktest } from '../src/backtest.js';
import { loadUniverse, loadHistory, loadV17, loadHistorySummary } from '../src/repository.js';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

function reasonCounts(items) {
  const counts = {};
  for (const x of items) for (const r of x.reasonCodes ?? (x.error ? ['HISTORY_LOAD_ERROR'] : [])) counts[r] = (counts[r] ?? 0) + 1;
  return counts;
}

async function scan(outputLimit = 20) {
  const [{ snapshot, historySummary, candidates, expectedSessionDate, universeMode }, v17] = await Promise.all([loadUniverse(), loadV17()]);
  const results = [];
  for (let i = 0; i < candidates.length; i += 16) {
    const batch = await Promise.all(candidates.slice(i, i + 16).map(async (d) => {
      try {
        const h = await loadHistory(d.ticker);
        return analyzeTicker({ ticker: d.ticker, nameAr: d.nameAr, nameEn: d.nameEn, rows: h.rows, historyMeta: h.meta, v17, discovery: d, expectedSessionDate });
      } catch (e) {
        return { ticker: d.ticker, eligible: false, decision: 'NO_RECOMMENDATION', error: e.message, permissions: POLICY.permissions };
      }
    }));
    results.push(...batch);
  }
  const allRanked = rankAnalyses(results);
  const recommendations = allRanked.slice(0, outputLimit);
  const rejected = results.filter((x) => !x.eligible);
  return {
    ok: true, engine: POLICY.engineId, schemaVersion: POLICY.schemaVersion, generatedAt: new Date().toISOString(),
    mode: 'RESEARCH_ONLY', permissions: POLICY.permissions,
    universe: {
      mode: universeMode,
      sessionDate: expectedSessionDate,
      historySummaryGeneratedAt: historySummary?.generatedAt ?? null,
      currentVerifiedCandidates: candidates.length,
      v20NativeSourceEngine: snapshot?.engineId ?? snapshot?.schemaVersion ?? 'V20_CURRENT_MARKET',
      v20NativeSessionDate: snapshot?.sessionDate ?? null,
      nativeOverlayOnly: true,
    },
    v17: v17 ? { status: v17.status, sessionDate: v17.sessionDate, executionReady: Boolean(v17.readiness?.executionReady), executionOverride: false } : { available: false },
    summary: { scanned: results.length, eligibleTotal: allRanked.length, returned: recommendations.length, rejected: rejected.length },
    recommendations,
    rejectionReasonCounts: reasonCounts(rejected),
    rejectedSample: rejected.slice(0, 40).map((x) => ({ ticker: x.ticker, reasonCodes: x.reasonCodes ?? [], quality: x.quality?.state ?? null, reviewFlags: x.quality?.reviewFlags ?? [], error: x.error ?? null })),
  };
}

async function simulateMarket(maxSymbols = 220) {
  const { candidates } = await loadUniverse();
  const selected = candidates.slice(0, Math.max(1, Math.min(220, maxSymbols)));
  const allTrades = [], allExpired = [], perTicker = [], errors = [];
  for (let i = 0; i < selected.length; i += 16) {
    const batch = await Promise.all(selected.slice(i, i + 16).map(async (d) => {
      try {
        const h = await loadHistory(d.ticker);
        const bt = backtestHistory({ ticker: d.ticker, rows: h.rows, historyMeta: h.meta });
        return { ticker: d.ticker, bt };
      } catch (e) { return { ticker: d.ticker, error: e.message }; }
    }));
    for (const r of batch) {
      if (r.error) { errors.push({ ticker: r.ticker, error: r.error }); continue; }
      allTrades.push(...r.bt.trades); allExpired.push(...r.bt.expired.map((x) => ({ ticker: r.ticker, ...x })));
      perTicker.push({ ticker: r.ticker, ...r.bt.summary });
    }
  }
  const aggregate = summarizeBacktest(allTrades, allExpired).summary;
  return {
    ok: true, engine: POLICY.engineId, scope: 'RECORDED_FULL_MARKET_HISTORY',
    methodology: { noLookahead: true, entryAfterSignal: true, entryExpirySessions: POLICY.entryExpirySessions, maxHoldSessions: POLICY.maxHoldSessions, sameBarAmbiguity: 'STOP_FIRST', costPct: POLICY.roundTripCostPct, presentDayQualityWarningsExcludedFromPastSignals: true },
    symbolsRequested: selected.length, symbolsCompleted: perTicker.length, errors,
    summary: aggregate,
    perTicker: perTicker.filter((x) => x.entered > 0).sort((a,b) => (b.target1Pct ?? -1) - (a.target1Pct ?? -1) || b.entered - a.entered),
  };
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const route = url.searchParams.get('route') ?? 'scan';
    if (route === 'health') return json(res, 200, { ok: true, engine: POLICY.engineId, policy: POLICY, invariant: 'RESEARCH_ONLY_EXECUTION_BLOCKED' });
    if (route === 'analyze') {
      const ticker = String(url.searchParams.get('ticker') ?? '').trim().toUpperCase();
      if (!ticker) return json(res, 400, { ok: false, error: 'ticker is required' });
      const [h, v17, hs] = await Promise.all([loadHistory(ticker), loadV17(), loadHistorySummary()]);
      const result = analyzeTicker({ ticker, rows: h.rows, historyMeta: h.meta, v17, expectedSessionDate: hs?.latestMarketSession ?? null });
      return json(res, 200, { ok: true, result });
    }
    if (route === 'simulate') {
      const scope = String(url.searchParams.get('scope') ?? 'ticker').toLowerCase();
      if (scope === 'market') {
        const maxSymbols = Number(url.searchParams.get('symbols') ?? 220) || 220;
        return json(res, 200, await simulateMarket(maxSymbols));
      }
      const ticker = String(url.searchParams.get('ticker') ?? 'ETEL').trim().toUpperCase();
      const h = await loadHistory(ticker);
      return json(res, 200, { ok: true, engine: POLICY.engineId, ticker, methodology: { noLookahead: true, entryAfterSignal: true, sameBarAmbiguity: 'STOP_FIRST', costPct: POLICY.roundTripCostPct, presentDayQualityWarningsExcludedFromPastSignals: true }, ...backtestHistory({ ticker, rows: h.rows, historyMeta: h.meta }) });
    }
    const limit = Math.max(5, Math.min(50, Number(url.searchParams.get('limit') ?? 20) || 20));
    return json(res, 200, await scan(limit));
  } catch (e) {
    return json(res, 500, { ok: false, engine: POLICY.engineId, error: e.stack ?? e.message });
  }
}
