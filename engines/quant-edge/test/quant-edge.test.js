'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const QE = require('..');

function bars({ start = 100, drift = 0.006, volatility = 0.008, volume = 2_000_000, n = 90 } = {}) {
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 4) * volatility;
    const open = p, close = p * (1 + drift + wave);
    out.push({ date: `D${i + 1}`, open, high: Math.max(open, close) * 1.008, low: Math.min(open, close) * 0.992, close, volume: volume * (1 + (i % 7) * 0.03) });
    p = close;
  }
  return out;
}

test('hard shadow-mode invariant blocks execution', () => {
  assert.equal(QE.config.engine.allowExecution, false);
  assert.equal(QE.assertShadowSafety(), true);
});

test('broker freshness decay and stale rejection', () => {
  assert.equal(QE.broker.freshnessWeight(1), 1);
  assert.equal(QE.broker.freshnessWeight(4), 0.75);
  assert.equal(QE.broker.freshnessWeight(8), 0.40);
  assert.equal(QE.broker.freshnessWeight(11), 0);
});

test('broker duplicates are counted once by origin report id', () => {
  const raw = [
    { ticker: 'SWDY', source: 'A', sourceType: 'OFFICIAL_RESEARCH_REPORT', rating: 'BUY', ageSessions: 1, originReportId: 'R-1' },
    { ticker: 'SWDY', source: 'Media copy', sourceType: 'TRUSTED_MEDIA_QUOTE', rating: 'BUY', ageSessions: 1, originReportId: 'R-1' },
  ];
  assert.equal(QE.broker.buildBrokerConsensus('SWDY', raw).usableRecommendations, 1);
});

test('unknown sources have zero influence', () => {
  const c = QE.broker.buildBrokerConsensus('SWDY', [{ ticker: 'SWDY', source: 'Random', sourceType: 'UNKNOWN', rating: 'BUY', ageSessions: 0 }]);
  assert.equal(c.adjustmentPoints, 0);
});

test('broker influence is hard capped at 15 points', () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({ ticker: 'SWDY', source: `S${i}`, sourceType: 'OFFICIAL_RESEARCH_REPORT', rating: 'STRONG_BUY', ageSessions: 0, originReportId: `R${i}` }));
  assert.ok(QE.broker.buildBrokerConsensus('SWDY', raw).adjustmentPoints <= 15);
});

test('core reject cannot be flipped into BUY by broker consensus', () => {
  const brokers = Array.from({ length: 5 }, (_, i) => ({ ticker: 'TEST', source: `B${i}`, sourceType: 'OFFICIAL_RESEARCH_REPORT', rating: 'STRONG_BUY', ageSessions: 0, originReportId: `B${i}` }));
  const r = QE.analyzeSymbol({ ticker: 'TEST', bars: bars({ drift: -0.009, volatility: 0.002 }), benchmarkBars: bars({ drift: -0.010, volatility: 0.003 }), brokerRecommendations: brokers });
  assert.equal(r.direction, 'REJECT');
  assert.equal(r.invariants.brokerCanFlipCoreReject, false);
});

test('probabilities are not fabricated before calibration', () => {
  const r = QE.analyzeSymbol({ ticker: 'TEST', bars: bars(), benchmarkBars: bars({ drift: 0.003 }) });
  assert.equal(r.probability.calibrated, false);
  assert.equal(r.probability.tp1BeforeSl, null);
});

test('triple barrier uses conservative same-bar ordering', () => {
  const outcome = QE.tracking.tripleBarrierOutcome({ entry: 100, stop: 95, tp1: 105, tp2: 110, maxSessions: 2, bars: [{ high: 111, low: 94 }, { high: 112, low: 100 }] });
  assert.equal(outcome.firstBarrier, 'SL');
});

test('source code has no imports from MAIN recommendation/ranking/score modules', () => {
  const root = path.resolve(__dirname, '..');
  const files = fs.readdirSync(root).filter(f => f.endsWith('.js'));
  const forbidden = [/require\([^)]*main[^)]*(recommend|ranking|score)/i, /from\s+['\"][^'\"]*main[^'\"]*(recommend|ranking|score)/i];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const rx of forbidden) assert.equal(rx.test(source), false, `${file} matched ${rx}`);
  }
});

test('independent source boundary rejects MAIN APP origin', () => {
  const boundary = require('../data-boundary');
  const snapshot = { sourceGrade: 'ANALYSIS_GRADE', origin: 'MAIN_APP_CACHE', benchmark: { bars: bars() }, symbols: [{ ticker: 'X', bars: bars() }] };
  assert.throws(() => boundary.validateIndependentSnapshot(snapshot), /NON_INDEPENDENT/);
});

test('independent source boundary accepts auditable analysis-grade snapshot', () => {
  const boundary = require('../data-boundary');
  const snapshot = { sourceGrade: 'ANALYSIS_GRADE', origin: 'QUANT_EDGE_SOURCE_A', benchmark: { bars: bars() }, symbols: [{ ticker: 'X', bars: bars() }] };
  assert.equal(boundary.validateIndependentSnapshot(snapshot), true);
  assert.equal(boundary.hashSnapshot(snapshot).length, 64);
});
