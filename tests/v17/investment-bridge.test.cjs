#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { evaluateConversionGate, assessExitState } = require('../../scripts/v17/investment-bridge/gates.cjs');
const { BRIDGE_EMPTY_STATE_AR, buildBridgeDataset, buildDailyRecommendationBadges, toPublicDataset } = require('../../scripts/v17/investment-bridge/build.cjs');
const { validateBridgeOutput } = require('../../scripts/v17/investment-bridge/validate.cjs');
const { reconstructExecutionAsOf } = require('../../scripts/v17/investment-bridge/as-of-reconstruction.cjs');
const { buildReplay } = require('../../scripts/v17/investment-bridge/replay-2026-08-05.cjs');
const { checkPaths } = require('../../scripts/v17/frozen-path-check.cjs');

function detail(overrides = {}) {
  return {
    ticker: 'GOOD',
    companyNameAr: 'شركة اختبار',
    historical: {
      high: 100,
      highDate: '2024-01-01',
      postPeakLow: 40,
      postPeakLowDate: '2025-01-01',
      current: 64,
      drawdownFromHighPct: 36,
      recoveryPositionPct: 40,
    },
    historicalDataQuality: { status: 'VALID', confidence: 90, reasons: [], corporateActionConfidence: 'HIGH' },
    technical: { recoveryStage: 'EARLY_RECOVERY', recoveryStageAr: 'بداية تعافٍ', recoveryScore: 55, strengthScore: 60, rsi14: 55 },
    fundamental: {
      fundamentalDataConfidence: 'HIGH',
      fundamentalQualityScore: 72,
      valuation: { score: 60 },
      financialRisk: { classification: 'MEDIUM' },
      valueTrapRisk: { classification: 'LOW' },
    },
    risk: { classification: 'MEDIUM' },
    valueTrapRisk: { classification: 'LOW' },
    news: { coverageStatus: 'AVAILABLE', newsImpactScore: 0, newsConfidence: 80, materialEvents: [], latestMaterialEvent: null },
    overallDataConfidence: 80,
    dataCompleteness: 'FULL',
    severeVerifiedNegativeEvent: false,
    ...overrides,
  };
}

function decision(ticker = 'GOOD', overrides = {}) {
  const d = detail({ ticker, ...overrides });
  return { ticker, currentDecisionAr: 'قرار تاريخي', detail: d };
}

const executedDaily = { ticker: 'GOOD', signalDate: '2026-08-09', executionStatus: 'EXECUTED', executionPrice: 64, liveExecutionEnabled: true };

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('daily stock not in historical inventory', () => {
  const gate = evaluateConversionGate({ daily: executedDaily, historicalDecision: null });
  assert.equal(gate.passed, false);
  assert.ok(gate.failures.includes('NOT_IN_HISTORICAL_UNIVERSE'));
});

test('unfilled daily recommendation and KEEP_CASH do not convert', () => {
  assert.equal(evaluateConversionGate({ daily: { ...executedDaily, executionStatus: 'UNFILLED' }, historicalDecision: decision() }).classificationCode, 'NOT_EXECUTED');
  assert.equal(evaluateConversionGate({ daily: { ...executedDaily, executionStatus: 'KEEP_CASH' }, historicalDecision: decision() }).classificationCode, 'NOT_EXECUTED');
  assert.equal(evaluateConversionGate({ daily: { ...executedDaily, executionStatus: 'KEEP_CASH' }, historicalDecision: decision() }).classificationAr, 'لم يتم التنفيذ اليومي');
});

test('point-in-time reconstruction excludes sessions after as-of', () => {
  const row = { ticker: 'GOOD', signalDate: '2026-08-01', entryLow: 99, entryHigh: 101, stop: 95 };
  const sessions = [{ date: '2026-08-03', open: 100, high: 103, low: 98 }, { date: '2026-08-04', open: 102, high: 105, low: 101 }];
  assert.equal(reconstructExecutionAsOf(row, sessions, '2026-08-02').executionStatus, 'AWAITING_SESSION');
  const executed = reconstructExecutionAsOf(row, sessions, '2026-08-03');
  assert.equal(executed.executionStatus, 'EXECUTED');
  assert.equal(executed.executionEvidenceDate, '2026-08-03');
});

