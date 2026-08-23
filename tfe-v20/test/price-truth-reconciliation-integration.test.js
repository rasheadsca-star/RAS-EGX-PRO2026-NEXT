import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTickerBase } from '../src/engine.js';

function rows() {
  const out = [];
  const start = Date.UTC(2026, 4, 1);
  for (let i = 0; i < 60; i += 1) {
    const close = 8 + i * 0.018;
    out.push({
      date: new Date(start + i * 86400000).toISOString().slice(0, 10),
      open: close - 0.03,
      high: close + 0.12,
      low: close - 0.12,
      close,
      volume: 3_000_000 + i * 10_000,
    });
  }
  out[59] = { date: '2026-08-23', open: 9.05, high: 9.12, low: 9.05, close: 9.12, volume: 9_132_632 };
  return out;
}

test('engine passes latest price truth to quality layer without opening execution', () => {
  const result = analyzeTickerBase({
    ticker: 'KABO',
    rows: rows(),
    expectedSessionDate: '2026-08-23',
    historyMeta: {
      warnings: ['latest_close_conflict:27.6461%'],
      symbolVerified: true,
      officiallyVerifiedLatestSession: false,
      symbolVerification: { verified: true, evidence: { localDifferencePct: 61.9273, guardedMaxDifferencePct: 8 } },
      priceTruthLatest: {
        date: '2026-08-23',
        sourceSessionDate: '2026-08-23',
        close: 9.12,
        source: 'mubasher_symbol_pages_precise_enriched',
        validationStatus: 'precise_public_source_session_confirmed',
        confidence: 86,
      },
    },
  });
  assert.equal(result.quality.publicationHold, false);
  assert.equal(result.quality.priceReconciliationResolved, true);
  assert.equal(result.permissions.executionAllowed, false);
  assert.equal(result.permissions.automaticOrders, false);
});
