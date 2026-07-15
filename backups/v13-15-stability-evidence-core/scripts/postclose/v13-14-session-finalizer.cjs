#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const HISTORY = path.join(DATA, 'history');
const POST = path.join(DATA, 'postclose');
const FILES = {
  policy: path.join(DATA, 'v13-14-unified-center-policy.json'),
  market: path.join(DATA, 'market.json'),
  lastGood: path.join(DATA, 'last-good-market.json'),
  fullCache: path.join(DATA, 'full-market-cache.json'),
  symbolMap: path.join(DATA, 'symbol-map.json'),
  eligibility: path.join(DATA, 'history-eligibility.json'),
  latestReport: path.join(POST, 'latest-v13-14.json'),
  historyReport: path.join(POST, 'history-v13-14.json')
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function A(value) { return Array.isArray(value) ? value : []; }
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
function cairoParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(value).reduce((acc, part) => (acc[part.type] = part.value, acc), {});
  return {
    weekday: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`
  };
}
function rowsOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc?.rows)) return doc.rows;
  if (Array.isArray(doc?.stocks)) return doc.stocks;
  return [];
}
function historyRows(doc) {
  const rows = Array.isArray(doc) ? doc
    : Array.isArray(doc?.sessions) ? doc.sessions
    : Array.isArray(doc?.rows) ? doc.rows
    : Array.isArray(doc?.history) ? doc.history
    : [];
  return rows.map(row => ({ ...row, date: dateOnly(row.date || row.sessionDate || row.session) }))
    .filter(row => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function validOHLCV(row) {
  const reasons = [];
  for (const key of ['open', 'high', 'low', 'close', 'volume']) {
    if (!Number.isFinite(Number(row?.[key]))) reasons.push(`missing_${key}`);
  }
  if (!(n(row?.open, 0) > 0)) reasons.push('invalid_open');
  if (!(n(row?.high, 0) > 0)) reasons.push('invalid_high');
  if (!(n(row?.low, 0) > 0)) reasons.push('invalid_low');
  if (!(n(row?.close, 0) > 0)) reasons.push('invalid_close');
  if (!(n(row?.volume, -1) >= 0)) reasons.push('invalid_volume');
  if (n(row?.high, 0) < Math.max(n(row?.open, 0), n(row?.close, 0))) reasons.push('high_below_open_or_close');
  if (n(row?.low, 0) > Math.min(n(row?.open, 0), n(row?.close, 0))) reasons.push('low_above_open_or_close');
  return reasons;
}
function sourceTimestamp(row, doc) {
  const raw = row?.updatedAt || row?.fetchedAt || row?.generatedAt || doc?.updatedAt || doc?.generatedAt;
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}
function ageMinutes(stamp, now) {
  const value = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(value) ? (now.getTime() - value) / 60000 : null;
}
function normalizeMarketRow(raw, doc, sourceName) {
  const close = n(raw.price ?? raw.lastPrice ?? raw.last ?? raw.close);
  const stamp = sourceTimestamp(raw, doc);
  return {
    ticker: safeTicker(raw.symbol || raw.ticker),
    open: n(raw.open), high: n(raw.high), low: n(raw.low), close,
    volume: n(raw.volume),
    previousClose: n(raw.previousClose ?? raw.prevClose),
    turnover: n(raw.valueTraded ?? raw.turnover ?? raw.value ?? raw.tradedValue),
    changePct: n(raw.changePct ?? raw.changePercent),
    source: raw.source || raw.priceSource || doc?.source || sourceName,
    sourceName,
    sourceUrl: raw.sourceUrl || doc?.sourceUrl || null,
    updatedAt: stamp,
    sourceDate: stamp ? cairoParts(new Date(stamp)).date : null
  };
}
function injectRows(doc, rows, policy, sessionDate, source) {
  const max = Math.max(100, n(policy.finalization.maximumHistorySessions, 180));
  const trimmed = rows.slice(-max);
  if (Array.isArray(doc)) return trimmed;
  const out = { ...(doc || {}) };
  if (Array.isArray(out.sessions) || (!Array.isArray(out.rows) && !Array.isArray(out.history))) out.sessions = trimmed;
  else if (Array.isArray(out.rows)) out.rows = trimmed;
  else out.history = trimmed;
  out.lastSession = sessionDate;
  out.sessionsCount = trimmed.length;
  out.updatedAt = new Date().toISOString();
  out.lastUpdateSource = source;
  out.staleData = false;
  out.updateFailed = false;
  return out;
}
function eligibleTickers() {
  const raw = readJson(FILES.eligibility, {});
  const items = Array.isArray(raw) ? raw : A(raw?.items);
  const eligible = items.filter(item => item.active !== false && item.delisted !== true && (
    item.decisionEligible === true || item.paperTradingEligible === true ||
    ['complete_100', 'eligible', 'accepted'].includes(String(item.status || '').toLowerCase())
  )).map(item => safeTicker(item.ticker)).filter(Boolean);
  if (eligible.length) return [...new Set(eligible)];

  const mapRaw = readJson(FILES.symbolMap, {});
  const mapItems = Array.isArray(mapRaw) ? mapRaw
    : Object.entries(mapRaw || {}).map(([key, value]) => ({ ...(value || {}), ticker: value?.ticker || key }));
  const mapped = mapItems.filter(item => item.active !== false).map(item => safeTicker(item.ticker)).filter(Boolean);
  if (mapped.length) return [...new Set(mapped)];

  return fs.existsSync(HISTORY)
    ? fs.readdirSync(HISTORY).filter(name => name.endsWith('.json')).map(name => safeTicker(name.replace(/\.json$/i, '')))
    : [];
}
function mergeSources() {
  const sources = [
    { name: 'market', doc: readJson(FILES.market, {}) },
    { name: 'last_good_market', doc: readJson(FILES.lastGood, {}) },
    { name: 'full_market_cache', doc: readJson(FILES.fullCache, {}) }
  ];
  const map = new Map();
  for (const source of sources) {
    for (const raw of rowsOf(source.doc)) {
      const row = normalizeMarketRow(raw, source.doc, source.name);
      if (!row.ticker) continue;
      const list = map.get(row.ticker) || [];
      list.push(row);
      map.set(row.ticker, list);
    }
  }
  for (const [ticker, rows] of map.entries()) {
    rows.sort((a, b) => {
      const aComplete = validOHLCV(a).length === 0 ? 1 : 0;
      const bComplete = validOHLCV(b).length === 0 ? 1 : 0;
      if (bComplete !== aComplete) return bComplete - aComplete;
      return (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0);
    });
    map.set(ticker, rows);
  }
  return map;
}
function main() {
  const now = new Date();
  const generatedAt = now.toISOString();
  const cairo = cairoParts(now);
  const sessionDate = String(process.env.V13_14_SESSION_DATE || '').trim() || cairo.date;
  const policy = readJson(FILES.policy);
  if (!policy) throw new Error('Missing data/v13-14-unified-center-policy.json');
  if (!fs.existsSync(HISTORY)) throw new Error('Missing data/history');

  const tradingDays = new Set(policy.schedule.tradingDays || []);
  const sessionWeekday = cairoParts(new Date(`${sessionDate}T10:00:00+03:00`)).weekday;
  const globalProblems = [];
  if (!tradingDays.has(sessionWeekday)) globalProblems.push('session_date_is_not_trading_day');

  const sourceMap = mergeSources();
  const eligible = eligibleTickers();
  const staged = [];
  const rejected = [];
  let alreadyValid = 0;
  let unchanged = 0;

  for (const symbol of eligible) {
    const file = path.join(HISTORY, `${symbol}.json`);
    const doc = readJson(file, null);
    if (!doc) {
      rejected.push({ ticker: symbol, reasons: ['missing_history_file'] });
      continue;
    }
    const rows = historyRows(doc);
    const existingIndex = rows.findIndex(row => row.date === sessionDate);
    if (existingIndex >= 0 && validOHLCV(rows[existingIndex]).length === 0) {
      alreadyValid += 1;
      unchanged += 1;
      continue;
    }

    const candidates = A(sourceMap.get(symbol)).filter(row =>
      row.sourceDate === sessionDate &&
      validOHLCV(row).length === 0 &&
      ageMinutes(row.updatedAt, now) !== null &&
      ageMinutes(row.updatedAt, now) <= n(policy.finalization.maximumSourceAgeMinutes, 360)
    );
    const market = candidates[0] || null;
    if (!market) {
      rejected.push({
        ticker: symbol,
        reasons: ['no_complete_same_day_ohlcv'],
        availableSources: A(sourceMap.get(symbol)).map(row => ({
          source: row.sourceName,
          sourceDate: row.sourceDate,
          missing: validOHLCV(row)
        })).slice(0, 6)
      });
      continue;
    }

    const previous = rows.filter(row => row.date < sessionDate).at(-1) || null;
    if (previous && n(market.previousClose) > 0 && n(previous.close) > 0) {
      const mismatch = Math.abs((n(market.previousClose) / n(previous.close) - 1) * 100);
      if (mismatch > n(policy.finalization.maximumPreviousCloseMismatchPct, 12)) {
        rejected.push({
          ticker: symbol,
          reasons: ['previous_close_mismatch'],
          mismatchPct: round(mismatch, 2),
          historyClose: n(previous.close),
          sourcePreviousClose: n(market.previousClose)
        });
        continue;
      }
    }

    const sessionRow = {
      date: sessionDate,
      sessionDate,
      open: round(market.open, 4), high: round(market.high, 4), low: round(market.low, 4),
      close: round(market.close, 4), volume: Math.round(n(market.volume, 0)),
      turnover: round(market.turnover, 2), valueTraded: round(market.turnover, 2),
      previousClose: round(market.previousClose, 4), changePct: round(market.changePct, 3),
      source: market.source, sourceUrl: market.sourceUrl, fetchedAt: market.updatedAt,
      consolidatedBy: 'v13-14-session-finalizer'
    };

    let action = 'appended';
    if (existingIndex >= 0) {
      if (policy.finalization.allowSameSessionReplacement !== true) {
        rejected.push({ ticker: symbol, reasons: ['same_session_replacement_disabled'] });
        continue;
      }
      rows[existingIndex] = { ...rows[existingIndex], ...sessionRow };
      action = 'replaced';
    } else {
      rows.push(sessionRow);
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    staged.push({ ticker: symbol, file, output: injectRows(doc, rows, policy, sessionDate, market.source), action });
  }

  const accepted = alreadyValid + staged.length;
  const coveragePct = eligible.length ? accepted / eligible.length * 100 : 0;
  const targetPassed = globalProblems.length === 0 &&
    accepted >= n(policy.finalization.minimumAcceptedSymbols, 100) &&
    coveragePct >= n(policy.finalization.minimumCoveragePct, 75);

  let status = 'INSUFFICIENT_COVERAGE';
  if (targetPassed && staged.length === 0) status = 'ALREADY_FINALIZED';
  else if (targetPassed) status = 'FINALIZED';

  const report = {
    schemaVersion: '13.14.0', generatedAt, cairoTime: `${cairo.date} ${cairo.time}`,
    sessionDate, status, globalProblems,
    counts: {
      eligibleSymbols: eligible.length,
      symbolsWithAnySource: sourceMap.size,
      alreadyValid,
      stagedChanges: staged.length,
      appended: staged.filter(item => item.action === 'appended').length,
      replaced: staged.filter(item => item.action === 'replaced').length,
      unchanged,
      acceptedCoverage: accepted,
      rejected: rejected.length
    },
    coveragePct: round(coveragePct, 2),
    minimumCoveragePct: n(policy.finalization.minimumCoveragePct, 75),
    minimumAcceptedSymbols: n(policy.finalization.minimumAcceptedSymbols, 100),
    targetPassed,
    changedTickers: staged.map(item => item.ticker),
    rejected: rejected.slice(0, 350)
  };
  const history = readJson(FILES.historyReport, { runs: [] });
  const historyReport = {
    schemaVersion: '13.14.0', updatedAt: generatedAt,
    runs: [report, ...A(history.runs)]
      .filter((item, index, list) => list.findIndex(x => x.generatedAt === item.generatedAt) === index)
      .slice(0, 90)
  };

  if (targetPassed) {
    for (const item of staged) writeJson(item.file, item.output);
  }
  writeJson(FILES.latestReport, report);
  writeJson(FILES.historyReport, historyReport);

  if (!targetPassed) {
    console.error(`V13.14 finalization pending: ${accepted}/${eligible.length} (${round(coveragePct, 2)}%)`);
    process.exit(2);
  }
  console.log(`V13.14 ${status}: ${accepted}/${eligible.length} (${round(coveragePct, 2)}%), changed=${staged.length}`);
}

try { main(); }
catch (error) {
  console.error(`V13.14 finalizer failed: ${error.stack || error.message}`);
  process.exit(1);
}
