#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URLS = [
  'https://www.mubasher.info/analysis-tools/stocks-support-resistance/EGX',
  'https://english.mubasher.info/analysis-tools/stocks-support-resistance/EGX/'
];
const OUT = path.resolve('data/mubasher-support-resistance-rendered.json');
const DEBUG = path.resolve('artifacts/mubasher-support-resistance');
const MIN_ROWS = Number(process.env.EGX_SR_MIN_ROWS || 80);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.mkdirSync(DEBUG, { recursive: true });

const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
function number(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v)
    .replace(/[٠-٩]/g, d => String(arabicDigits.indexOf(d)))
    .replace(/[٬،,\s%]/g, '')
    .replace(/٫/g, '.')
    .trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function key(k) {
  return String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function firstText(obj, patterns, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 2) return null;
  for (const [k, v] of Object.entries(obj)) {
    const nk = key(k);
    if (patterns.some(p => nk === p || nk.includes(p))) {
      const t = text(v);
      if (t) return t;
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const t = firstText(v, patterns, depth + 1);
      if (t) return t;
    }
  }
  return null;
}
function firstNumber(obj, patterns, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return null;
  for (const [k, v] of Object.entries(obj)) {
    const nk = key(k);
    if (patterns.some(p => nk === p || nk.includes(p))) {
      const n = number(v);
      if (n !== null) return n;
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nk = key(k);
      if (/support|resistance|pivot|level|technical|instant/.test(nk) || depth < 1) {
        const n = firstNumber(v, patterns, depth + 1);
        if (n !== null) return n;
      }
    }
  }
  return null;
}
function valuesUnder(obj, kind, depth = 0, out = []) {
  if (!obj || typeof obj !== 'object' || depth > 5) return out;
  for (const [k, v] of Object.entries(obj)) {
    const nk = key(k);
    if (nk.includes(kind)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          const n = number(item);
          if (n !== null && n > 0) out.push(n);
          else if (item && typeof item === 'object') {
            for (const x of Object.values(item)) {
              const nx = number(x);
              if (nx !== null && nx > 0) out.push(nx);
            }
          }
        }
      } else {
        const n = number(v);
        if (n !== null && n > 0) out.push(n);
        else if (v && typeof v === 'object') {
          for (const x of Object.values(v)) {
            const nx = number(x);
            if (nx !== null && nx > 0) out.push(nx);
          }
        }
      }
    }
    if (v && typeof v === 'object') valuesUnder(v, kind, depth + 1, out);
  }
  return out;
}
function normalizeSymbol(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/\.CA$/, '')
    .replace(/[^A-Z0-9.]/g, '');
}
function symbolFromObject(obj) {
  let s = firstText(obj, ['symbol','stocksymbol','ticker','shortcode','securitycode','code']);
  if (s) {
    s = normalizeSymbol(s);
    if (/^[A-Z0-9.]{2,12}$/.test(s)) return s;
  }
  const url = firstText(obj, ['url','href','link','stockurl','detailsurl']);
  const m = String(url || '').match(/\/stocks\/([A-Za-z0-9.]+)/i);
  return m ? normalizeSymbol(m[1]) : '';
}
function candidate(obj, sourceUrl) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  let support1 = firstNumber(obj, ['support1','firstsupport','supportlevel1','supportone','s1']);
  let support2 = firstNumber(obj, ['support2','secondsupport','supportlevel2','supporttwo','s2']);
  let resistance1 = firstNumber(obj, ['resistance1','firstresistance','resistancelevel1','resistanceone','r1']);
  let resistance2 = firstNumber(obj, ['resistance2','secondresistance','resistancelevel2','resistancetwo','r2']);

  const supports = [...new Set(valuesUnder(obj, 'support').filter(n => n > 0))].sort((a,b) => b-a);
  const resistances = [...new Set(valuesUnder(obj, 'resistance').filter(n => n > 0))].sort((a,b) => a-b);
  if (support1 === null && supports.length) support1 = supports[0];
  if (support2 === null && supports.length > 1) support2 = supports[1];
  if (resistance1 === null && resistances.length) resistance1 = resistances[0];
  if (resistance2 === null && resistances.length > 1) resistance2 = resistances[1];

  if (!(support1 > 0 && resistance1 > 0 && support1 < resistance1)) return null;

  const symbol = symbolFromObject(obj);
  const name = firstText(obj, ['companyname','stockname','securityname','name','company']);
  const lastPrice = firstNumber(obj, ['lastprice','currentprice','marketprice','closeprice','price','last']);
  const pivot = firstNumber(obj, ['pivotpoint','pivot','pp']);
  const updatedAt = firstText(obj, ['updatedat','lastupdate','updatetime','timestamp']);

  return {
    symbol,
    name,
    lastPrice,
    pivot,
    support1,
    support2,
    resistance1,
    resistance2,
    updatedAt,
    sourceUrl
  };
}
function walk(value, sourceUrl, rows, seen = new Set(), depth = 0) {
  if (value === null || value === undefined || depth > 14) return;
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  const c = candidate(value, sourceUrl);
  if (c) rows.push(c);

  if (Array.isArray(value)) {
    for (const x of value.slice(0, 5000)) walk(x, sourceUrl, rows, seen, depth + 1);
  } else {
    for (const x of Object.values(value).slice(0, 5000)) walk(x, sourceUrl, rows, seen, depth + 1);
  }
}
function parseJsonLike(body) {
  const t = String(body || '').trim();
  if (!t) return [];
  const values = [];
  const attempts = [t];
  const jsonp = t.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
  if (jsonp) attempts.push(jsonp[1]);
  const assignment = t.match(/^[\w.$]+\s*=\s*([\[{][\s\S]*[\]}])\s*;?\s*$/);
  if (assignment) attempts.push(assignment[1]);
  for (const a of attempts) {
    try { values.push(JSON.parse(a)); } catch {}
  }
  return values;
}
function rowScore(r) {
  return [
    r.symbol, r.name, r.lastPrice, r.pivot,
    r.support1, r.support2, r.resistance1, r.resistance2
  ].filter(v => v !== null && v !== undefined && v !== '').length;
}
function normalizedName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}
function dedupe(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!(r.support1 > 0 && r.resistance1 > 0 && r.support1 < r.resistance1)) continue;
    const k = r.symbol ? `S:${r.symbol}` : normalizedName(r.name) ? `N:${normalizedName(r.name)}` : '';
    if (!k) continue;
    const old = map.get(k);
    if (!old || rowScore(r) > rowScore(old)) map.set(k, r);
  }
  return [...map.values()];
}
async function inspectUrl(browser, url, attempt) {
  const rows = [];
  const network = [];
  const consoleLog = [];
  const failed = [];
  const rawPayloads = [];
  const context = await browser.newContext({
    locale: url.includes('english.') ? 'en-US' : 'ar-EG',
    timezoneId: 'Africa/Cairo',
    viewport: { width: 1600, height: 1800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'accept-language': url.includes('english.') ? 'en-US,en;q=0.9' : 'ar-EG,ar;q=0.9,en;q=0.7'
    }
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.__EGX_CAPTURED__ = [];
    const oldFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await oldFetch(...args);
      try {
        const clone = response.clone();
        clone.text().then(body => {
          if (body && body.length < 8_000_000) {
            window.__EGX_CAPTURED__.push({ url: response.url, body });
          }
        }).catch(() => {});
      } catch {}
      return response;
    };
    const oldOpen = XMLHttpRequest.prototype.open;
    const oldSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__egxUrl = url;
      return oldOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('load', function() {
        try {
          const body = this.responseText;
          if (body && body.length < 8_000_000) {
            window.__EGX_CAPTURED__.push({ url: String(this.responseURL || this.__egxUrl || ''), body });
          }
        } catch {}
      });
      return oldSend.apply(this, arguments);
    };
  });

  const page = await context.newPage();
  page.on('console', m => consoleLog.push({ type: m.type(), text: m.text() }));
  page.on('requestfailed', req => failed.push({ url: req.url(), error: req.failure()?.errorText }));
  page.on('response', async response => {
    const item = { url: response.url(), status: response.status(), contentType: response.headers()['content-type'] || '' };
    network.push(item);
    try {
      const body = await response.text();
      if (!body || body.length > 8_000_000) return;
      if (
        /json|javascript|text|octet-stream/i.test(item.contentType) ||
        /support|resistance|analysis|stock|technical|pivot/i.test(item.url + body.slice(0, 1000))
      ) {
        const parsed = parseJsonLike(body);
        for (const value of parsed) walk(value, item.url, rows);
        if (/support|resistance|pivot|lastPrice|changePercentage/i.test(body)) {
          rawPayloads.push({ url: item.url, status: item.status, contentType: item.contentType, body: body.slice(0, 2_000_000) });
        }
      }
    } catch {}
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(12000);

  for (const label of [/إظهار جميع النتائج/i, /All results/i, /Show all/i]) {
    try {
      const button = page.getByText(label).first();
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click({ timeout: 5000 });
        await page.waitForTimeout(5000);
      }
    } catch {}
  }

  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
  }
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}

  // Angular scopes and DOM-bound row objects.
  try {
    const scoped = await page.evaluate(() => {
      const output = [];
      const seen = new Set();
      function plain(v, depth = 0) {
        if (depth > 8 || v === null || v === undefined) return null;
        if (typeof v !== 'object') return v;
        if (seen.has(v)) return null;
        seen.add(v);
        if (Array.isArray(v)) return v.slice(0, 2000).map(x => plain(x, depth + 1));
        const o = {};
        for (const [k, x] of Object.entries(v).slice(0, 2000)) {
          if (k.startsWith('$') || typeof x === 'function') continue;
          o[k] = plain(x, depth + 1);
        }
        return o;
      }
      const ng = window.angular;
      if (ng) {
        document.querySelectorAll('[ng-repeat], tr').forEach(el => {
          try {
            const scope = ng.element(el).scope();
            if (scope) {
              for (const k of ['row','item','stock','data','result','results','rows']) {
                if (scope[k]) output.push(plain(scope[k]));
              }
            }
          } catch {}
        });
      }
      return output;
    });
    walk(scoped, `${url}#angular-scope`, rows);
  } catch {}

  // Data captured by injected fetch/XHR hooks.
  try {
    const captured = await page.evaluate(() => window.__EGX_CAPTURED__ || []);
    for (const item of captured) {
      for (const value of parseJsonLike(item.body)) walk(value, item.url || `${url}#captured`, rows);
    }
  } catch {}

  // Persist full diagnostics.
  const prefix = `attempt-${attempt}-${url.includes('english.') ? 'en' : 'ar'}`;
  await page.screenshot({ path: path.join(DEBUG, `${prefix}.png`), fullPage: true });
  fs.writeFileSync(path.join(DEBUG, `${prefix}.html`), await page.content());
  fs.writeFileSync(path.join(DEBUG, `${prefix}-network.json`), JSON.stringify(network, null, 2));
  fs.writeFileSync(path.join(DEBUG, `${prefix}-console.json`), JSON.stringify(consoleLog, null, 2));
  fs.writeFileSync(path.join(DEBUG, `${prefix}-failed.json`), JSON.stringify(failed, null, 2));
  fs.writeFileSync(path.join(DEBUG, `${prefix}-payloads.json`), JSON.stringify(rawPayloads, null, 2));

  await context.close();
  return rows;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--lang=ar-EG'
    ]
  });

  const all = [];
  let attempt = 0;
  try {
    for (const url of URLS) {
      attempt += 1;
      const rows = await inspectUrl(browser, url, attempt);
      all.push(...rows);
    }
  } finally {
    await browser.close();
  }

  const rows = dedupe(all);
  const result = {
    ok: rows.length >= MIN_ROWS,
    generatedAt: new Date().toISOString(),
    source: 'Mubasher rendered support/resistance page',
    sourceUrls: URLS,
    count: rows.length,
    minimumRequiredRows: MIN_ROWS,
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(`Verified rendered Mubasher support/resistance rows: ${rows.length}`);

  if (rows.length < MIN_ROWS) {
    console.error(`Insufficient verified rows: ${rows.length} < ${MIN_ROWS}. No market data will be published.`);
    process.exit(2);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
