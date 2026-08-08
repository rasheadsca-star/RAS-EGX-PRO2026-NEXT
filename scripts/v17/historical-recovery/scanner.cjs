#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadHistory } = require('./history-loader.cjs');
const { assessAdjustment } = require('./adjustment-policy.cjs');
const { calculateIndicators } = require('./indicators.cjs');
const { scoreMetrics } = require('./scoring.cjs');
const { validateOutput } = require('./validate-output.cjs');

const stageArabic = {
  DATA_REVIEW_REQUIRED: 'يحتاج مراجعة بيانات',
  NO_RECOVERY: 'لا توجد إشارات تعافٍ',
  BOTTOMING: 'تكوين قاع',
  EARLY_RECOVERY: 'بداية تعافٍ',
  RECOVERY_CONFIRMED: 'تعافٍ مؤكد',
  RECOVERY_EXTENDED: 'تعافٍ ممتد – ابتعد عن القاع',
};
const bottomArabic = { EXTREME_BOTTOM: 'عند قاع شديد', NEAR_BOTTOM: 'بالقرب من القاع', BOTTOM_ZONE: 'داخل منطقة القاع', ABOVE_BOTTOM_ZONE: 'أعلى من منطقة القاع' };

function reasonArabic(reason) {
  const [code, ...detail] = String(reason).split(':');
  const value = detail.join(':');
  const labels = {
    insufficient_history: 'البيانات التاريخية غير كافية', stale_history: 'البيانات التاريخية غير محدثة وفق جلسات التداول المتوقعة',
    missing_adjusted_close: 'بيانات السعر المعدل غير مكتملة', corporate_action_review: 'السهم يحتاج مراجعة بسبب إجراء رأسمالي محتمل',
    symbol_not_verified: 'هوية السهم غير موثقة', split_like_discontinuity: 'توجد قفزة سعرية تشبه أثر التجزئة أو الإجراء الرأسمالي',
    current_drawdown_gate_passed: 'السهم ما زال عند خصم حالي جوهري من القمة', current_drawdown_gate_failed: 'لا يوجد هبوط حالي جوهري كافٍ من القمة',
    higher_low_confirmed: 'تكوّن قاع أعلى من القاع السابق', higher_low_not_confirmed: 'لم يتأكد تكوّن قاع أعلى',
    rsi_recovering: 'مؤشر القوة النسبية يتحسن', rsi_not_recovering: 'مؤشر القوة النسبية لا يؤكد التعافي',
    volume_confirmed: 'أحجام التداول تدعم التعافي', volume_not_confirmed: 'أحجام التداول لا تؤكد التعافي',
    trend_20_over_50: 'الاتجاه القصير تجاوز الاتجاه المتوسط إيجابيًا', trend_20_not_over_50: 'الاتجاه القصير لم يتجاوز الاتجاه المتوسط',
    rsi_extension_above_80: 'مؤشر RSI مرتفع وقد يعكس سخونة سعرية', strong_rsi_extension_above_90: 'سخونة سعرية شديدة مع مؤشر RSI أعلى من 90',
    drawdown: 'نسبة الهبوط من أعلى سعر معدل خلال الفترة', distance_from_low: 'نسبة الارتفاع عن أدنى سعر معدل خلال الفترة',
    maximum_peak_to_trough_decline: 'أكبر هبوط من قمة إلى قاع خلال الفترة',
  };
  return `${labels[code] || 'ملاحظة جودة بيانات'}${value ? ` (${value})` : ''}`;
}

function verifiedDisplayNames(document, ticker) {
  const rawArabic = String(document.companyNameAr || '').trim();
  const cleanArabic = /[\u0600-\u06ff]/.test(rawArabic) && !/End AdSlot|-->|^[\s\[\],0-9]+/i.test(rawArabic) ? rawArabic : null;
  const english = String(document.companyNameEn || '').replace(/End AdSlot|-->/gi, ' ').replace(/^[\s\[\],0-9]+/, '').replace(/\s+/g, ' ').trim() || null;
  return { companyNameAr: cleanArabic, companyNameEn: english, displayName: cleanArabic || english || ticker };
}

