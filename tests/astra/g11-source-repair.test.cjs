'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../../scripts/history/adapters/starta-exact-egx-adapter.cjs');
const G = require('../../astra/certification/g11-carry-forward-guard.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());

function mapEntry(overrides = {}) {
  return { ticker: 'TEST', isin: 'EGS000000001', exchange: 'EGX', companyNameEn: 'Completely Different Name', ...overrides };
}

test('exact EGX source identifier resolves without company-name matching', () => {
  const result = A.verifyExactIdentity({ symbol: 'TEST', market_code: 'EGX', isin: 'EGS000000001', name_en: 'Unrelated Source Name' }, 'TEST', mapEntry());
  assert.equal(result.verified, true);
  assert.equal(result.resolutionType, 'RESOLVED_EXACT_SOURCE_ID');
  assert.equal(result.nameMatchingUsedForResolution, false);
  assert.equal(result.exactIsin, true);
});

test('similar company name cannot override a source-symbol mismatch', () => {
  const result = A.verifyExactIdentity({ symbol: 'WRONG', market_code: 'EGX', isin: 'EGS000000001', name_en: 'Completely Different Name' }, 'TEST', mapEntry());
  assert.equal(result.verified, false);
  assert.equal(result.resolutionType, 'SOURCE_RECORD_INVALID');
});

test('canonical/source ISIN conflict blocks otherwise exact ticker', () => {
  const result = A.verifyExactIdentity({ symbol: 'TEST', market_code: 'EGX', isin: 'EGS999999999' }, 'TEST', mapEntry());
  assert.equal(result.verified, false);
  assert.equal(result.resolutionType, 'AMBIGUOUS_BLOCKED');
  assert.equal(result.isinConflict, true);
});

test('non-EGX source identity is rejected', () => {
  const result = A.verifyExactIdentity({ symbol: 'TEST', market_code: 'LSE', isin: 'EGS000000001' }, 'TEST', mapEntry());
  assert.equal(result.verified, false);
  assert.equal(result.egxScoped, false);
});

test('OHLC normalization rejects synthetic flat zero-volume carry-forward rows', () => {
  const out = A.normalizeOhlcRows([{ date: '2026-09-16', open: 10, high: 10, low: 10, close: 10, volume: 0 }], 'TEST', 'fixture://x', 75);
  assert.equal(out.rows.length, 0);
  assert.ok(out.rejected[0].errors.includes('flat_zero_volume_non_trading_row'));
});

test('OHLC normalization rejects missing volume instead of fabricating it', () => {
  const out = A.normalizeOhlcRows([{ date: '2026-09-16', open: 10, high: 11, low: 9, close: 10 }], 'TEST', 'fixture://x', 75);
  assert.equal(out.rows.length, 0);
  assert.ok(out.rejected[0].errors.includes('volume_missing'));
});

test('repair implementation never imports G07 migration payloads or legacy decision outputs', () => {
  const source = fs.readFileSync(path.join(ROOT, 'astra/data-health/g11-source-data-repair.cjs'), 'utf8');
  assert.equal(/MIGRATION_RECONCILIATION|rawArchive|canonical-records\.jsonl/.test(source), false);
  assert.equal(/quant-edge|v18-live|v19-egx-chat-gpt|sepax-strategy-stable|egx-tfe-v20-fusion-rc2/i.test(source), false);
});

test('repair implementation caps source rows at the expected session and has no executable carry-forward behavior', () => {
  const source = fs.readFileSync(path.join(ROOT, 'astra/data-health/g11-source-data-repair.cjs'), 'utf8');
  assert.match(source, /fetched\.sessions\.filter\(\(row\) => row\.date <= expected\)/);
  assert.deepEqual(G.analyzeCarryForwardSource(source), []);
});

test('full-market search builder is seeded from canonical symbol master before operational sources', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/quant/v13-17-market-search-index.cjs'), 'utf8');
  assert.match(source, /symbolMap:path\.join\(ROOT,'data','symbol-map\.json'\)/);
  assert.match(source, /function seedSymbolMaster\(raw\)/);
  assert.match(source, /seedSymbolMaster\(read\(FILES\.symbolMap,\{\}\)\);/);
  assert.match(source, /symbolMasterMapped:true|x\.symbolMasterMapped=true/);
});
