const REPO = 'rasheadsca-star/RAS-EGX-PRO2026-NEXT';
const BRANCH = 'develop/v20-integrated-decision-platform';
const RAW = 'https://raw.githubusercontent.com';

export async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'TFE-V20-FUSION-RC1' } });
  if (!r.ok) throw new Error(`HTTP_${r.status}:${url}`);
  return r.json();
}

export const rawUrl = (branch, path) => `${RAW}/${REPO}/${branch}/${path}`;

export async function loadDiscoverySnapshot() {
  try { return await fetchJson(rawUrl(BRANCH, 'data/v20/native-current.json')); }
  catch { return await fetchJson(rawUrl(BRANCH, 'data/v20/current-market-snapshot.json')); }
}

export async function loadHistorySummary() {
  try { return await fetchJson(rawUrl('main', 'data/history-summary.json')); }
  catch { return null; }
}

export async function loadV17() {
  try { return await fetchJson(rawUrl(BRANCH, 'data/v17/current.json')); }
  catch { return null; }
}

export async function loadHistory(ticker) {
  const paths = [
    rawUrl('main', `data/history/${ticker}.json`),
    rawUrl(BRANCH, `data/history/${ticker}.json`),
  ];
  let lastErr;
  for (const url of paths) {
    try {
      const d = await fetchJson(url);
      return { rows: d.sessions ?? d.rows ?? [], meta: d, sourceUrl: url };
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error(`HISTORY_NOT_FOUND:${ticker}`);
}

function nativeCandidateMap(snapshot) {
  const map = new Map();
  const rows = Array.isArray(snapshot?.publishedCandidates) ? snapshot.publishedCandidates : [];
  for (const x of rows) map.set(String(x.ticker ?? '').toUpperCase(), x);
  return map;
}

function currentHistoryCandidates(summary, snapshot) {
  if (!Array.isArray(summary?.symbols) || !summary.latestMarketSession) return [];
  const nativeMap = nativeCandidateMap(snapshot);
  return summary.symbols
    .filter((x) => x.symbolVerified === true && (x.availableSessions ?? 0) >= 60 && !x.staleData && !x.updateFailed && x.lastSession === summary.latestMarketSession)
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

function fallbackDiscoveryCandidates(snapshot) {
  if (Array.isArray(snapshot?.publishedCandidates)) return snapshot.publishedCandidates;
  if (Array.isArray(snapshot?.rows)) {
    return snapshot.rows
      .filter((x) => x.liquidityExecutionEligible !== false && x.price > 0)
      .sort((a,b) => (b.turnover ?? 0) - (a.turnover ?? 0))
      .slice(0, 80)
      .map((x, i) => ({ ticker: x.ticker, nameAr: x.nameAr, nameEn: x.nameEn, rank: i + 1 }));
  }
  return [];
}

export async function loadUniverse() {
  const [snapshot, historySummary] = await Promise.all([loadDiscoverySnapshot(), loadHistorySummary()]);
  const fresh = currentHistoryCandidates(historySummary, snapshot);
  const candidates = fresh.length ? fresh : fallbackDiscoveryCandidates(snapshot);
  return {
    snapshot,
    historySummary,
    candidates,
    expectedSessionDate: historySummary?.latestMarketSession ?? snapshot?.sessionDate ?? null,
    universeMode: fresh.length ? 'CURRENT_HISTORY_FULL_MARKET_WITH_V20_NATIVE_OVERLAY' : 'V20_NATIVE_FALLBACK',
  };
}