test('point-in-time reconstruction respects gap and unfilled rules', () => {
  const row = { ticker: 'GOOD', signalDate: '2026-08-01', entryLow: 99, entryHigh: 101, stop: 95 };
  assert.equal(reconstructExecutionAsOf(row, [{ date: '2026-08-02', open: 103, high: 104, low: 102 }], '2026-08-02').executionStatus, 'KEEP_CASH');
  assert.equal(reconstructExecutionAsOf(row, [{ date: '2026-08-02', open: 97, high: 98, low: 96 }], '2026-08-02').executionStatus, 'UNFILLED');
});

test('real replay is isolated from later prices, fundamentals, news and intelligence snapshots', () => {
  const root = path.resolve(__dirname, '../..');
  const baseline = buildReplay({ root });
  const futureFundamentals = { companies: [{ ticker: 'MOIN', periods: [{ periodEnd: '2026-06-30', publicationDate: '2026-08-09', revenue: 999, netIncome: 999 }] }] };
  const futureNews = { events: [{ ticker: 'MOIN', eventType: 'FINANCIAL_RESULTS', eventDate: '2026-08-09', publicationDate: '2026-08-09', sourceTier: 'TIER_1', sourceUrl: 'https://example.test', sentiment: 'VERY_POSITIVE', materiality: 100, sourceConfidence: 100 }], coverageTickers: ['MOIN'], asOf: '2026-08-09' };
  const isolated = buildReplay({ root, historyMutator(doc) { doc.sessions.push({ date: '2026-08-09', open: 999, high: 1000, low: 998, close: 999, adjustedClose: 999, volume: 999999 }); }, fundamentalInput: futureFundamentals, newsInput: futureNews, intelligenceSnapshot: { generatedAt: '2026-08-09', decisions: [{ ticker: 'MOIN', forced: true }] } });
  assert.deepEqual(isolated.rows, baseline.rows);
  assert.equal(isolated.intelligenceSnapshotUsed, false);
  assert.equal(isolated.intelligenceSnapshotIgnored, true);
});

test('real replay preserves GGCC non-convertible execution result', () => {
  const replay = buildReplay({ root: path.resolve(__dirname, '../..') });
  const ggcc = replay.rows.find(row => row.ticker === 'GGCC');
  assert.equal(ggcc.executable, false);
  assert.equal(ggcc.conversionAllowed, false);
  assert.ok(ggcc.exactGateReasonsAr.some(reason => reason.includes('أهلية التنفيذ')));
});

test('bottoming stock does not automatically convert', () => {
  const gate = evaluateConversionGate({ daily: executedDaily, historicalDecision: decision('GOOD', { technical: { ...detail().technical, recoveryStage: 'BOTTOMING' } }) });
  assert.equal(gate.passed, false);
  assert.ok(gate.failures.includes('RECOVERY_STAGE_NOT_ACCEPTABLE'));
});

test('early and confirmed recovery can qualify', () => {
  assert.equal(evaluateConversionGate({ daily: executedDaily, historicalDecision: decision() }).passed, true);
  assert.equal(evaluateConversionGate({ daily: executedDaily, historicalDecision: decision('GOOD', { technical: { ...detail().technical, recoveryStage: 'CONFIRMED_RECOVERY' } }) }).passed, true);
});

test('insufficient fundamentals becomes extended watch only', () => {
  const d = detail({
    fundamental: { ...detail().fundamental, fundamentalDataConfidence: 'UNAVAILABLE', fundamentalQualityScore: null },
    dataCompleteness: 'PARTIAL',
  });
  const gate = evaluateConversionGate({ daily: executedDaily, historicalDecision: { ticker: 'GOOD', detail: d } });
  assert.equal(gate.classificationCode, 'EXTENDED_WATCH');
  assert.ok(gate.classificationAr.includes('البيانات المالية غير مكتملة'));
});

