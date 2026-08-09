'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDecisionSnapshot, stabilizeDecision, describeChange } = require('../../scripts/v17/historical-recovery/intelligence/decisions.cjs');
const { buildAlerts } = require('../../scripts/v17/historical-recovery/intelligence/alerts.cjs');
const { isTradingWeekday, monitoringWindow, shouldRunScheduledMode } = require('../../scripts/v17/historical-recovery/intelligence/exchange-calendar.cjs');
const { publishValidatedAtomic } = require('../../scripts/v17/historical-recovery/intelligence/build.cjs');
const { validateDecisionHistory } = require('../../scripts/v17/historical-recovery/intelligence/validate.cjs');
const { checkPaths } = require('../../scripts/v17/frozen-path-check.cjs');

function row(overrides = {}) { return { ticker: 'TEST', classificationCode: 'POSITIVE_WATCH', classificationAr: 'مراقبة إيجابية', classificationReasonsAr: ['سبب'], investmentResearchScore: 65, overallDataConfidence: 80, dataCompleteness: 'FULL', decisionState: 'VALID', severeVerifiedNegativeEvent: false, risk: { classification: 'MEDIUM', labelAr: 'متوسط' }, technical: { recoveryStage: 'EARLY_RECOVERY', recoveryScore: 65, strengthScore: 60 }, fundamental: { fundamentalQualityScore: 65, valuation: { score: 60 } }, news: { newsImpactScore: 0 }, historical: { current: 60, postPeakLow: 50 }, evidenceReferences: ['fixture'], ...overrides }; }

