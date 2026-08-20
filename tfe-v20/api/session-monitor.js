import { fetchMubasherQuote } from '../monitor/session-quote.js';

const MAX_TICKERS = 10;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-tfe-monitor', 'SESSION_MONITOR_V1');
  res.end(JSON.stringify(body));
}

function parseTickers(value) {
  return [...new Set(String(value ?? '')
    .split(',')
    .map(x => x.trim().toUpperCase())
    .filter(x => /^[A-Z0-9._-]{2,12}$/.test(x)))]
    .slice(0, MAX_TICKERS);
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const tickers = parseTickers(url.searchParams.get('tickers'));
    if (!tickers.length) return json(res, 400, { ok:false, error:'tickers is required' });
    const force = url.searchParams.get('force') === '1';
    const settled = await Promise.allSettled(tickers.map(ticker => fetchMubasherQuote(ticker, { force })));
    const quotes = [];
    const errors = [];
    settled.forEach((result, index) => {
      const ticker = tickers[index];
      if (result.status === 'fulfilled') quotes.push(result.value);
      else {
        console.error('[SESSION_MONITOR_QUOTE_ERROR]', ticker, result.reason?.message ?? result.reason);
        errors.push({ ticker, error:'QUOTE_SOURCE_UNAVAILABLE' });
      }
    });
    return json(res, 200, {
      ok:true,
      monitor:'SESSION_MONITOR_V1',
      generatedAt:new Date().toISOString(),
      monitorOnly:true,
      scoringImpact:'NONE',
      recommendationMutationAllowed:false,
      executionAllowed:false,
      source:'MUBASHER_DELAYED_15_MIN',
      delayedMinutes:15,
      disclaimer:'Monitoring prices are delayed and are used only to update the observed status of already-frozen RC2 candidates. They do not alter Alpha, Fusion Rank, hard gates, or recommendations.',
      requested:tickers.length,
      returned:quotes.length,
      quotes,
      errors,
    });
  } catch (error) {
    console.error('[SESSION_MONITOR_INTERNAL_ERROR]', error?.stack ?? error?.message ?? error);
    return json(res, 500, { ok:false, error:'INTERNAL_SERVER_ERROR' });
  }
}
