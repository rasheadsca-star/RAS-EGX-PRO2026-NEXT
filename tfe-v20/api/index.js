import { POLICY } from '../src/policy.js';
import { analyzeTicker, rankAnalyses } from '../src/engine.js';
import { backtestHistory } from '../src/backtest.js';
import { loadUniverse, loadHistory, loadV17 } from '../src/repository.js';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

async function scan(limit = 30) {
  const [{ snapshot, candidates }, v17] = await Promise.all([loadUniverse(limit), loadV17()]);
  const results = [];
  for (let i = 0; i < candidates.length; i += 8) {
    const batch = await Promise.all(candidates.slice(i, i + 8).map(async (d) => {
      try {
        const h = await loadHistory(d.ticker);
        return analyzeTicker({ ticker: d.ticker, nameAr: d.nameAr, nameEn: d.nameEn, rows: h.rows, historyMeta: h.meta, v17, discovery: d, expectedSessionDate: null });
      } catch (e) {
        return { ticker: d.ticker, eligible: false, decision: 'NO_RECOMMENDATION', error: e.message, permissions: POLICY.permissions };
      }
    }));
    results.push(...batch);
  }
  const ranked = rankAnalyses(results);
  return {
    ok: true, engine: POLICY.engineId, schemaVersion: POLICY.schemaVersion, generatedAt: new Date().toISOString(),
    mode: 'RESEARCH_ONLY', permissions: POLICY.permissions,
    discovery: { sourceEngine: snapshot.engineId ?? snapshot.schemaVersion ?? 'V20_CURRENT_MARKET', sourceSessionDate: snapshot.sessionDate ?? null, requested: candidates.length },
    v17: v17 ? { status: v17.status, sessionDate: v17.sessionDate, executionReady: Boolean(v17.readiness?.executionReady), executionOverride: false } : { available: false },
    summary: { scanned: results.length, eligible: ranked.length, rejected: results.length - ranked.length },
    recommendations: ranked,
    rejected: results.filter((x) => !x.eligible).map((x) => ({ ticker: x.ticker, reasonCodes: x.reasonCodes ?? [], quality: x.quality?.state ?? null, error: x.error ?? null })),
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
      const [h, v17] = await Promise.all([loadHistory(ticker), loadV17()]);
      const result = analyzeTicker({ ticker, rows: h.rows, historyMeta: h.meta, v17, expectedSessionDate: null });
      return json(res, 200, { ok: true, result });
    }
    if (route === 'simulate') {
      const ticker = String(url.searchParams.get('ticker') ?? 'ETEL').trim().toUpperCase();
      const h = await loadHistory(ticker);
      return json(res, 200, { ok: true, engine: POLICY.engineId, ticker, methodology: { noLookahead: true, entryAfterSignal: true, sameBarAmbiguity: 'STOP_FIRST', costPct: POLICY.roundTripCostPct }, ...backtestHistory({ ticker, rows: h.rows, historyMeta: h.meta }) });
    }
    const limit = Math.max(5, Math.min(40, Number(url.searchParams.get('limit') ?? 30) || 30));
    return json(res, 200, await scan(limit));
  } catch (e) {
    return json(res, 500, { ok: false, engine: POLICY.engineId, error: e.stack ?? e.message });
  }
}
