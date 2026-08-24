import { analyzeTickerBase } from '../src/engine.js';
import { POLICY } from '../src/policy.js';
import { loadUniverse, loadHistory, loadV17, loadHistorySummary } from '../src/repository.js';
import { fetchMubasherQuote } from '../monitor/session-quote.js';

const MAX_BATCH = 10;
const TICKER_RE = /^[A-Z0-9._-]{2,12}$/;
const QUALITY_ONLY = new Set(['QUALITY_BLOCKED']);
const ALIGNMENT_ONLY = new Set(['DO_NOT_CHASE', 'BELOW_ENTRY_WAIT']);

const n = value => Number.isFinite(Number(value)) ? Number(value) : null;
const iso = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : null;

export function normalizeTickerList(value, maxBatch = MAX_BATCH) {
  return [...new Set(String(value ?? '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter((x) => TICKER_RE.test(x)))]
    .slice(0, Math.max(1, Math.min(MAX_BATCH, Number(maxBatch) || MAX_BATCH)));
}

export function mergeIntradayBar(rows = [], quote = null) {
  const date = iso(quote?.sourceSessionDate);
  const open = n(quote?.open), high = n(quote?.high), low = n(quote?.low), close = n(quote?.price);
  const volume = Math.max(0, n(quote?.volume) ?? 0);
  const valueTraded = n(quote?.turnover);
  if (!date || ![open, high, low, close].every((x) => x !== null && x > 0)) return Array.isArray(rows) ? [...rows] : [];
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return Array.isArray(rows) ? [...rows] : [];
  const bar = { date, open, high, low, close, volume };
  if (valueTraded !== null && valueTraded >= 0) bar.valueTraded = valueTraded;
  const out = (Array.isArray(rows) ? rows : []).filter((row) => String(row?.date ?? row?.sessionDate ?? '') !== date);
  out.push(bar);
  return out.sort((a, b) => String(a?.date ?? a?.sessionDate ?? '').localeCompare(String(b?.date ?? b?.sessionDate ?? '')));
}

export function classifyIntradayShadow(analysis = null) {
  if (!analysis) return { state: 'INTRADAY_UNAVAILABLE', technicalGatePass: false, publicationAllowed: false, blockingReasons: ['ANALYSIS_UNAVAILABLE'] };
  const reasons = Array.isArray(analysis.reasonCodes) ? analysis.reasonCodes : [];
  const nonQuality = reasons.filter((reason) => !QUALITY_ONLY.has(reason));
  const technicalGatePass = nonQuality.length === 0;
  const alignmentOnly = nonQuality.length > 0 && nonQuality.every((reason) => ALIGNMENT_ONLY.has(reason));
  const state = technicalGatePass
    ? 'INTRADAY_TECHNICAL_PASS'
    : alignmentOnly
      ? 'INTRADAY_ALIGNMENT_WAIT'
      : 'INTRADAY_NO_CANDIDATE';
  return {
    state,
    technicalGatePass,
    publicationAllowed: false,
    blockingReasons: reasons,
    nonQualityReasons: nonQuality,
    qualityBlocked: analysis?.quality?.state === 'BLOCKED',
  };
}

function compactAnalysis(result = null) {
  if (!result) return null;
  return {
    ticker: result.ticker ?? null,
    sessionDate: result.sessionDate ?? null,
    price: result.price ?? null,
    decision: result.decision ?? null,
    eligible: result.eligible === true,
    scores: {
      core: result.scores?.core ?? null,
      research: result.scores?.research ?? null,
      liquidity: result.scores?.liquidity ?? null,
      supportResistance: result.scores?.supportResistance ?? null,
      fusionRank: null,
    },
    tradePlan: result.tradePlan ?? null,
    quality: result.quality ? {
      state: result.quality.state ?? null,
      score: result.quality.score ?? null,
      warnings: Array.isArray(result.quality.warnings) ? result.quality.warnings : [],
    } : null,
    reasonCodes: Array.isArray(result.reasonCodes) ? result.reasonCodes : [],
  };
}

async function analyzeOne(ticker, context, force = false) {
  const discovery = context.candidateMap.get(ticker) ?? null;
  const [history, quote] = await Promise.all([
    loadHistory(ticker),
    fetchMubasherQuote(ticker, { force }),
  ]);

  const baseline = analyzeTickerBase({
    ticker,
    nameAr: discovery?.nameAr ?? null,
    nameEn: discovery?.nameEn ?? null,
    rows: history.rows,
    historyMeta: history.meta,
    v17: context.v17,
    discovery,
    expectedSessionDate: context.historySession,
  });

  const augmentedRows = mergeIntradayBar(history.rows, quote);
  const warnings = [...new Set([...(history.meta?.warnings ?? []), 'not_officially_verified', 'intraday_delayed_provisional_bar'])];
  const provisionalMeta = {
    ...(history.meta ?? {}),
    warnings,
    staleData: false,
    updateFailed: false,
    officiallyVerifiedLatestSession: false,
  };
  const shadow = analyzeTickerBase({
    ticker,
    nameAr: discovery?.nameAr ?? null,
    nameEn: discovery?.nameEn ?? null,
    rows: augmentedRows,
    historyMeta: provisionalMeta,
    v17: context.v17,
    discovery,
    expectedSessionDate: quote.sourceSessionDate ?? null,
  });
  const classification = classifyIntradayShadow(shadow);

  return {
    ticker,
    baseline: compactAnalysis(baseline),
    quote,
    shadow: {
      ...compactAnalysis(shadow),
      ...classification,
      provisional: true,
      incompleteDailyBar: true,
      source: 'MUBASHER_DELAYED_15_MIN',
    },
  };
}

function runtimeSourceCommit() {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.TFE_SOURCE_COMMIT || null;
}

function setCors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Cache-Control, Content-Type');
  res.setHeader('access-control-max-age', '600');
}

function send(res, status, body) {
  res.statusCode = status;
  setCors(res);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-tfe-engine', POLICY.engineId);
  const commit = runtimeSourceCommit();
  if (commit) res.setHeader('x-tfe-source-commit', commit);
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (String(req.method || 'GET').toUpperCase() === 'OPTIONS') {
    res.statusCode = 204;
    setCors(res);
    res.setHeader('cache-control', 'no-store');
    return res.end();
  }
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const tickers = normalizeTickerList(url.searchParams.get('tickers'));
    if (!tickers.length) return send(res, 400, { ok: false, error: 'tickers is required' });
    const force = url.searchParams.get('force') === '1';
    const [{ candidates }, v17, historySummary] = await Promise.all([loadUniverse(), loadV17(), loadHistorySummary()]);
    const candidateMap = new Map((Array.isArray(candidates) ? candidates : []).map((item) => [String(item.ticker ?? '').toUpperCase(), item]));
    const context = { candidateMap, v17, historySession: historySummary?.latestMarketSession ?? null };
    const settled = await Promise.allSettled(tickers.map((ticker) => analyzeOne(ticker, context, force)));
    const results = [], errors = [];
    settled.forEach((item, index) => {
      if (item.status === 'fulfilled') results.push(item.value);
      else {
        console.error('[RC2_INTRADAY_SYMBOL_ERROR]', { ticker: tickers[index], error: item.reason?.message ?? String(item.reason) });
        errors.push({ ticker: tickers[index], error: 'INTRADAY_SOURCE_UNAVAILABLE' });
      }
    });
    return send(res, 200, {
      ok: true,
      engine: POLICY.engineId,
      sourceCommit: runtimeSourceCommit(),
      layer: 'RC2_INTRADAY_OPERATIONS_V1',
      generatedAt: new Date().toISOString(),
      baselineSessionDate: context.historySession,
      requested: tickers.length,
      returned: results.length,
      results,
      errors,
      source: 'MUBASHER_DELAYED_15_MIN',
      delayedMinutes: 15,
      provisionalOnly: true,
      incompleteDailyBar: true,
      scoringImpact: 'NONE',
      recommendationMutationAllowed: false,
      publicationAllowed: false,
      executionAllowed: false,
      automaticOrders: false,
      corsReadOnly: true,
      disclaimer: 'Intraday shadow analysis uses an incomplete delayed daily bar for operational monitoring only. It cannot create, replace, rank, or mutate official RC2 recommendations; official signals remain end-of-session decisions from completed bars.',
    });
  } catch (error) {
    console.error('[RC2_INTRADAY_API_ERROR]', error?.stack ?? error?.message ?? error);
    return send(res, 500, { ok: false, error: 'INTERNAL_SERVER_ERROR', layer: 'RC2_INTRADAY_OPERATIONS_V1' });
  }
}
