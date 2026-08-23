'use strict';

const fs = require('fs');
const path = require('path');
const {
  extractRows,
  getFirst,
  readJson,
  safeTicker,
  toNumber,
} = require('../lib/utils.cjs');

const DEFAULT_FILES = [
  'data/full-market-cache.json',
  'data/final-opportunity-ranking.json',
  'data/final-multisource-ranking.json',
  'data/price-source-audit.json',
];

const DEFAULT_MAX_REFERENCE_AGE_DAYS = 7;

function sourceName(row, file) {
  const text = String(getFirst(row, [
    'primarySource', 'source', 'priceSource', 'sourceName', 'evidence.source', 'marketSource',
  ]) || path.basename(file)).toLowerCase();
  if (text.includes('mubasher')) return 'mubasher_existing_cache';
  if (text.includes('egx')) return 'egx_existing_cache';
  if (text.includes('investing')) return 'investing_existing_cache';
  return `pro2026_existing:${path.basename(file)}`;
}

function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isTrustedIndependentSource(source) {
  return /^(egx_|mubasher_|investing_)/.test(String(source || ''));
}

function ageDays(date, nowMs = Date.now()) {
  if (!date) return null;
  const time = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (nowMs - time) / 86400000);
}

function normalizeRow(row, file, fileAsOf = null) {
  const ticker = safeTicker(getFirst(row, ['symbol', 'ticker', 'code', 'stockCode', 'securityCode']));
  if (!ticker) return null;
  const close = toNumber(getFirst(row, ['close', 'price', 'lastPrice', 'currentPrice', 'last', 'market.close', 'quote.close']));
  if (!close || close <= 0) return null;
  const source = sourceName(row, file);
  const date = dateOnly(getFirst(row, [
    'date', 'sessionDate', 'asOfDate', 'market.date', 'quote.date',
    'fetchedAt', 'updatedAt', 'cacheUpdatedAt',
  ]) || fileAsOf);
  return {
    ticker,
    close,
    open: toNumber(getFirst(row, ['open', 'market.open', 'quote.open'])),
    high: toNumber(getFirst(row, ['high', 'market.high', 'quote.high'])),
    low: toNumber(getFirst(row, ['low', 'market.low', 'quote.low'])),
    volume: toNumber(getFirst(row, ['volume', 'market.volume', 'quote.volume'])),
    date,
    source,
    sourceFile: file,
  };
}

function loadLocalReferences(repoRoot) {
  const references = new Map();
  const configuredMaxAge = Number(process.env.HISTORY_LOCAL_REFERENCE_MAX_AGE_DAYS || DEFAULT_MAX_REFERENCE_AGE_DAYS);
  const maxAgeDays = Number.isFinite(configuredMaxAge) && configuredMaxAge >= 0
    ? configuredMaxAge
    : DEFAULT_MAX_REFERENCE_AGE_DAYS;

  for (const relative of DEFAULT_FILES) {
    const file = path.join(repoRoot, relative);
    if (!fs.existsSync(file)) continue;
    const parsed = readJson(file, null);
    const fileAsOf = getFirst(parsed, ['generatedAt', 'updatedAt', 'asOfDate', 'date']);
    const extracted = extractRows(parsed);
    const rows = extracted.length ? extracted : (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.values(parsed).filter((value) => value && typeof value === 'object') : []);
    for (const row of rows) {
      const normalized = normalizeRow(row, relative, fileAsOf);
      if (!normalized) continue;

      // Only independent market references may validate or conflict with Yahoo history.
      // Internal ranking/audit outputs are derivative data and must never create a
      // PRICE_RECONCILIATION_REQUIRED hold by themselves.
      if (!isTrustedIndependentSource(normalized.source)) continue;

      // A reference without an as-of date, or one older than the bounded freshness
      // window, is not safe evidence for the latest daily close.
      const referenceAgeDays = ageDays(normalized.date);
      if (referenceAgeDays === null || referenceAgeDays > maxAgeDays) continue;

      if (!references.has(normalized.ticker)) references.set(normalized.ticker, normalized);
    }
  }
  return references;
}

module.exports = {
  loadLocalReferences,
  normalizeRow,
  isTrustedIndependentSource,
  ageDays,
};
