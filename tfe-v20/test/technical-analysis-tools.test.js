import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TECHNICAL_VISUALIZATION_CONTRACT,
  normalizeTechnicalBars,
  regressionPriceChannel,
  fibonacciRetracement,
  buildArabicTechnicalAnalysis,
} from '../public/technical-analysis-tools.js';

function bars(count = 220, start = 100, step = 0.5) {
  const out = [];
  const base = Date.UTC(2025, 0, 1);
  for (let i = 0; i < count; i += 1) {
    const close = start + step * i;
    out.push({
      date: new Date(base + i * 86400000).toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100000 + i * 100,
    });
  }
  return out;
}

test('technical visualization contract is read-only and zero-authority', () => {
  assert.equal(TECHNICAL_VISUALIZATION_CONTRACT.historyRouteOnly, true);
  assert.equal(TECHNICAL_VISUALIZATION_CONTRACT.scoringImpact, 'NONE');
  assert.equal(TECHNICAL_VISUALIZATION_CONTRACT.recommendationMutationAllowed, false);
  assert.equal(TECHNICAL_VISUALIZATION_CONTRACT.executionAllowed, false);
  assert.equal(TECHNICAL_VISUALIZATION_CONTRACT.automaticOrders, false);
  assert.deepEqual([...TECHNICAL_VISUALIZATION_CONTRACT.horizons], ['SHORT','MEDIUM','LONG']);
});

test('normalizer sorts, deduplicates and rejects invalid close rows', () => {
  const rows = [
    { date:'2026-08-03', close:103, high:104, low:102 },
    { date:'2026-08-01', close:101, high:102, low:100 },
    { date:'2026-08-02', close:0, high:1, low:0 },
    { date:'2026-08-03', close:104, high:105, low:103 },
  ];
  const normalized = normalizeTechnicalBars(rows);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized.map((x) => x.date), ['2026-08-01','2026-08-03']);
  assert.equal(normalized.at(-1).close, 104);
});

test('regression price channel is deterministic on a linear series', () => {
  const channel = regressionPriceChannel(bars(60, 100, 1), 60, 2);
  assert.ok(channel);
  assert.ok(Math.abs(channel.slope - 1) < 1e-10);
  assert.ok(channel.sigma < 1e-9);
  assert.ok(Math.abs(channel.centerStart - 100) < 1e-9);
  assert.ok(Math.abs(channel.centerEnd - 159) < 1e-9);
});

test('fibonacci retracement uses actual high/low anchors and standard levels', () => {
  const series = bars(30, 100, 1);
  const fib = fibonacciRetracement(series, 30);
  assert.ok(fib);
  assert.equal(fib.direction, 'UP');
  assert.equal(fib.low.value, 99);
  assert.equal(fib.high.value, 130);
  assert.deepEqual(fib.levels.map((x) => x.ratio), [0,0.236,0.382,0.5,0.618,0.786,1]);
  assert.ok(Math.abs(fib.levels[0].price - 130) < 1e-9);
  assert.ok(Math.abs(fib.levels.at(-1).price - 99) < 1e-9);
});

test('Arabic analysis exposes clear short medium and long horizons without authority', () => {
  const result = buildArabicTechnicalAnalysis(bars(220, 50, 0.25));
  assert.equal(result.available, true);
  assert.equal(result.short.labelAr, 'قصير الأجل');
  assert.equal(result.medium.labelAr, 'متوسط الأجل');
  assert.equal(result.long.labelAr, 'طويل الأجل');
  assert.equal(result.short.trendAr, 'صاعد');
  assert.equal(result.medium.trendAr, 'صاعد');
  assert.equal(result.long.trendAr, 'صاعد');
  assert.equal(result.long.movingAverageLabelAr, 'SMA200');
  assert.match(result.short.summaryAr, /صاعد/);
  assert.equal(result.scoringImpact, 'NONE');
  assert.equal(result.recommendationMutationAllowed, false);
  assert.equal(result.executionAllowed, false);
});

test('long horizon states the available-period proxy instead of inventing SMA200', () => {
  const result = buildArabicTechnicalAnalysis(bars(90, 70, 0.1));
  assert.equal(result.available, true);
  assert.equal(result.long.sessions, 90);
  assert.equal(result.long.movingAverageLabelAr, 'متوسط 90 جلسة');
});

test('UI extension source cannot call scan or import Alpha/policy modules', () => {
  const source = readFileSync(new URL('../public/technical-analysis-tools.js', import.meta.url), 'utf8');
  assert.equal(/route\s*[:=]\s*['"]scan['"]/i.test(source), false);
  assert.equal(/route=scan/i.test(source), false);
  assert.equal(/src\/(engine|policy|confidence|originalScore|originalIndicators|repository)/.test(source), false);
  assert.equal(/executionAllowed\s*:\s*true/i.test(source), false);
  assert.equal(/automaticOrders\s*:\s*true/i.test(source), false);
  assert.match(source, /route:\s*'history'/);
  assert.match(source, /limit:\s*String\(TECHNICAL_VISUALIZATION_CONTRACT\.maxHistorySessions\)/);
});
