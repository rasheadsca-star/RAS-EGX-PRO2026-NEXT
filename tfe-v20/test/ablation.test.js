import test from 'node:test';
import assert from 'node:assert/strict';
import { collectV17SignalKeys, evaluateRecordedPlan, extractV20ReplayEvents, metricDelta, rankResearchOnly } from '../src/ablation.js';

const bars = [
  { date: '2026-01-01', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
  { date: '2026-01-02', open: 100, high: 106, low: 94, close: 101, volume: 1000 },
  { date: '2026-01-03', open: 101, high: 103, low: 100, close: 102, volume: 1000 },
];

test('standardized evaluator resolves same-bar target/stop conservatively to stop', () => {
  const result = evaluateRecordedPlan({ ticker: 'TEST', rows: bars, signalDate: '2026-01-01', holdSessions: 10, plan: { entryLow: 99, entryHigh: 101, stop: 95, target1: 105 } });
  assert.equal(result.status, 'ENTERED');
  assert.equal(result.trade.outcome, 'STOP_SAME_BAR');
  assert.equal(result.trade.entryDate, '2026-01-02');
  assert.equal(result.trade.netPct, -5.6);
});

test('missing ablation metrics never become fabricated zero deltas', () => {
  assert.equal(metricDelta(null, 63.6), null);
  assert.equal(metricDelta(undefined, 63.6), null);
  assert.equal(metricDelta(63.6, null), null);
  assert.equal(metricDelta(70, 63.6), 6.4);
});

test('TFE core ranking ignores RC2 fusion rank and orders by research score', () => {
  const ranked = rankResearchOnly([
    { ticker: 'AAA', eligible: true, scores: { research: 80, fusionRank: 60, core: 80, supportResistance: 70, liquidity: 90 } },
    { ticker: 'BBB', eligible: true, scores: { research: 75, fusionRank: 95, core: 80, supportResistance: 70, liquidity: 90 } },
  ]);
  assert.deepEqual(ranked.map((x) => x.ticker), ['AAA', 'BBB']);
});

test('V17 collector indexes recorded same-date ticker evidence and keeps strongest class', () => {
  const signals = collectV17SignalKeys({
    recordedRecommendationBackfill: { records: [{ recommendationDate: '2026-08-04', ticker: 'ETEL', evidenceClass: 'RECORDED_BACKFILL_NOT_NATIVE_V17_LIVE' }] },
    nativeV17: { entries: [{ signalDate: '2026-08-04', tickers: ['ETEL', 'SWDY'], evidenceClass: 'NATIVE_V17_LIVE' }] },
  });
  assert.equal(signals.size, 2);
  assert.equal(signals.get('2026-08-04|ETEL').evidenceClass, 'NATIVE_V17_LIVE');
  assert.ok(signals.has('2026-08-04|SWDY'));
});

test('V17 safety proxy excludes retrospective research-only sessions', () => {
  const signals = collectV17SignalKeys({
    research: { sessions: [{ signalDate: '2026-07-21', tickers: ['ETEL'], evidenceClass: 'HISTORICAL_BLOCKED_WALK_FORWARD_RESEARCH' }] },
    recorded: { records: [{ recommendationDate: '2026-07-21', ticker: 'SWDY', evidenceClass: 'RECORDED_BACKFILL_NOT_NATIVE_V17_LIVE' }] },
  });
  assert.equal(signals.has('2026-07-21|ETEL'), false);
  assert.equal(signals.has('2026-07-21|SWDY'), true);
});

test('V20 replay extraction freezes only stored session members', () => {
  const events = extractV20ReplayEvents({ sessions: [{ signalDate: '2026-08-13', members: [
    { ticker: 'ETEL', score: 80, tradePlan: { entryLow: 10, entryHigh: 11, stop: 9, target1: 12 } },
    { ticker: 'SWDY', score: 75, tradePlan: { entryLow: 20, entryHigh: 21, stop: 19, target1: 22 } },
  ] }] });
  assert.deepEqual(events.map((x) => `${x.signalDate}|${x.ticker}`), ['2026-08-13|ETEL', '2026-08-13|SWDY']);
});
