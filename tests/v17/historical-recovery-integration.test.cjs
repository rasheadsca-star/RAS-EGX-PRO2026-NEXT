'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScanner } = require('../../scripts/v17/historical-recovery/scanner.cjs');
const { validateOutput } = require('../../scripts/v17/historical-recovery/validate-output.cjs');
const { checkPaths } = require('../../scripts/v17/frozen-path-check.cjs');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hrs-integration-'));
  fs.mkdirSync(path.join(root, 'data/history'), { recursive: true });
  const rows = Array.from({ length: 70 }, (_, i) => { const p = i < 35 ? 100 - i : 65 + (i - 35) * 0.8; return { date: `S${i}`, open: p, high: p, low: p, close: p, adjustedClose: p, volume: i > 64 ? 1600 : 1000 }; });
  fs.writeFileSync(path.join(root, 'data/history/SAFE.json'), JSON.stringify({ ticker: 'SAFE', symbolVerified: true, sessions: rows }));
  fs.writeFileSync(path.join(root, 'data/corporate-actions.json'), JSON.stringify({ candidates: [] }));
  return root;
}
test('independent scanner output passes the research-only contract', () => {
  const output = runScanner(makeRoot(), { minimumSessions: 60, splitLikeRawJumpPct: 35, higherLowMinimumPct: 2, volumeExpansionMinimum: 1.2 }, '2026-08-08T00:00:00.000Z');
  assert.equal(output.summary.stocksScanned, 1);
  assert.equal(output.independenceStatement, 'This scanner is independent from the daily recommendation basket.');
  assert.equal(validateOutput(output).valid, true);
  assert.equal(output.bottomUniverse.length, output.summary.validDataStocks);
});
test('every eligible rendered row has complete finite fields and Arabic display text', () => {
  const output = runScanner(makeRoot(), { minimumSessions: 60, splitLikeRawJumpPct: 35, higherLowMinimumPct: 2, volumeExpansionMinimum: 1.2 }, '2026-08-08T00:00:00.000Z');
  for (const row of output.results.filter(item => item.stage !== 'DATA_REVIEW_REQUIRED')) {
    for (const key of ['availableWindowAdjustedHigh', 'currentAdjustedPrice', 'drawdownFromAvailableWindowAdjustedHighPct', 'availableWindowAdjustedLow', 'distanceFromAvailableWindowAdjustedLowPct', 'rsi14']) assert.ok(Number.isFinite(row.metrics[key]), `${row.symbol}:${key}`);
    for (const key of ['strengthScore', 'recoveryScore', 'dataConfidence']) assert.ok(Number.isFinite(row[key]), `${row.symbol}:${key}`);
    assert.ok(row.stageAr);
    assert.equal(row.reasons.length, row.reasonsAr.length);
  }
});
test('frozen V16.9 path protection rejects every protected category', () => {
  const result = checkPaths(['preview-v169/index.html', 'scripts/stable/x.cjs', 'data/stable/x.json', '.github/workflows/v169-primary-pages-deploy.yml', 'preview-v17/historical-recovery/app.js']);
  assert.equal(result.violations.length, 4);
  assert.ok(!result.violations.includes('preview-v17/historical-recovery/app.js'));
});
test('Arabic long-history UI has complete primary translations and hides raw reason codes', () => {
  const root = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(root, 'preview-v17/historical-recovery/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'preview-v17/historical-recovery/app.js'), 'utf8');
  for (const text of ['محرك التعافي التاريخي طويل الأفق', 'عدد الأسهم التي تم فحصها', 'بيانات تاريخية سليمة', 'تحتاج مراجعة بيانات', 'أكثر من 35% تحت القمة', 'عند القاع أو قريب منه', 'بداية تعافٍ', 'تعافٍ مؤكد', 'أفضل فرص التعافي', 'الأسهم الأقرب إلى قاع دورة الهبوط', 'الأسهم التي هبطت بقوة وما زالت قرب قاع دورة الهبوط', 'أكبر فجوة عن القمة', 'كيف نقرأ النتائج؟', 'اسم السهم', 'الكود', 'سبب المراجعة']) assert.ok(html.includes(text), text);
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.ok(app.includes('r.recoveryStageAr'));
  assert.ok(app.includes('r.displayName'));
  assert.ok(app.includes('reasonAr'));
  assert.ok(!app.includes("(r.dataQualityReasons||[]).join"));
});