test('high financial risk, value trap, negative news, corporate action, overheated RSI block', () => {
  assert.ok(evaluateConversionGate({ daily: executedDaily, historicalDecision: decision('GOOD', { risk: { classification: 'VERY_HIGH' } }) }).failures.includes('SEVERE_FINANCIAL_RISK'));
  assert.ok(evaluateConversionGate({ daily: executedDaily, historicalDecision: decision('GOOD', { valueTrapRisk: { classification: 'HIGH' } }) }).failures.includes('VALUE_TRAP_RISK'));
  assert.ok(evaluateConversionGate({ daily: executedDaily, historicalDecision: decision('GOOD', { severeVerifiedNegativeEvent: true }) }).failures.includes('MATERIAL_NEGATIVE_NEWS'));
  assert.ok(evaluateConversionGate({ daily: executedDaily, historicalDecision: decision('GOOD', { historicalDataQuality: { status: 'REVIEW_REQUIRED', reasons: ['CORPORATE_ACTION'], corporateActionConfidence: 'UNKNOWN' } }) }).failures.includes('INVALID_LONG_HISTORY'));
  assert.ok(evaluateConversionGate({ daily: executedDaily, historicalDecision: decision('GOOD', { technical: { ...detail().technical, rsi14: 80 } }) }).failures.includes('SEVERE_TECHNICAL_EXTENSION'));
});

test('medium and long-term classification require stronger fundamentals', () => {
  const medium = evaluateConversionGate({ daily: executedDaily, historicalDecision: decision('GOOD', { fundamental: { ...detail().fundamental, fundamentalQualityScore: 55 } }) });
  assert.equal(medium.classificationCode, 'MEDIUM_TERM');
  const long = evaluateConversionGate({ daily: executedDaily, historicalDecision: decision() });
  assert.equal(long.classificationCode, 'MEDIUM_LONG_TERM');
});

test('historical high approach, reached, breakout, invalidation states', () => {
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 94 }, detail({ historical: { ...detail().historical, current: 94 } })).state, 'HOLD_WITH_MONITORING');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 100 }, detail({ historical: { ...detail().historical, current: 100 } })).state, 'REFERENCE_TARGET_REACHED');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 105 }, detail({ historical: { ...detail().historical, current: 105 } })).state, 'BREAKOUT_CONFIRMING');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 105 }, detail({ historical: { ...detail().historical, current: 105 }, technical: { ...detail().technical, sessionsAboveHistoricalHigh: 2 } })).state, 'BREAKOUT_CONFIRMED');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 97, previousReviewState: 'BREAKOUT_CONFIRMING' }, detail({ historical: { ...detail().historical, current: 97 } })).state, 'FAILED_BREAKOUT');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 60 }, detail({ technical: { ...detail().technical, strengthScore: 20 } })).state, 'REDUCE_RISK_REVIEW');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 60 }, detail({ severeVerifiedNegativeEvent: true })).state, 'EXIT_SIGNAL');
});

test('controlled positive breakout path and failed breakout branch', () => {
  const at = current => detail({ historical: { ...detail().historical, current } });
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 89 }, at(89)).state, 'RESEARCH_HOLD');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 91 }, at(91)).state, 'HOLD_WITH_MONITORING');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 96 }, at(96)).state, 'HOLD_WITH_MONITORING');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 100 }, at(100)).state, 'REFERENCE_TARGET_REACHED');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 101 }, at(101)).state, 'BREAKOUT_CONFIRMING');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 103 }, detail({ historical: { ...detail().historical, current: 103 }, technical: { ...detail().technical, sessionsAboveHistoricalHigh: 2 } })).state, 'BREAKOUT_CONFIRMED');
  assert.equal(assessExitState({ historicalHigh: 100, currentPrice: 97, previousReviewState: 'BREAKOUT_CONFIRMING' }, at(97)).state, 'FAILED_BREAKOUT');
});

test('bridge performance separate and immutable history exists', () => {
  const dataset = buildBridgeDataset({
    daily: { file: 'daily.json', dataset: { sessionId: '2026-08-09' }, rows: [executedDaily] },
    historical: { file: 'historical.json', snapshot: { decisions: [decision()] }, byTicker: new Map([['GOOD', decision()]]) },
    previous: null,
    asOf: new Date('2026-08-09T12:00:00Z'),
  });
  assert.equal(dataset.performance.separateFromDailyStrategy, true);
  assert.ok(dataset.decisionHistory.length > 0);
  assert.equal(validateBridgeOutput(toPublicDataset(dataset)).valid, true);
});

test('public JSON contains no raw enum values', () => {
  const dataset = toPublicDataset(buildBridgeDataset({
    daily: { file: 'daily.json', dataset: { sessionId: '2026-08-09' }, rows: [{ ...executedDaily, executionStatus: 'KEEP_CASH' }] },
    historical: { file: 'historical.json', snapshot: { decisions: [decision()] }, byTicker: new Map([['GOOD', decision()]]) },
    previous: null, asOf: new Date('2026-08-09T12:00:00Z'),
  }));
  assert.equal(validateBridgeOutput(dataset).valid, true);
  assert.ok(!JSON.stringify(dataset).includes('NOT_EXECUTED'));
});