test('building a new snapshot never mutates the prior immutable object', () => {
  const first = buildDecisionSnapshot([row()], null, new Date('2026-08-08T10:00:00Z'));
  const before = JSON.stringify(first);
  buildDecisionSnapshot([row({ investmentResearchScore: 75, classificationCode: 'STAGED_INVESTMENT_CANDIDATE', classificationAr: 'مرشح استثماري تدريجي' })], first, new Date('2026-08-09T10:00:00Z'));
  assert.equal(JSON.stringify(first), before);
});
test('upgrade and downgrade deltas are explained', () => {
  assert.ok(describeChange(row({ classificationCode: 'WAIT' }), row()).types.includes('CLASSIFICATION_UPGRADE'));
  assert.ok(describeChange(row(), row({ classificationCode: 'WAIT' })).types.includes('CLASSIFICATION_DOWNGRADE'));
});
test('risk changes are independently explained', () => assert.ok(describeChange(row(), row({ risk: { classification: 'HIGH' } })).types.includes('RISK_INCREASE')));
test('hysteresis prevents adjacent flip-flop on a small score move', () => {
  const previous = row({ classificationCode: 'POSITIVE_WATCH', classificationAr: 'مراقبة إيجابية', investmentResearchScore: 69 });
  const current = row({ classificationCode: 'STAGED_INVESTMENT_CANDIDATE', classificationAr: 'مرشح استثماري تدريجي', investmentResearchScore: 71 });
  assert.equal(stabilizeDecision(current, previous).classificationCode, 'POSITIVE_WATCH');
});
test('material downgrade creates an important alert', () => {
  const first = buildDecisionSnapshot([row()], null, new Date('2026-08-08T10:00:00Z'));
  const second = buildDecisionSnapshot([row({ classificationCode: 'WAIT', classificationAr: 'انتظار', investmentResearchScore: 50 })], first, new Date('2026-08-09T10:00:00Z'));
  assert.ok(buildAlerts(second).alerts.some(x => ['IMPORTANT', 'CRITICAL'].includes(x.severity)));
});
test('alert fingerprints deduplicate the same state across scans', () => {
  const first = buildDecisionSnapshot([row()], null, new Date('2026-08-07T10:00:00Z'));
  const second = buildDecisionSnapshot([row({ classificationCode: 'WAIT', classificationAr: 'انتظار', investmentResearchScore: 50 })], first, new Date('2026-08-08T10:00:00Z'));
  const alerts = buildAlerts(second);
  assert.equal(buildAlerts(second, alerts).newAlertCount, 0);
});
test('opportunity entry and exit appear as upgrade and downgrade', () => {
  assert.ok(describeChange(row({ classificationCode: 'WAIT' }), row({ classificationCode: 'STAGED_INVESTMENT_CANDIDATE' })).types.includes('CLASSIFICATION_UPGRADE'));
  assert.ok(describeChange(row({ classificationCode: 'STAGED_INVESTMENT_CANDIDATE' }), row({ classificationCode: 'WAIT' })).types.includes('CLASSIFICATION_DOWNGRADE'));
});
test('break below the prior post-peak trough is critical evidence', () => {
  const delta = describeChange(row({ historical: { current: 55, postPeakLow: 50 } }), row({ historical: { current: 45, postPeakLow: 45 } }));
  assert.ok(delta.types.includes('BREAK_BELOW_POST_PEAK_TROUGH'));
});
test('Friday and Saturday are never trading weekdays', () => {
  assert.equal(isTradingWeekday(new Date('2026-08-07T10:00:00Z')), false);
  assert.equal(isTradingWeekday(new Date('2026-08-08T10:00:00Z')), false);
});
test('Cairo pre-market and post-market windows are deterministic', () => {
  assert.equal(monitoringWindow(new Date('2026-08-09T05:00:00Z')), 'PRE_MARKET_REVIEW');
  assert.equal(monitoringWindow(new Date('2026-08-09T12:30:00Z')), 'POST_MARKET_FULL_REVIEW');
});
test('dual UTC cron triggers execute exactly once in Cairo local time', () => {
  assert.equal(shouldRunScheduledMode('PRE_MARKET', new Date('2026-08-09T05:15:00Z')), true);
  assert.equal(shouldRunScheduledMode('PRE_MARKET', new Date('2026-08-09T06:15:00Z')), false);
  assert.equal(shouldRunScheduledMode('POST_MARKET', new Date('2026-08-09T12:15:00Z')), true);
  assert.equal(shouldRunScheduledMode('POST_MARKET', new Date('2026-08-09T13:15:00Z')), false);
  assert.equal(shouldRunScheduledMode('PRE_MARKET', new Date('2026-01-11T06:15:00Z')), true);
});
test('post-market comparison records the prior decision', () => {
  const first = buildDecisionSnapshot([row()], null, new Date('2026-08-08T10:00:00Z'));
  const second = buildDecisionSnapshot([row({ classificationCode: 'WAIT', classificationAr: 'انتظار' })], first, new Date('2026-08-09T10:00:00Z'));
  assert.equal(second.decisions[0].previousDecision, 'POSITIVE_WATCH');
});
test('failed validation preserves the previous public dataset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-atomic-'));
  const file = path.join(dir, 'current.json'); fs.writeFileSync(file, '{"valid":true}\n');
  assert.throws(() => publishValidatedAtomic(file, { valid: false }, () => ({ valid: false, issues: ['FIXTURE'] })));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { valid: true });
});
test('decision history validator enforces an immutable chain', () => {
  const a = buildDecisionSnapshot([row()], null, new Date('2026-08-08T10:00:00Z'));
  const b = buildDecisionSnapshot([row()], a, new Date('2026-08-09T10:00:00Z'));
  const index = { snapshots: [{ snapshotId: a.snapshotId }, { snapshotId: b.snapshotId }] };
  assert.equal(validateDecisionHistory(index, { [a.snapshotId]: a, [b.snapshotId]: b }).valid, true);
});
test('frozen checker protects shared history, symbol map, V17 daily outputs and V16 workflows', () => {
  const paths = ['data/history/A.json', 'data/symbol-map.json', 'data/v17/current.json', 'data/v17/ledger.json', '.github/workflows/v16-daily-recommendation-scan.yml'];
  assert.equal(checkPaths(paths).violations.length, paths.length);
});
