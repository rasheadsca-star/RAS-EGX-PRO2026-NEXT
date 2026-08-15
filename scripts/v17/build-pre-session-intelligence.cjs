#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; }
}
function writeJson(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function arr(v) { return Array.isArray(v) ? v : []; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}
function norm(value) {
  return decodeHtml(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function dateFrom(value, url) {
  const raw = String(value || '').trim();
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const m = String(url || '').match(/\/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})(?:\/|$)/);
  if (m) {
    const d = new Date(`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}
function isoDate(d) { return d ? d.toISOString().slice(0, 10) : null; }
function hits(text, words) {
  const n = norm(text);
  let count = 0;
  for (const word of arr(words)) {
    const w = norm(word);
    if (w && n.includes(w)) count += 1;
  }
  return count;
}
function pushEntity(map, row) {
  const symbol = String(row?.symbol || row?.ticker || row?.code || '').trim().toUpperCase();
  if (!symbol) return;
  const current = map.get(symbol) || { symbol, sector: '', aliases: [] };
  current.sector = current.sector || row.sector || row.sector_ar || row.industry || '';
  const candidates = [
    row.name, row.name_ar, row.name_en, row.company, row.companyNameAr,
    ...(arr(row.aliases)),
  ];
  for (const candidate of candidates) {
    const n = norm(candidate);
    if (n.length >= 5 && n !== norm(symbol)) current.aliases.push(n);
  }
  current.aliases = unique(current.aliases).sort((a, b) => b.length - a.length).slice(0, 24);
  map.set(symbol, current);
}

const smart = readJson('data/smart-news-report.json', {});
const rec = readJson('data/recommendations.json', {});
const universe = readJson('data/universe-index.json', {});
const cache = readJson('data/full-market-cache.json', []);
const cfg = readJson('config/news-sources-v56.json', { keywords: {} });
const now = new Date();
const maxAgeDays = 5;
const maxAgeMs = maxAgeDays * 86400000;

const entities = new Map();
for (const row of arr(rec.all)) pushEntity(entities, row);
for (const row of arr(rec.topBuyCandidates)) pushEntity(entities, row);
for (const row of arr(universe.symbols)) pushEntity(entities, row);
for (const row of arr(cache)) pushEntity(entities, row);

function matchSymbols(item) {
  const direct = arr(item.relatedSymbols).map(x => String(x).trim().toUpperCase()).filter(x => entities.has(x));
  if (direct.length) return unique(direct).slice(0, 8);
  const text = norm(`${item.title || ''} ${item.description || ''}`);
  const matches = [];
  for (const entity of entities.values()) {
    if (new RegExp(`(^|\\s)${entity.symbol.toLowerCase()}($|\\s)`, 'i').test(text)) {
      matches.push(entity.symbol);
      continue;
    }
    if (entity.aliases.some(alias => alias.length >= 5 && text.includes(alias))) matches.push(entity.symbol);
    if (matches.length >= 8) break;
  }
  return unique(matches).slice(0, 8);
}

const normalizedItems = [];
let staleExcluded = 0;
let undatedExcluded = 0;
let unmatched = 0;
let neutral = 0;

for (const item of arr(smart.items)) {
  const d = dateFrom(item.publishedAt || item.date, item.url);
  if (!d) { undatedExcluded += 1; continue; }
  const ageMs = now.getTime() - d.getTime();
  if (ageMs < -86400000 || ageMs > maxAgeMs) { staleExcluded += 1; continue; }
  const symbols = matchSymbols(item);
  const text = `${item.title || ''} ${item.description || ''}`;
  const pos = hits(text, cfg.keywords?.positive);
  const neg = hits(text, cfg.keywords?.negative);
  const sentiment = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
  const sign = sentiment === 'positive' ? 1 : sentiment === 'negative' ? -1 : 0;
  const magnitude = Math.min(100, Math.max(0, Number(item.impactScore || 0)) * 12);
  const signedImpact = sign * magnitude;
  if (!symbols.length) { unmatched += 1; continue; }
  if (!sign) neutral += 1;
  for (const symbol of symbols) {
    const entity = entities.get(symbol) || {};
    normalizedItems.push({
      symbol,
      sector: entity.sector || 'غير مصنف',
      title: decodeHtml(item.title || ''),
      summary: decodeHtml(item.description || item.title || ''),
      url: item.url || '',
      date: isoDate(d),
      category: 'pre_session_news',
      categoryCode: 'pre_session_news',
      sentiment,
      impactScore: signedImpact,
      source: 'v17_pre_session_intelligence',
      evidenceType: 'external_news',
      sourceName: item.source || item.sourceName || 'public news',
      trustedNewsSource: true,
      sourceReportGeneratedAt: smart.generatedAt || null,
    });
  }
}

const dedupe = new Map();
for (const item of normalizedItems) {
  const key = `${item.symbol}|${item.url}|${item.title}`;
  if (!dedupe.has(key) || Math.abs(item.impactScore) > Math.abs(dedupe.get(key).impactScore)) dedupe.set(key, item);
}
const items = [...dedupe.values()].sort((a,b) => Math.abs(b.impactScore) - Math.abs(a.impactScore) || String(b.date).localeCompare(String(a.date)));
const generatedAt = new Date().toISOString();

const out = {
  ok: true,
  engine: 'v17_fresh_pre_session_intelligence_1',
  generatedAt,
  sourceMode: 'smart-news-report-fresh-window',
  sourceReportGeneratedAt: smart.generatedAt || null,
  maxAgeDays,
  importantNote: 'Only recent dated public news mapped to a concrete EGX symbol is eligible to adjust recommendation confidence. Undated/stale/unmatched items are excluded from scoring.',
  items,
};
writeJson('data/news-intelligence.json', out);
writeJson('data/v17/pre-session-intelligence.json', {
  schemaVersion: '17.0.0-pre-session-intelligence-1',
  generatedAt,
  sourceReportGeneratedAt: smart.generatedAt || null,
  sourceReportStatus: smart.status || null,
  sourceItems: arr(smart.items).length,
  eligibleMappedItems: items.length,
  affectedSymbols: unique(items.map(x => x.symbol)),
  positiveItems: items.filter(x => x.impactScore > 0).length,
  negativeItems: items.filter(x => x.impactScore < 0).length,
  neutralItems: neutral,
  staleExcluded,
  undatedExcluded,
  unmatchedExcluded: unmatched,
  maxAgeDays,
  scoringPolicy: 'RECENT_DATED_SYMBOL_MAPPED_TRUSTED_NEWS_ONLY',
});
console.log(JSON.stringify({
  engine: out.engine,
  sourceItems: arr(smart.items).length,
  eligibleMappedItems: items.length,
  affectedSymbols: unique(items.map(x => x.symbol)),
  positive: items.filter(x => x.impactScore > 0).length,
  negative: items.filter(x => x.impactScore < 0).length,
  staleExcluded,
  undatedExcluded,
  unmatched,
}, null, 2));
