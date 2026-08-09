#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const KEY_TICKERS = ['SKPC', 'ELEC', 'SUGR', 'SPMD', 'IRON', 'AREH', 'NAHO', 'ODIN', 'CFGH'];
const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));

function compactStock(row) {
  const h = row.historical || {};
  return {
    arabicCompanyName: row.companyNameAr,
    ticker: row.ticker,
    historicalDrawdownPct: h.currentDrawdownPct ?? null,
    recoveryPositionPct: h.recoveryPositionPct ?? null,
    recoveryScore: row.technical?.recoveryScore ?? null,
    strengthScore: row.technical?.strengthScore ?? null,
    fundamentalQuality: row.fundamental?.fundamentalQualityScore ?? null,
    financialRisk: row.risk?.labelAr ?? 'غير متاح',
    valuationScore: row.fundamental?.valuation?.score ?? null,
    newsImpact: row.news?.newsImpactScore ?? null,
    newsConfidence: row.news?.newsConfidence ?? null,
    valueTrapRisk: row.valueTrapRisk?.labelAr ?? 'غير متاح',
    investmentResearchScore: row.investmentResearchScore,
    previousClassification: row.previousDecisionAr || 'لا يوجد — أول تقييم متكامل',
    newClassification: row.classificationAr,
    dataConfidence: row.overallDataConfidence,
    keyPositives: row.positivesAr,
    keyNegatives: row.negativesAr,
    latestMaterialEvent: row.news?.latestMaterialEvent?.summaryAr || null,
    decisionChanged: row.decisionChanged,
    changeReasons: row.changeReasonsAr,
  };
}

function buildRunReport(data) {
  const rows = data.results || [];
  const integrated = rows.filter(row => finite(row.investmentResearchScore)).sort((a, b) => b.investmentResearchScore - a.investmentResearchScore);
  const financiallySupportedRecovery = integrated.filter(row => row.technical?.recoveryScore >= 55 && row.fundamental?.fundamentalQualityScore >= 55);
  const valueTraps = rows.filter(row => row.valueTrapRisk?.classification === 'HIGH').sort((a, b) => b.valueTrapRisk.score - a.valueTrapRisk.score);
  const positiveChanges = rows.filter(row => row.changeTypes?.includes('CLASSIFICATION_UPGRADE'));
  const negativeChanges = rows.filter(row => row.changeTypes?.includes('CLASSIFICATION_DOWNGRADE') || row.changeTypes?.includes('MATERIAL_NEGATIVE_NEWS'));
  const events = rows.flatMap(row => (row.news?.materialEvents || []).map(event => ({ ticker: row.ticker, companyNameAr: row.companyNameAr, ...event }))).sort((a, b) => Math.abs(b.newsImpactScore) - Math.abs(a.newsImpactScore));
  return {
    schemaVersion: '17.4.0-integrated-run-report-1',
    generatedAt: data.generatedAt,
    summary: data.summary,
    sourceHealth: data.sourceHealth,
    keyStockSanityReview: KEY_TICKERS.map(ticker => rows.find(row => row.ticker === ticker)).filter(Boolean).map(compactStock),
    topIntegratedCandidates: integrated.slice(0, 20).map(compactStock),
    topFinanciallySupportedRecovery: financiallySupportedRecovery.slice(0, 20).map(compactStock),
    topPotentialValueTraps: valueTraps.slice(0, 20).map(compactStock),
    topPositiveDecisionChanges: positiveChanges.slice(0, 20).map(compactStock),
    topNegativeDecisionChanges: negativeChanges.slice(0, 20).map(compactStock),
    mostImportantMaterialEvents: events.slice(0, 20),
    immediateReview: rows.filter(row => row.classificationCode === 'REVIEW_REQUIRED').map(compactStock),
  };
}

function markdown(report) {
  const s = report.summary;
  const lines = [
    '# تقرير التشغيل المتكامل — V17 Historical Recovery', '',
    `تاريخ التوليد: ${report.generatedAt}`, '',
    '## التغطية', '',
    `- نطاق الأسهم العادية: ${s.canonicalEquityUniverse}`,
    `- تغطية السعر والتاريخ: ${s.priceHistoryCovered}`,
    `- بيانات تاريخية سليمة: ${s.historicalDataValid}`,
    `- تغطية مالية موثقة: ${s.fundamentalCoverage}`,
    `- تغطية أخبار وإفصاحات: ${s.newsDisclosureCoverage}`,
    `- تغطية متكاملة: ${s.fullDataCoverage}`,
    `- تغطية جزئية: ${s.partialDataCoverage}`,
    `- بيانات تاريخية غير متاحة/تحتاج مراجعة: ${s.unavailableData}`, '',
    '## النتيجة', '',
    report.topIntegratedCandidates.length ? `يوجد ${report.topIntegratedCandidates.length} مرشحًا متكاملًا للعرض.` : 'لا توجد فرصة مكتملة الشروط حاليًا.',
    '', 'غياب التغطية المالية أو الإخبارية لا يُستبدل بدرجة محايدة، ولا يرفع أي سهم إلى تصنيف إيجابي.', '',
    '## مراجعة الأسهم المحددة', '',
    '| الشركة | الكود | الهبوط | موضع التعافي | التعافي | القوة | الجودة المالية | المخاطرة | التقييم | أثر الأخبار | القرار الجديد |',
    '|---|---|---:|---:|---:|---:|---:|---|---:|---:|---|',
    ...report.keyStockSanityReview.map(row => `| ${row.arabicCompanyName || 'غير متاح'} | ${row.ticker} | ${row.historicalDrawdownPct ?? 'غير متاح'} | ${row.recoveryPositionPct ?? 'غير متاح'} | ${row.recoveryScore ?? 'غير متاح'} | ${row.strengthScore ?? 'غير متاح'} | ${row.fundamentalQuality ?? 'غير متاح'} | ${row.financialRisk} | ${row.valuationScore ?? 'غير متاح'} | ${row.newsImpact ?? 'غير متاح'} | ${row.newClassification} |`),
  ];
  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/v17/historical-recovery/integrated-market.json'), 'utf8'));
  const report = buildRunReport(data);
  fs.writeFileSync(path.join(root, 'data/v17/historical-recovery/intelligence/run-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'docs/v17/INTEGRATED_RESEARCH_RUN.md'), markdown(report));
  console.log(JSON.stringify({ summary: report.summary, keyStocks: report.keyStockSanityReview.length, integratedCandidates: report.topIntegratedCandidates.length }, null, 2));
}

module.exports = { KEY_TICKERS, compactStock, buildRunReport, markdown };
