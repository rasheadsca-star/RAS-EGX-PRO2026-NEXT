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

function discoveryCandidates(snapshot) {
  if (Array.isArray(snapshot.publishedCandidates)) return snapshot.publishedCandidates;
  if (Array.isArray(snapshot.rows)) {
    return snapshot.rows
      .filter((x) => x.liquidityExecutionEligible !== false && x.price > 0)
      .sort((a,b) => (b.turnover ?? 0) - (a.turnover ?? 0))
      .slice(0, 40)
      .map((x, i) => ({ ticker: x.ticker, nameAr: x.nameAr, nameEn: x.nameEn, rank: i + 1 }));
  }
  return [];
}

export async function loadUniverse(limit = 30) {
  const snapshot = await loadDiscoverySnapshot();
  const candidates = discoveryCandidates(snapshot).slice(0, Math.max(1, Math.min(40, limit)));
  return { snapshot, candidates };
}
