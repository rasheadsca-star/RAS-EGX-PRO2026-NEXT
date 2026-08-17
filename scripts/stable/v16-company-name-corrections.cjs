#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const AUDIT_PATH = path.join(ROOT, 'data/stable/v16-company-name-corrections.json');

// Canonical identity corrections. These are symbol-identity fixes only; they do
// not alter prices, signals, rankings, probabilities, or execution rules.
// AMIA = Arab Moltaqa Investments / الملتقى العربي للاستثمارات.
// ARVA = Arab Valves Company / العربية للمحابس.
const CANONICAL = Object.freeze({
  AMIA: Object.freeze({
    companyNameAr: 'الملتقى العربي للاستثمارات',
    companyNameEn: 'Arab Moltaqa Investments Company',
    reutersCode: 'AMIA.CA',
    verification: 'AMIC_OFFICIAL_SITE_AND_MUBASHER_EGX'
  }),
  ARVA: Object.freeze({
    companyNameAr: 'العربية للمحابس',
    companyNameEn: 'Arab Valves Company',
    reutersCode: 'ARVA.CA',
    verification: 'MUBASHER_EGX_AND_ARABFINANCE'
  })
});

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function normTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/\.CA$/i, '');
}
function patchObject(node, changes) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) patchObject(item, changes);
    return;
  }

  const ticker = normTicker(node.ticker || node.symbol || node.code || node.reutersCode);
  const canonical = CANONICAL[ticker];
  if (canonical) {
    const before = {};
    const after = {};
    let changed = false;

    if (Object.prototype.hasOwnProperty.call(node, 'companyNameAr') && node.companyNameAr !== canonical.companyNameAr) {
      before.companyNameAr = node.companyNameAr;
      node.companyNameAr = canonical.companyNameAr;
      after.companyNameAr = node.companyNameAr;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(node, 'companyNameEn') && node.companyNameEn !== canonical.companyNameEn) {
      before.companyNameEn = node.companyNameEn;
      node.companyNameEn = canonical.companyNameEn;
      after.companyNameEn = node.companyNameEn;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(node, 'name_ar') && node.name_ar !== canonical.companyNameAr) {
      before.name_ar = node.name_ar;
      node.name_ar = canonical.companyNameAr;
      after.name_ar = node.name_ar;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(node, 'name_en') && node.name_en !== canonical.companyNameEn) {
      before.name_en = node.name_en;
      node.name_en = canonical.companyNameEn;
      after.name_en = node.name_en;
      changed = true;
    }

    // Top-level history identity should always carry the canonical Reuters code.
    if (Object.prototype.hasOwnProperty.call(node, 'reutersCode') && node.reutersCode !== canonical.reutersCode) {
      before.reutersCode = node.reutersCode;
      node.reutersCode = canonical.reutersCode;
      after.reutersCode = node.reutersCode;
      changed = true;
    }

    if (changed) changes.push({ ticker, before, after });
  }

  for (const value of Object.values(node)) patchObject(value, changes);
}

function patchFile(relativePath) {
  const file = path.join(ROOT, relativePath);
  if (!fs.existsSync(file)) return { file: relativePath, exists: false, changed: false, changes: [] };
  const doc = readJson(file, null);
  if (doc === null) return { file: relativePath, exists: true, changed: false, error: 'INVALID_JSON', changes: [] };
  const changes = [];
  patchObject(doc, changes);
  if (changes.length) writeJsonAtomic(file, doc);
  return { file: relativePath, exists: true, changed: changes.length > 0, changes };
}

function applyCompanyNameCorrections() {
  const targets = [
    'data/history/AMIA.json',
    'data/history/ARVA.json',
    'data/market.json',
    'data/research/v16-v169-basket-engine.json',
    'data/stable/v16-v169-primary-decision.json',
    'data/stable/v15-practical-decision.json'
  ];
  const files = targets.map(patchFile);
  const changedFiles = files.filter(item => item.changed).map(item => item.file);
  const audit = {
    schemaVersion: '16.9.2-canonical-company-identity-1',
    generatedAt: new Date().toISOString(),
    purpose: 'Correct symbol-to-company-name identity only; no market or model values are changed.',
    canonical: CANONICAL,
    changedFiles,
    files
  };
  writeJsonAtomic(AUDIT_PATH, audit);
  return audit;
}

if (require.main === module) {
  const audit = applyCompanyNameCorrections();
  console.log(JSON.stringify({
    changedFiles: audit.changedFiles,
    AMIA: CANONICAL.AMIA,
    ARVA: CANONICAL.ARVA
  }, null, 2));
}

module.exports = { CANONICAL, applyCompanyNameCorrections };
