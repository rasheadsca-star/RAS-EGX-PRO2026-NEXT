#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const marketPath = path.join(root, 'data/market.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}

function sanitize(value, fallback) {
  let text = String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const marker = /End\s+AdSlot(?:\s+\d+)?/ig;
  let match;
  let lastEnd = -1;
  while ((match = marker.exec(text))) lastEnd = match.index + match[0].length;
  if (lastEnd >= 0) text = text.slice(lastEnd).trim();

  text = text
    .replace(/^(?:\[?[0-9,\s]+\]?\s*)+/g, '')
    .replace(/^(?:AdSlot|Advertisement)\s*\d*\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length < 2 || /^[0-9,\[\]\s]+$/.test(text)) return fallback;
  return text;
}

const market = readJson(marketPath);
const rows = Array.isArray(market.rows) ? market.rows : [];
let changed = 0;
let pollutedBefore = 0;
let pollutedAfter = 0;

for (const row of rows) {
  const symbol = String(row.symbol || '').trim().toUpperCase() || '—';
  const beforeAr = String(row.name_ar || '');
  const beforeEn = String(row.name_en || '');
  if (/End\s+AdSlot|-->|^[0-9,\[\]]{5,}/i.test(`${beforeAr} ${beforeEn}`)) pollutedBefore += 1;

  const cleanAr = sanitize(beforeAr, sanitize(beforeEn, symbol));
  const cleanEn = sanitize(beforeEn, cleanAr || symbol);
  if (cleanAr !== beforeAr || cleanEn !== beforeEn) changed += 1;
  row.name_ar = cleanAr;
  row.name_en = cleanEn;

  if (/End\s+AdSlot|-->|^[0-9,\[\]]{5,}/i.test(`${row.name_ar} ${row.name_en}`)) pollutedAfter += 1;
}

market.nameSanitization = {
  schemaVersion: '17.0.0-name-sanitizer',
  sanitizedAt: new Date().toISOString(),
  rows: rows.length,
  changedRows: changed,
  pollutedBefore,
  pollutedAfter,
};

writeJsonAtomic(marketPath, market);
console.log(JSON.stringify(market.nameSanitization, null, 2));
if (pollutedAfter > 0) process.exitCode = 2;