function percentileRanks(rows, selector) {
  const sorted = rows.map(selector).filter(Number.isFinite).sort((a, b) => a - b);
  return rows.map(row => {
    const value = selector(row);
    if (!Number.isFinite(value) || sorted.length < 2) return null;
    return sorted.lastIndexOf(value) / (sorted.length - 1) * 100;
  });
}

function runScanner(root, config, generatedAt = new Date().toISOString()) {
  const loaded = loadHistory(root, config);
  const prepared = loaded.map(item => {
    const adjustment = assessAdjustment(item, config);
    return adjustment.eligible ? { item, adjustment, metrics: calculateIndicators(item.sessions, config) } : { item, adjustment, metrics: null };
  });
  const eligible = prepared.filter(row => row.metrics);
  const ranks = percentileRanks(eligible, row => row.metrics.momentum20Pct);
  eligible.forEach((row, index) => { row.relativeRecoveryStrength = ranks[index]; });
  const results = prepared.map(row => {
    const names = verifiedDisplayNames(row.item.document, row.item.ticker);
    if (!row.metrics) return {
      symbol: row.item.ticker,
      ...names,
      stage: 'DATA_REVIEW_REQUIRED',
      recoveryStage: null,
      bottomClassification: null,
      stageAr: stageArabic.DATA_REVIEW_REQUIRED,
      dataConfidence: 0,
      adjustmentStatus: row.adjustment.adjustedOhlcStatus,
      reasons: row.adjustment.reasons,
      reasonsAr: row.adjustment.reasons.map(reasonArabic),
    };
    const scored = scoreMetrics(row.metrics, { relativeRecoveryStrength: row.relativeRecoveryStrength, ...config });
    const adjustedCoverage = row.item.coverage.adjustedCloseCoveragePct;
    const dataConfidence = Math.max(0, Math.min(100, adjustedCoverage * 0.7 + Math.min(100, row.item.sessions.length) * 0.3));
    return {
      symbol: row.item.ticker,
      ...names,
      stage: scored.recoveryStage,
      recoveryStage: scored.recoveryStage,
      recoveryStageAr: stageArabic[scored.recoveryStage],
      stageAr: stageArabic[scored.recoveryStage],
      bottomClassification: scored.bottomClassification,
      bottomClassificationAr: bottomArabic[scored.bottomClassification],
      strengthScore: scored.strengthScore,
      recoveryScore: scored.recoveryScore,
      dataConfidence: Number(dataConfidence.toFixed(2)),
      relativeRecoveryStrength: row.relativeRecoveryStrength === null ? null : Number(row.relativeRecoveryStrength.toFixed(2)),
      adjustmentStatus: 'ADJUSTED_CLOSE_SOURCE_WITH_DERIVED_OHLC_POLICY',
      dataQuality: { ...row.item.coverage, staleness: row.item.staleness },
      metrics: row.metrics,
      reasons: scored.reasons,
      reasonsAr: scored.reasons.map(reasonArabic),
    };
  }).sort((a, b) => (b.recoveryScore || -1) - (a.recoveryScore || -1) || a.symbol.localeCompare(b.symbol));
  const stages = ['DATA_REVIEW_REQUIRED', 'NO_RECOVERY', 'BOTTOMING', 'EARLY_RECOVERY', 'RECOVERY_CONFIRMED', 'RECOVERY_EXTENDED'];
  const counts = Object.fromEntries(stages.map(stage => [stage, results.filter(row => row.stage === stage).length]));
  const exclusionReasonCounts = {};
  for (const row of results.filter(item => item.stage === 'DATA_REVIEW_REQUIRED')) for (const reason of row.reasons || []) {
    const code = String(reason).split(':')[0];
    exclusionReasonCounts[code] = (exclusionReasonCounts[code] || 0) + 1;
  }
  for (const required of ['insufficient_history', 'stale_history', 'missing_adjusted_close', 'corporate_action_review', 'symbol_not_verified', 'split_like_discontinuity', 'corrupt_history']) {
    if (!(required in exclusionReasonCounts)) exclusionReasonCounts[required] = 0;
  }
  const validRows = results.filter(row => row.stage !== 'DATA_REVIEW_REQUIRED');
  const bottomUniverse = validRows.slice().sort((a, b) => a.metrics.distanceFromAvailableWindowAdjustedLowPct - b.metrics.distanceFromAvailableWindowAdjustedLowPct || b.recoveryScore - a.recoveryScore || a.symbol.localeCompare(b.symbol));
  const topRecoveryOpportunities = validRows.filter(row => row.bottomClassification !== 'ABOVE_BOTTOM_ZONE' && ['BOTTOMING', 'EARLY_RECOVERY', 'RECOVERY_CONFIRMED'].includes(row.recoveryStage)).sort((a, b) => b.recoveryScore - a.recoveryScore || a.metrics.distanceFromAvailableWindowAdjustedLowPct - b.metrics.distanceFromAvailableWindowAdjustedLowPct || a.symbol.localeCompare(b.symbol));
  const bottomCounts = Object.fromEntries(['EXTREME_BOTTOM','NEAR_BOTTOM','BOTTOM_ZONE','ABOVE_BOTTOM_ZONE'].map(code => [code, validRows.filter(row => row.bottomClassification === code).length]));
  return {
    schemaVersion: '17.0.0-historical-recovery-1',
    generatedAt,
    operatingMode: 'SHORT_WINDOW_RESEARCH',
    researchOnly: true,
    independenceStatement: 'This scanner is independent from the daily recommendation basket.',
    independenceStatementAr: 'هذه الأداة مستقلة تمامًا عن سلة التوصيات اليومية، ونتائجها لأغراض البحث والتحليل فقط وليست توصيات شراء أو بيع.',
    terminology: { high: 'available-window adjusted high', low: 'available-window adjusted low', rank: 'recovery research rank' },
    dataPolicy: { sharedHistoryReadOnly: true, adjustedComparableField: 'adjustedClose', adjustedOhlc: 'DERIVED_IF_USED', corporateActionEvidence: 'NON_AUTHORITATIVE' },
    summary: { stocksScanned: results.length, validDataStocks: validRows.length, dataEligibleStocks: validRows.length, quarantinedOrDataReview: counts.DATA_REVIEW_REQUIRED, exclusionReasonCounts, bottomClassificationCounts: bottomCounts, stageCounts: counts, dashboardCounts: { extremeBottom: bottomCounts.EXTREME_BOTTOM, nearBottom: bottomCounts.NEAR_BOTTOM, bottomZone: bottomCounts.BOTTOM_ZONE, aboveBottomZone: bottomCounts.ABOVE_BOTTOM_ZONE, noRecovery: counts.NO_RECOVERY, bottoming: counts.BOTTOMING, earlyRecovery: counts.EARLY_RECOVERY, confirmedRecovery: counts.RECOVERY_CONFIRMED, movedAwayFromLow: counts.RECOVERY_EXTENDED, topRecoveryOpportunities: topRecoveryOpportunities.length } },
    bottomUniverse,
    topRecoveryOpportunities,
    results,
  };
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'data/v17/historical-recovery/config.json'), 'utf8'));
  const output = runScanner(root, config);
  const validation = validateOutput(output);
  if (!validation.valid) throw new Error(`Output validation failed: ${validation.findings.join(', ')}`);
  writeAtomic(path.join(root, 'data/v17/historical-recovery/current.json'), output);
  writeAtomic(path.join(root, 'data/v17/historical-recovery/review.json'), { schemaVersion: '17.0.0-historical-recovery-review-1', generatedAt: output.generatedAt, verdict: 'PASS', ...validation });
  console.log(JSON.stringify(output.summary, null, 2));
}

module.exports = { runScanner };
