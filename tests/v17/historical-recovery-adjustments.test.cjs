'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessAdjustment, deriveAdjustedOhlc } = require('../../scripts/v17/historical-recovery/adjustment-policy.cjs');

test('quarantines a split-like raw discontinuity', () => {
  const item = { loaderReasons: [], sessions: [
    { close: 100, adjustedClose: 50 },
    { close: 50, adjustedClose: 51 },
  ] };
  const result = assessAdjustment(item, { splitLikeRawJumpPct: 35 });
  assert.equal(result.eligible, false);
  assert.equal(result.splitLikeDiscontinuity, true);
});
test('marks reconstructed adjusted OHLC as DERIVED', () => {
  const result = deriveAdjustedOhlc({ open: 98, high: 102, low: 96, close: 100, adjustedClose: 50 });
  assert.equal(result.provenance, 'DERIVED');
  assert.equal(result.high, 51);
});
