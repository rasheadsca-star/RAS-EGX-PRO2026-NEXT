'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadLocalReferences } = require('../scripts/history/adapters/local-verification-adapter.cjs');

function writeJson(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'egx-local-ref-'));
}

test('internal derivative price files cannot become reconciliation references', () => {
  const root = tmp();
  writeJson(root, 'data/final-opportunity-ranking.json', {
    generatedAt: new Date().toISOString(),
    rows: [{ symbol: 'KABO', price: 7.14, sourceUsed: 'market' }],
  });
  const refs = loadLocalReferences(root);
  assert.equal(refs.has('KABO'), false);
});

test('fresh independent Mubasher reference is accepted', () => {
  const root = tmp();
  writeJson(root, 'data/full-market-cache.json', {
    generatedAt: new Date().toISOString(),
    rows: [{
      symbol: 'KABO',
      price: 9.12,
      priceSource: 'mubasher_public_stock_page',
      fetchedAt: new Date().toISOString(),
    }],
  });
  const ref = loadLocalReferences(root).get('KABO');
  assert.ok(ref);
  assert.equal(ref.close, 9.12);
  assert.match(ref.source, /^mubasher_/);
});

test('stale independent references are rejected', () => {
  const root = tmp();
  writeJson(root, 'data/full-market-cache.json', {
    generatedAt: '2026-07-01T12:00:00.000Z',
    rows: [{ symbol: 'KABO', price: 6.33, priceSource: 'mubasher_public_stock_page' }],
  });
  const refs = loadLocalReferences(root);
  assert.equal(refs.has('KABO'), false);
});
