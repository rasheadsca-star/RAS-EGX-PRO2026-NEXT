#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MARKET = path.resolve('data/market.json');
const SR = path.resolve('data/mubasher-support-resistance-rendered.json');
const REPORT = path.resolve('data/support-resistance-verification.json');
const MIN_COVERAGE = Number(process.env.EGX_SR_MIN_COVERAGE || 60);

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function symbol(v) {
  return String(v || '').toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
}
function name(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/end 1\s*-->/gi, ' ')
    .replace(/-->/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}
function valid(r) {
  return n(r?.support1) > 0 && n(r?.resistance1) > 0 && n(r.support1) < n(r.resistance1);
}
function sane(r, marketPrice) {
  if (!valid(r)) return false;
  const p = n(marketPrice);
  if (!(p > 0)) return true;
  const s = n(r.support1), x = n(r.resistance1);
  return s / p >= 0.35 && s / p <= 1.35 && x / p >= 0.70 && x / p <= 2.00;
}
function cleanOld(row) {
  row.support1 = null;
  row.support2 = null;
  row.resistance1 = null;
  row.resistance2 = null;
  row.pivot = null;
  row.pivotPoint = null;
  row.supportResistanceSource = null;
  row.supportResistanceUpdatedAt = null;
  if (row.sources?.mubasherRendered) delete row.sources.mubasherRendered;
}

const market = read(MARKET);
const source = read(SR);
if (!source.ok || !Array.isArray(source.rows)) {
  throw new Error('Rendered Mubasher support/resistance source is not valid.');
}
const rows = Array.isArray(market.rows) ? market.rows : [];
const bySymbol = new Map();
const byName = new Map();

for (const r of source.rows) {
  if (!valid(r)) continue;
  if (symbol(r.symbol)) bySymbol.set(symbol(r.symbol), r);
  if (name(r.name)) byName.set(name(r.name), r);
}

let merged = 0;
let rejected = 0;
let unmatched = 0;
const matchedSymbols = [];

for (const row of rows) {
  cleanOld(row);
  const marketPrice = n(row.price ?? row.lastPrice ?? row.currentPrice ?? row.last);
  let sr = bySymbol.get(symbol(row.symbol));
  if (!sr) {
    const names = [row.name, row.name_ar, row.name_en].map(name).filter(Boolean);
    sr = names.map(x => byName.get(x)).find(Boolean);
  }

  if (!sr) {
    unmatched += 1;
    continue;
  }
  if (!sane(sr, marketPrice)) {
    rejected += 1;
    continue;
  }

  row.support1 = n(sr.support1);
  row.support2 = n(sr.support2);
  row.resistance1 = n(sr.resistance1);
  row.resistance2 = n(sr.resistance2);
  row.pivot = n(sr.pivot);
  row.pivotPoint = row.pivot;
  row.supportResistanceSource = 'Mubasher rendered analysis tool';
  row.supportResistanceUpdatedAt = sr.updatedAt || source.generatedAt;
  row.sources = row.sources || {};
  row.sources.mubasherRendered = {
    currentRunOk: true,
    generatedAt: source.generatedAt,
    source: 'Mubasher rendered analysis tool',
    sourceUrl: sr.sourceUrl || source.sourceUrls?.[0],
    support1: row.support1,
    support2: row.support2,
    resistance1: row.resistance1,
    resistance2: row.resistance2,
    pivot: row.pivot
  };

  if (row.mubasherPrimaryFeed) {
    row.mubasherPrimaryFeed.hasSupportResistance = true;
    row.mubasherPrimaryFeed.missing = (row.mubasherPrimaryFeed.missing || [])
      .filter(x => !String(x).includes('الدعم والمقاومة'));
    row.mubasherPrimaryFeed.supportResistance = {
      ...(row.mubasherPrimaryFeed.supportResistance || {}),
      parsed: true,
      support1: row.support1,
      support2: row.support2,
      resistance1: row.resistance1,
      resistance2: row.resistance2,
      pivotPoint: row.pivot,
      url: sr.sourceUrl || source.sourceUrls?.[0],
      lastUpdate: sr.updatedAt || source.generatedAt
    };
  }

  row.missingCoreFields = (row.missingCoreFields || [])
    .filter(x => !String(x).includes('الدعم والمقاومة'));
  row.coreDataReady = Boolean(
    (n(row.price) > 0 || n(row.lastPrice) > 0) &&
    (n(row.turnover) > 0 || n(row.valueTraded) > 0 || n(row.liquidityValue) > 0) &&
    valid(row)
  );
  merged += 1;
  matchedSymbols.push(row.symbol);
}

const validCount = rows.filter(valid).length;
const coveragePct = rows.length ? Number((validCount / rows.length * 100).toFixed(2)) : 0;
const report = {
  ok: coveragePct >= MIN_COVERAGE,
  generatedAt: new Date().toISOString(),
  sourceGeneratedAt: source.generatedAt,
  sourceRows: source.rows.length,
  totalMarketRows: rows.length,
  merged,
  validCount,
  rejected,
  unmatched,
  coveragePct,
  minimumRequiredCoveragePct: MIN_COVERAGE,
  matchedSymbols
};

write(REPORT, report);
console.log(report);

if (coveragePct < MIN_COVERAGE) {
  console.error(`Verified coverage ${coveragePct}% is below required ${MIN_COVERAGE}%. Refusing publication.`);
  process.exit(3);
}

market.rows = rows;
market.supportResistanceSummary = report;
market.supportResistanceCoveragePct = coveragePct;
write(MARKET, market);
