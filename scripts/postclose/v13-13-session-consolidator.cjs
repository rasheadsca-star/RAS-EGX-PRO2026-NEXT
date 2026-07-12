#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const HISTORY = path.join(DATA, 'history');
const POST = path.join(DATA, 'postclose');
const FILES = {
  policy: path.join(DATA, 'v13-13-daily-pipeline-policy.json'),
  market: path.join(DATA, 'market.json'),
  lastGood: path.join(DATA, 'last-good-market.json'),
  fullCache: path.join(DATA, 'full-market-cache.json'),
  symbolMap: path.join(DATA, 'symbol-map.json'),
  eligibility: path.join(DATA, 'history-eligibility.json'),
  latestReport: path.join(POST, 'latest-v13-13.json'),
  historyReport: path.join(POST, 'history-v13-13.json')
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
function rowsOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc?.rows)) return doc.rows;
  if (Array.isArray(doc?.stocks)) return doc.stocks;
  return [];
}
function cairoParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value).reduce((acc, part) => (acc[part.type] = part.value, acc), {});
  return {
    weekday: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`
  };
}
function validDate(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
function sourceStamp(row, doc) {
  const value = row.updatedAt || row.fetchedAt || doc.updatedAt || doc.generatedAt;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}
function sourceAgeMinutes(stamp, now) {
  const parsed = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(parsed) ? (now.getTime() - parsed) / 60000 : null;
}
function normalizeMarketRow(row, doc) {
  const ticker = safeTicker(row.symbol || row.ticker);
  const close = n(row.price ?? row.last ?? row.lastPrice ?? row.close);
  const valueTraded = n(row.valueTraded ?? row.turnover ?? row.value ?? row.tradedValue);
  return {
    ticker,
    open: n(row.open),
    high: n(row.high),
    low: n(row.low),
    close,
    volume: n(row.volume),
    previousClose: n(row.previousClose ?? row.prevClose),
    turnover: valueTraded,
    valueTraded,
    changePct: n(row.changePct ?? row.changePercent),
    source: row.source || doc.source || 'public_delayed',
    sourceUrl: row.sourceUrl || doc.sourceUrl || null,
    updatedAt: sourceStamp(row, doc)
  };
}
function validateOhlcv(row) {
  const reasons = [];
  if (!row.ticker) reasons.push('missing_ticker');
  for (const key of ['open', 'high', 'low', 'close', 'volume']) {
    if (!Number.isFinite(Number(row[key]))) reasons.push(`missing_${key}`);
  }
  if (!(n(row.open, 0) > 0)) reasons.push('invalid_open');
  if (!(n(row.high, 0) > 0)) reasons.push('invalid_high');
  if (!(n(row.low, 0) > 0)) reasons.push('invalid_low');
  if (!(n(row.close, 0) > 0)) reasons.push('invalid_close');
  if (!(n(row.volume, -1) >= 0)) reasons.push('invalid_volume');
  if (n(row.high, 0) < Math.max(n(row.open, 0), n(row.close, 0))) reasons.push('high_below_open_or_close');
  if (n(row.low, 0) > Math.min(n(row.open, 0), n(row.close, 0))) reasons.push('low_above_open_or_close');
  return reasons;
}
function historyRows(doc) {
  const source = Array.isArray(doc) ? doc
    : Array.isArray(doc?.sessions) ? doc.sessions
    : Array.isArray(doc?.rows) ? doc.rows
    : Array.isArray(doc?.history) ? doc.history
    : [];
  return source.map(row => ({
    ...row,
    date: validDate(row.date || row.sessionDate || row.session)
  })).filter(row => row.date).sort((a, b) => a.date.localeCompare(b.date));
}
function injectRows(doc, rows, policy, sessionDate, marketRow) {
  const trimmed = rows.slice(-Math.max(100, n(policy.consolidation.maximumHistorySessions, 180)));
  if (Array.isArray(doc)) return trimmed;
  const out = { ...(doc || {}) };
  if (Array.isArray(out.sessions) || (!Array.isArray(out.rows) && !Array.isArray(out.history))) {
    out.sessions = trimmed;
  } else if (Array.isArray(out.rows)) {
    out.rows = trimmed;
  } else {
    out.history = trimmed;
  }
  out.ticker = out.ticker || marketRow.ticker;
  out.lastSession = sessionDate;
  out.sessionsCount = trimmed.length;
  out.updatedAt = new Date().toISOString();
  out.lastUpdateSource = marketRow.source;
  out.staleData = false;
  out.updateFailed = false;
  return out;
}
function eligibleTickers() {
  const rawEligibility = readJson(FILES.eligibility, {});
  const items = Array.isArray(rawEligibility) ? rawEligibility : A(rawEligibility?.items);
  const eligible = items
    .filter(item => item.active !== false && item.delisted !== true &&
      (item.decisionEligible === true || item.paperTradingEligible === true ||
       ['complete_100', 'eligible', 'accepted'].includes(String(item.status || '').toLowerCase())))
    .map(item => safeTicker(item.ticker))
    .filter(Boolean);
  if (eligible.length) return [...new Set(eligible)];

  const rawMap = readJson(FILES.symbolMap, {});
  const mapItems = Array.isArray(rawMap) ? rawMap
    : Object.entries(rawMap || {}).map(([key, value]) => ({ ...(value || {}), ticker: value?.ticker || key }));
  const fromMap = mapItems.filter(item => item.active !== false).map(item => safeTicker(item.ticker)).filter(Boolean);
  if (fromMap.length) return [...new Set(fromMap)];

  return fs.existsSync(HISTORY)
    ? fs.readdirSync(HISTORY).filter(name => name.endsWith('.json')).map(name => safeTicker(name.replace(/\.json$/i, '')))
    : [];
}
function latestMarketDocument() {
  const docs = [
    { name: 'market', doc: readJson(FILES.market, {}) },
    { name: 'last_good_market', doc: readJson(FILES.lastGood, {}) },
    { name: 'full_market_cache', doc: readJson(FILES.fullCache, {}) }
  ].filter(item => rowsOf(item.doc).length > 0);
  docs.sort((a, b) => {
    const at = Date.parse(a.doc.updatedAt || a.doc.generatedAt || 0) || 0;
    const bt = Date.parse(b.doc.updatedAt || b.doc.generatedAt || 0) || 0;
    return bt - at;
  });
  return docs[0] || { name: 'none', doc: {} };
}
function main() {
  const now = new Date();
  const generatedAt = now.toISOString();
  const cairoNow = cairoParts(now);
  const policy = readJson(FILES.policy);
  if (!policy) throw new Error('Missing data/v13-13-daily-pipeline-policy.json');
  if (!fs.existsSync(HISTORY)) throw new Error('Missing data/history');

  const source = latestMarketDocument();
  const sourceDate = cairoParts(new Date(source.doc.updatedAt || source.doc.generatedAt || now)).date;
  const sourceStampValue = new Date(source.doc.updatedAt || source.doc.generatedAt || now).toISOString();
  const sourceAge = sourceAgeMinutes(sourceStampValue, now);
  const sessionDate = String(process.env.V13_13_SESSION_DATE || '').trim() || sourceDate;
  const tradingDays = new Set(policy.schedule.tradingDays || []);
  const sessionWeekday = cairoParts(new Date(`${sessionDate}T10:00:00+03:00`)).weekday;

  const marketMap = new Map();
  for (const raw of rowsOf(source.doc)) {
    const row = normalizeMarketRow(raw, source.doc);
    if (!row.ticker) continue;
    const current = marketMap.get(row.ticker);
    if (!current || Date.parse(row.updatedAt || 0) > Date.parse(current.updatedAt || 0)) {
      marketMap.set(row.ticker, row);
    }
  }

  const eligible = eligibleTickers();
  const rejected = [];
  const staged = [];
  let alreadyPresent = 0;
  let unchanged = 0;

  const globalProblems = [];
  if (!tradingDays.has(sessionWeekday)) globalProblems.push('session_date_is_not_trading_day');
  if (policy.consolidation.requireSameCairoDate && sourceDate !== sessionDate) globalProblems.push('source_date_mismatch');
  if (sourceAge === null || sourceAge > n(policy.consolidation.maximumSourceAgeMinutes, 240)) globalProblems.push('source_too_old');

  for (const symbol of eligible) {
    const market = marketMap.get(symbol);
    if (!market) {
      rejected.push({ ticker: symbol, reasons: ['missing_market_row'] });
      continue;
    }
    const validation = validateOhlcv(market);
    if (validation.length) {
      rejected.push({ ticker: symbol, reasons: validation });
      continue;
    }
    const file = path.join(HISTORY, `${symbol}.json`);
    const doc = readJson(file, null);
    if (!doc) {
      rejected.push({ ticker: symbol, reasons: ['missing_history_file'] });
      continue;
    }
    const rows = historyRows(doc);
    const previous = rows.at(-1) || null;
    if (previous?.date && previous.date > sessionDate) {
      rejected.push({ ticker: symbol, reasons: ['history_newer_than_session'] });
      continue;
    }
    if (previous && n(market.previousClose) > 0 && n(previous.close) > 0) {
      const mismatch = Math.abs((n(market.previousClose) / n(previous.close) - 1) * 100);
      if (mismatch > n(policy.consolidation.maximumPreviousCloseMismatchPct, 12)) {
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
      open: round(market.open, 4),
      high: round(market.high, 4),
      low: round(market.low, 4),
      close: round(market.close, 4),
      volume: Math.round(n(market.volume, 0)),
      turnover: round(market.turnover, 2),
      valueTraded: round(market.valueTraded, 2),
      previousClose: round(market.previousClose, 4),
      changePct: round(market.changePct, 3),
      source: market.source,
      sourceUrl: market.sourceUrl,
      fetchedAt: market.updatedAt,
      consolidatedBy: 'v13-13-post-close'
    };

    const index = rows.findIndex(row => row.date === sessionDate);
    if (index >= 0) {
      alreadyPresent += 1;
      const old = rows[index];
      const same = ['open', 'high', 'low', 'close', 'volume'].every(key => n(old[key]) === n(sessionRow[key]));
      if (same) {
        unchanged += 1;
        continue;
      }
      if (policy.consolidation.allowSameSessionReplacement !== true) {
        rejected.push({ ticker: symbol, reasons: ['same_session_replacement_disabled'] });
        continue;
      }
      rows[index] = { ...old, ...sessionRow };
    } else {
      rows.push(sessionRow);
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    staged.push({
      ticker: symbol,
      file,
      output: injectRows(doc, rows, policy, sessionDate, market),
      action: index >= 0 ? 'replaced' : 'appended'
    });
  }

  const acceptedCount = staged.length + unchanged;
  const coveragePct = eligible.length ? acceptedCount / eligible.length * 100 : 0;
  const targetPassed = globalProblems.length === 0 &&
    acceptedCount >= n(policy.consolidation.minimumAcceptedSymbols, 100) &&
    coveragePct >= n(policy.consolidation.minimumCoveragePct, 75);

  let status = 'INSUFFICIENT_COVERAGE';
  if (targetPassed && staged.length === 0 && unchanged > 0) status = 'ALREADY_CONSOLIDATED';
  else if (targetPassed) status = 'CONSOLIDATED';

  const report = {
    schemaVersion: '13.13.0',
    generatedAt,
    cairoTime: `${cairoNow.date} ${cairoNow.time}`,
    status,
    sessionDate,
    sourceDate,
    sourceName: source.name,
    sourceLabel: source.doc.source || null,
    sourceUpdatedAt: sourceStampValue,
    sourceAgeMinutes: round(sourceAge, 1),
    globalProblems,
    counts: {
      eligibleSymbols: eligible.length,
      marketRows: marketMap.size,
      stagedChanges: staged.length,
      appended: staged.filter(item => item.action === 'appended').length,
      replaced: staged.filter(item => item.action === 'replaced').length,
      alreadyPresent,
      unchanged,
      acceptedCoverage: acceptedCount,
      rejected: rejected.length
    },
    coveragePct: round(coveragePct, 2),
    minimumCoveragePct: n(policy.consolidation.minimumCoveragePct, 75),
    minimumAcceptedSymbols: n(policy.consolidation.minimumAcceptedSymbols, 100),
    targetPassed,
    rejected: rejected.slice(0, 300),
    changedTickers: staged.map(item => item.ticker)
  };

  const previousHistory = readJson(FILES.historyReport, { runs: [] });
  const historyReport = {
    schemaVersion: '13.13.0',
    updatedAt: generatedAt,
    runs: [report, ...A(previousHistory.runs)]
      .filter((item, index, list) => list.findIndex(x => x.generatedAt === item.generatedAt) === index)
      .slice(0, 60)
  };

  if (!targetPassed) {
    writeJson(FILES.latestReport, report);
    writeJson(FILES.historyReport, historyReport);
    console.error(`V13.13 consolidation blocked: ${acceptedCount}/${eligible.length} (${round(coveragePct, 2)}%), problems=${globalProblems.join(',') || 'coverage'}`);
    process.exit(2);
  }

  for (const item of staged) writeJson(item.file, item.output);
  writeJson(FILES.latestReport, report);
  writeJson(FILES.historyReport, historyReport);
  console.log(`V13.13 ${status}: session=${sessionDate}, accepted=${acceptedCount}/${eligible.length} (${round(coveragePct, 2)}%), changed=${staged.length}`);
}

try { main(); }
catch (error) {
  console.error(`V13.13 consolidation failed: ${error.stack || error.message}`);
  process.exit(1);
}
