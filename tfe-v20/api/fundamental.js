import { POLICY } from '../src/policy.js';
import { DATA_SOURCES, fetchJson, rawUrl } from '../src/repository.js';

const PATH = 'data/stable/v16-fundamental-analysis.json';

function applyHeaders(res) {
  res.setHeader('x-tfe-engine', POLICY.engineId);
  res.setHeader('x-tfe-module', 'RC2_AUTO_FUNDAMENTALS_V1');
}
function send(res, status, body) {
  res.statusCode = status;
  applyHeaders(res);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
function findRecord(document, ticker) {
  const pools = [document?.recommendationAnalysis, document?.records, document?.marketAnalysis, document?.allAnalysis, document?.analysis, document?.companies, document?.rows];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    const hit = pool.find((row) => String(row?.ticker ?? '').trim().toUpperCase() === ticker);
    if (hit) return hit;
  }
  return null;
}
async function loadTickerDocument(ticker) {
  const branches = [...new Set([DATA_SOURCES.alphaDataBranch, DATA_SOURCES.overlayBranch].filter(Boolean))];
  let firstLoaded = null;
  let lastError = null;
  for (const branch of branches) {
    try {
      const document = await fetchJson(rawUrl(branch, PATH), { ttlMs: 15 * 60 * 1000 });
      if (!firstLoaded) firstLoaded = { document, branch };
      const record = findRecord(document, ticker);
      if (record) return { document, branch, record };
    } catch (error) {
      lastError = error;
    }
  }
  if (firstLoaded) return { ...firstLoaded, record: null };
  throw lastError ?? new Error('FUNDAMENTAL_DATA_UNAVAILABLE');
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const ticker = String(url.searchParams.get('ticker') ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9._-]{2,12}$/.test(ticker)) return send(res, 400, { ok: false, error: 'valid ticker is required' });
    const { document, branch, record } = await loadTickerDocument(ticker);
    return send(res, 200, {
      ok: true, module: 'RC2_AUTO_FUNDAMENTALS_V1', ticker, found: Boolean(record),
      generatedAt: document?.generatedAt ?? null, schemaVersion: document?.schemaVersion ?? null,
      methodology: document?.methodology ?? null, marketSummary: document?.summary ?? null,
      dataBranch: branch, dataPath: PATH, record, uiOnly: true, scoringImpact: 'NONE',
      recommendationMutationAllowed: false, executionAllowed: false, automaticOrders: false,
      note: 'Fundamental analysis is supplemental and does not alter RC2 Alpha, hard gates, Fusion Rank, or publication state.',
    });
  } catch (error) {
    console.error('[RC2_FUNDAMENTAL_API]', error?.stack ?? error?.message ?? error);
    return send(res, 503, { ok: false, module: 'RC2_AUTO_FUNDAMENTALS_V1', error: 'FUNDAMENTAL_DATA_UNAVAILABLE', scoringImpact: 'NONE' });
  }
}
