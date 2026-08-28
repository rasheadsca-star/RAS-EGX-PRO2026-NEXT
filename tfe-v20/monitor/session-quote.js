const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const cache = globalThis.__RC2_SESSION_QUOTE_CACHE__ ?? (globalThis.__RC2_SESSION_QUOTE_CACHE__ = new Map());

const MONTHS = Object.freeze({
  january:1,february:2,march:3,april:4,may:5,june:6,
  july:7,august:8,september:9,october:10,november:11,december:12,
});

const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

export function stripHtml(html = '') {
  return decodeEntities(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function cairoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = type => parts.find((part) => part.type === type)?.value ?? null;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function parseClock(hourText, minuteText, meridiem) {
  let hour = Number(hourText) % 12;
  if (String(meridiem).toUpperCase() === 'PM') hour += 12;
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return {
    sourceMarketTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    sourceMarketMinutes: hour * 60 + minute,
  };
}

export function parseMarketTimestamp(label, now = new Date()) {
  const value = String(label ?? '');

  const dated = value.match(/(\d{1,2})\s+([A-Za-z]+)(?:\s+(20\d{2}))?\s+(\d{1,2}):(\d{2})\s+(AM|PM)/i);
  if (dated) {
    const day = Number(dated[1]);
    const month = MONTHS[dated[2].toLowerCase()] ?? null;
    const clock = parseClock(dated[4], dated[5], dated[6]);
    if (!month || !clock) return { sourceSessionDate: null, sourceMarketTime: null, sourceMarketMinutes: null };

    const cairoToday = cairoDate(now);
    const cairoYear = Number(cairoToday?.slice(0, 4)) || now.getUTCFullYear();
    let year = dated[3] ? Number(dated[3]) : cairoYear;
    const candidate = new Date(Date.UTC(year, month - 1, day));
    const nowDay = cairoToday ? new Date(`${cairoToday}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (!dated[3] && candidate.getTime() - nowDay.getTime() > 45 * 86400000) year -= 1;

    return {
      sourceSessionDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      ...clock,
    };
  }

  const timeOnly = value.match(/(\d{1,2}):(\d{2})\s+(AM|PM)/i);
  if (timeOnly) {
    const clock = parseClock(timeOnly[1], timeOnly[2], timeOnly[3]);
    return {
      sourceSessionDate: cairoDate(now),
      ...(clock ?? { sourceMarketTime: null, sourceMarketMinutes: null }),
    };
  }

  return { sourceSessionDate: null, sourceMarketTime: null, sourceMarketMinutes: null };
}

export function parseMubasherStockPage(html, ticker, now = new Date()) {
  const text = stripHtml(html);

  const header = text.match(/Last update:\s*((?:\d{1,2}\s+[A-Za-z]+(?:\s+20\d{2})?\s+)?\d{1,2}:\d{2}\s+(?:AM|PM)\s+market time\.?)/i);
  if (!header) throw new Error('QUOTE_HEADER_NOT_FOUND');

  const quoteStart = (header.index ?? 0) + header[0].length;
  const quoteText = text.slice(quoteStart);
  const numbers = quoteText.match(/^\s*([-+]?\d[\d,]*(?:\.\d+)?)\s+([-+]?\d[\d,]*(?:\.\d+)?)\s+([-+]?\d[\d,]*(?:\.\d+)?%)/i);
  if (!numbers) throw new Error('QUOTE_VALUES_NOT_FOUND');

  const tail = quoteText.slice(numbers[0].length);
  const after = label => {
    const r = new RegExp(`${label}\\s+([-+]?\\d[\\d,]*(?:\\.\\d+)?)`, 'i').exec(tail);
    return r ? num(r[1]) : null;
  };

  const stamp = parseMarketTimestamp(header[1], now);
  const quote = {
    ticker: String(ticker ?? '').trim().toUpperCase(),
    price: num(numbers[1]),
    change: num(numbers[2]),
    changePct: num(numbers[3]),
    open: after('Open'),
    previousClose: after('Previous Close'),
    high: after('High'),
    low: after('Low'),
    volume: after('Volume'),
    turnover: after('Turnover'),
    ...stamp,
    source: 'MUBASHER_STOCK_PAGE',
    delayedMinutes: 15,
    scoringImpact: 'NONE',
    monitorOnly: true,
  };

  if (!quote.sourceSessionDate || quote.sourceMarketMinutes === null) throw new Error('QUOTE_TIMESTAMP_INCOMPLETE');
  if (!(quote.price > 0) || !(quote.high > 0) || !(quote.low > 0) || !(quote.open > 0)) throw new Error('QUOTE_OHLC_INCOMPLETE');
  if (quote.high < Math.max(quote.open, quote.price) || quote.low > Math.min(quote.open, quote.price)) throw new Error('QUOTE_OHLC_INVALID');
  return quote;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Mozilla/5.0 EGX-TFE-RC2-Session-Monitor/1.1',
      },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMubasherQuote(ticker, { now = new Date(), force = false } = {}) {
  const symbol = String(ticker ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{2,12}$/.test(symbol)) throw new Error('INVALID_TICKER');
  const hit = cache.get(symbol);
  if (!force && hit?.expiresAt > Date.now()) return hit.quote;
  const url = `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`;
  const html = await fetchText(url);
  const quote = { ...parseMubasherStockPage(html, symbol, now), sourceUrl: url, fetchedAt: new Date().toISOString() };
  cache.set(symbol, { quote, expiresAt: Date.now() + CACHE_TTL_MS });
  return quote;
}