test('current public badges cannot mark non-executed rows green', () => {
  const current = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/v17/investment-bridge/current.json'), 'utf8'));
  const rejected = new Set((current.pilotSanityRows || []).filter(row => row.executionStatus === 'لم يتم التنفيذ اليومي').map(row => row.ticker));
  for (const row of current.newMatches || []) if (rejected.has(row.ticker)) assert.ok(!String(row.badgeAr).includes('🟢'));
});

test('actual daily cards receive historical-match badges without false green conversion', () => {
  const historical = { byTicker: new Map([['GOOD', decision()]]), inventoryTickers: new Set(['GOOD']) };
  const badges = buildDailyRecommendationBadges([{ ticker: 'GOOD', state: 'PENDING_OPEN_CONFIRMATION', executed: false }], historical);
  assert.equal(badges[0].historicalMatch, true);
  assert.equal(badges[0].conversionAllowed, false);
  assert.ok(badges[0].badgeAr.includes('مطابق للحصر التاريخي'));
  assert.ok(!badges[0].badgeAr.includes('🟢'));
});

test('price-history inventory match remains non-convertible without intelligence decision', () => {
  const badges = buildDailyRecommendationBadges([{ ticker: 'ONLYHISTORY', state: 'PENDING_OPEN_CONFIRMATION', executed: false }], { byTicker: new Map(), inventoryTickers: new Set(['ONLYHISTORY']) });
  assert.equal(badges[0].historicalMatch, true);
  assert.equal(badges[0].conversionAllowed, false);
  assert.ok(!badges[0].badgeAr.includes('🟢'));
});

test('data-source failure retains lastKnownValid', () => {
  const previous = { activePositions: [{ ticker: 'OLD' }], lastKnownValid: { activePositions: [{ ticker: 'OLD' }] }, decisionHistory: [] };
  const dataset = buildBridgeDataset({
    daily: { file: null, dataset: null, rows: [] },
    historical: { file: 'historical.json', snapshot: { decisions: [] }, byTicker: new Map() },
    previous,
    asOf: new Date('2026-08-09T12:00:00Z'),
  });
  assert.ok(dataset.sourceHealth.failureSafeAr);
  assert.ok(dataset.lastKnownValid);
});

test('Cairo timezone/weekend label and Arabic labels are present', () => {
  const dataset = buildBridgeDataset({
    daily: { file: 'daily.json', dataset: { sessionId: '2026-08-09' }, rows: [executedDaily] },
    historical: { file: 'historical.json', snapshot: { decisions: [decision()] }, byTicker: new Map([['GOOD', decision()]]) },
    previous: null,
    asOf: new Date('2026-08-09T12:00:00Z'),
  });
  assert.ok(dataset.independenceStatementAr.includes('مستقل'));
  assert.ok(dataset.activePositions[0].dailyReview.sectionAr.includes('متابعة المراكز'));
});

test('V16.9 frozen-path protection', () => {
  const result = checkPaths([
    'scripts/v17/investment-bridge/build.cjs',
    'data/v17/investment-bridge/current.json',
    'tests/v17/investment-bridge.test.cjs',
    'docs/v17/DAILY_INVESTMENT_BRIDGE.md',
  ]);
  assert.deepEqual(result.violations, []);
});

test('bridge UI publishes count cards without score suffix and with matching cache keys', () => {
  const appDir = path.resolve(__dirname, '../../preview-v17/app');
  const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(appDir, 'styles.css'), 'utf8');
  const styleVersion = html.match(/styles\.css\?v=([^"']+)/)?.[1];
  const scriptVersion = html.match(/app\.js\?v=([^"']+)/)?.[1];
  assert.equal((html.match(/class="score-card bridge-count"/g) || []).length, 4);
  assert.ok(css.includes('.bridge-count strong::after{content:none}'));
  assert.ok(styleVersion);
  assert.equal(styleVersion, scriptVersion);
  const app = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
  assert.ok(app.includes('bridgeBadges'));
  assert.ok(app.includes('bridge-badge'));
  assert.ok(app.includes(`'<div class="empty">${BRIDGE_EMPTY_STATE_AR}</div>'`));
});
