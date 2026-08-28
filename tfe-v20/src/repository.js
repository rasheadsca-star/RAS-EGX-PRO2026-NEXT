import { POLICY } from './policy.js';

const REPO = 'rasheadsca-star/RAS-EGX-PRO2026-NEXT';
const ALPHA_DATA_BRANCH = process.env.TFE_ALPHA_DATA_BRANCH || 'main';
const OVERLAY_BRANCH = process.env.TFE_OVERLAY_BRANCH || 'develop/v20-integrated-decision-platform';
const RAW = 'https://raw.githubusercontent.com';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const cache = globalThis.__TFE_JSON_CACHE__ ?? (globalThis.__TFE_JSON_CACHE__ = new Map());

const envInt = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
};

export const DATA_SOURCES = Object.freeze({
  alphaDataBranch: ALPHA_DATA_BRANCH,
  overlayBranch: OVERLAY_BRANCH,
  cacheTtlMs: envInt('TFE_FETCH_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS, 0, 60 * 60 * 1000),
  timeoutMs: envInt('TFE_FETCH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1_000, 60_000),
  retries: envInt('TFE_FETCH_RETRIES', DEFAULT_RETRIES, 0, 4),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJson(url, {
  ttlMs = DATA_SOURCES.cacheTtlMs,
  timeoutMs = DATA_SOURCES.timeoutMs,
  retries = DATA_SOURCES.retries,
} = {}) {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached?.data && cached.expiresAt > now) return cached.data;

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { 'user-agent': 'TFE-V20-FUSION-RC2' };
      if (cached?.etag) headers['if-none-match'] = cached.etag;
      const r = await fetch(url, { headers, signal: controller.signal });
      if (r.status === 304 && cached?.data) {
        const refreshed = { ...cached, expiresAt: Date.now() + ttlMs };
        cache.set(url, refreshed);
        return cached.data;
      }
      if (!r.ok) {
        const err = new Error(`HTTP_${r.status}`);
        err.status = r.status;
        throw err;
      }
      const data = await r.json();
      cache.set(url, {
        data,
        etag: r.headers.get('etag') || null,
        expiresAt: Date.now() + ttlMs,
      });
      return data;
    } catch (e) {
      lastErr = e;
      const status = Number(e?.status ?? 0);
      const retryable = e?.name === 'AbortError' || status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt >= retries) break;
      await sleep(150 * (2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  const error = new Error(`DATA_FETCH_FAILED:${new URL(url).pathname}`);
  error.cause = lastErr;
  throw error;
}

export const rawUrl = (branch, path) => `${RAW}/${REPO}/${branch}/${path}`;

export async function loadDiscoverySnapshot() {
  try { return await fetchJson(rawUrl(OVERLAY_BRANCH, 'data/v20/native-current.json')); }
  catch { return await fetchJson(rawUrl(OVERLAY_BRANCH, 'data/v20/current-market-snapshot.json')); }
}

export async function loadHistorySummary() {
  try { return await fetchJson(rawUrl(ALPHA_DATA_BRANCH, 'data/history-summary.json')); }
  catch { return null; }
}

export async function loadV17() {
  try { return await fetchJson(rawUrl(OVERLAY_BRANCH, 'data/v17/current.json')); }
  catch { return null; }
}

export async function loadHistory(ticker) {
  const url = rawUrl(ALPHA_DATA_BRANCH, `data/history/${ticker}.json`);
  const d = await fetchJson(url);
  return { rows: d.sessions ?? d.rows ?? [], meta: d, sourceUrl: url, sourceBranch: ALPHA_DATA_BRANCH };
}

function nativeCandidateMap(snapshot) {
  const map = new Map();
  const rows = Array.isArray(snapshot?.publishedCandidates) ? snapshot.publishedCandidates : [];
  for (const x of rows) map.set(String(x.ticker ?? '').toUpperCase(), x);
  return map;
}

function historyReadinessReasons(x, latestMarketSession) {
  const reasons = [];
  if (x?.symbolVerified !== true) reasons.push('SYMBOL_IDENTITY_NOT_VERIFIED');
  if ((x?.availableSessions ?? 0) < POLICY.minBars) reasons.push('INSUFFICIENT_HISTORY');
  if (x?.staleData) reasons.push('STALE_DATA_FLAG');
  if (x?.updateFailed) reasons.push('UPDATE_FAILED');
  if (!latestMarketSession || x?.lastSession !== latestMarketSession) reasons.push('SESSION_BEHIND_REFERENCE');
  return reasons;
}

function historyReadinessAssessment(summary) {
  if (!Array.isArray(summary?.symbols)) return [];
  const latest = summary.latestMarketSession ?? null;
  return summary.symbols.map((x) => ({
    ticker: x.ticker,
    companyNameAr: x.companyNameAr ?? null,
    companyNameEn: x.companyNameEn ?? null,
    availableSessions: x.availableSessions ?? 0,
    lastSession: x.lastSession ?? null,
    expectedSessionDate: latest,
    reasonCodes: historyReadinessReasons(x, latest),
  }));
}

function currentHistoryCandidates(summary, snapshot) {
  if (!Array.isArray(summary?.symbols) || !summary.latestMarketSession) return [];
  const nativeMap = nativeCandidateMap(snapshot);
  return summary.symbols
    .filter((x) => historyReadinessReasons(x, summary.latestMarketSession).length === 0)
    .map((x) => {
      const native = nativeMap.get(String(x.ticker).toUpperCase());
      return {
        ticker: x.ticker,
        nameAr: x.companyNameAr ?? native?.nameAr ?? null,
        nameEn: x.companyNameEn ?? native?.nameEn ?? null,
        rank: native?.rank ?? null,
        nativeResearchScore: native?.nativeResearchScore ?? null,
        nativeDiscoveryMatched: Boolean(native),
        historyAverageConfidence: x.averageConfidence ?? null,
      };
    });
}

function numericTurnover(value) {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n : null;
}

function fallbackDiscoveryCandidates(snapshot) {
  if (Array.isArray(snapshot?.publishedCandidates)) return snapshot.publishedCandidates.map((x) => ({ ...x, discoveryOnly: true }));
  if (Array.isArray(snapshot?.rows)) {
    return [...snapshot.rows]
      .filter((x) => x.liquidityExecutionEligible !== false && x.price > 0)
      .sort((a,b) => {
        const at = numericTurnover(a.turnover), bt = numericTurnover(b.turnover);
        if (at === null && bt === null) return String(a.ticker ?? '').localeCompare(String(b.ticker ?? ''));
        if (at === null) return 1;
        if (bt === null) return -1;
        return bt - at || String(a.ticker ?? '').localeCompare(String(b.ticker ?? ''));
      })
      .slice(0, 80)
      .map((x, i) => ({ ticker: x.ticker, nameAr: x.nameAr, nameEn: x.nameEn, rank: i + 1, discoveryOnly: true, turnoverKnown: numericTurnover(x.turnover) !== null }));
  }
  return [];
}

export function selectUniverseCandidates(historySummary, snapshot) {
  const candidates = currentHistoryCandidates(historySummary, snapshot);
  const discoveryOnlyCandidates = fallbackDiscoveryCandidates(snapshot);
  const readinessAssessment = historyReadinessAssessment(historySummary);
  const readinessExcludedCandidates = readinessAssessment.filter((x) => x.reasonCodes.length > 0);
  return {
    candidates,
    discoveryOnlyCandidates,
    readinessExcludedCandidates,
    universeMode: candidates.length ? 'CURRENT_HISTORY_FULL_MARKET_WITH_V20_NATIVE_OVERLAY' : 'DATA_READINESS_BLOCKED_NO_CURRENT_HISTORY',
    readinessGate: {
      failClosed: true,
      fallbackMayEnterRanking: false,
      currentHistoryCandidates: candidates.length,
      readinessExcludedBeforeScan: readinessExcludedCandidates.length,
      discoveryOnlyCandidates: discoveryOnlyCandidates.length,
    },
  };
}

export async function loadUniverse() {
  const [snapshot, historySummary] = await Promise.all([loadDiscoverySnapshot(), loadHistorySummary()]);
  const selection = selectUniverseCandidates(historySummary, snapshot);
  return {
    snapshot,
    historySummary,
    ...selection,
    expectedSessionDate: historySummary?.latestMarketSession ?? snapshot?.sessionDate ?? null,
    dataSources: DATA_SOURCES,
  };
}
