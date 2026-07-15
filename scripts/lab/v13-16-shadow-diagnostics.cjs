#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const FILES = {
  policy: path.join(ROOT, 'data', 'v13-16-operational-policy.json'),
  center: path.join(ROOT, 'data', 'quant', 'unified-autonomous-center-v13-14.json'),
  output: path.join(ROOT, 'data', 'lab', 'shadow-diagnostics-v13-16.json')
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function A(value) { return Array.isArray(value) ? value : []; }
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function percentAboveEntry(candidate) {
  const price = n(candidate.currentPrice);
  const high = n(candidate.plan?.entryHigh);
  if (!(price > 0 && high > 0)) return null;
  return (price - high) / high * 100;
}
function flag(value, reason, missingReason) {
  if (value === null) return { pass: null, reason: missingReason };
  return { pass: Boolean(value), reason };
}

const policy = readJson(FILES.policy);
const center = readJson(FILES.center);
if (!policy || !center) throw new Error('Missing operational policy or center');
const lab = policy.shadowLab;
const marketRegime = String(center.marketRegime || center.marketRegimeLabelAr || '').toLowerCase();
const marketUp = /up|bull|صاعد|إيجابي/.test(marketRegime);
const rows = A(center.candidates).map(candidate => {
  const liquidity = n(candidate.liquidityPercentile);
  const rsi = n(candidate.rsi14);
  const volume = n(candidate.volumeRatio20);
  const chase = percentAboveEntry(candidate);
  const liquidityPass = liquidity === null ? null : liquidity >= n(lab.minimumLiquidityPercentile, 70);
  const notChasing = chase === null ? null : chase <= n(lab.maximumChaseAboveEntryPct, 2);
  const trendRsiPass = rsi === null ? null : rsi <= n(lab.maximumRsiTrend, 70);
  const breakoutRsiPass = rsi === null ? null : rsi <= n(lab.maximumRsiBreakout, 75);
  const breakoutVolumePass = volume === null ? null : volume >= n(lab.minimumVolumeRatioBreakout, 1.2);

  const commonKnown = [liquidityPass, notChasing].every(value => value !== null);
  const trendEligible = candidate.strategyId === 'trend_follow' &&
    marketUp && commonKnown && liquidityPass && notChasing && trendRsiPass === true;
  const breakoutEligible = candidate.strategyId === 'breakout' &&
    commonKnown && liquidityPass && notChasing &&
    breakoutRsiPass === true && breakoutVolumePass === true;

  return {
    ticker: candidate.ticker,
    companyNameAr: candidate.companyNameAr,
    productionTechnicalRank: candidate.technicalRank,
    productionTier: candidate.tier,
    productionDecision: candidate.finalDecision?.code,
    productionStrategyId: candidate.strategyId,
    diagnostics: {
      marketRegimeUp: flag(marketRegime ? marketUp : null, marketUp ? 'السوق يدعم الاتجاه.' : 'السوق لا يدعم الاتجاه.', 'حالة السوق غير متاحة.'),
      liquidity: flag(liquidityPass, liquidityPass ? 'السيولة فوق الحد التجريبي.' : 'السيولة أقل من الحد التجريبي.', 'السيولة غير متاحة.'),
      notChasing: flag(notChasing, notChasing ? 'السعر لم يبتعد أكثر من الحد التجريبي.' : 'احتمال مطاردة السعر.', 'منطقة الدخول أو السعر غير متاح.'),
      trendRsi: flag(trendRsiPass, trendRsiPass ? 'RSI مناسب لتجربة الاتجاه.' : 'RSI مرتفع لتجربة الاتجاه.', 'RSI غير متاح.'),
      breakoutRsi: flag(breakoutRsiPass, breakoutRsiPass ? 'RSI مناسب لتجربة الاختراق.' : 'RSI مرتفع لتجربة الاختراق.', 'RSI غير متاح.'),
      breakoutVolume: flag(breakoutVolumePass, breakoutVolumePass ? 'الحجم يدعم تجربة الاختراق.' : 'الحجم لا يدعم تجربة الاختراق.', 'الحجم النسبي غير متاح.')
    },
    values: {
      liquidityPercentile: liquidity,
      rsi14: rsi,
      volumeRatio20: volume,
      chaseAboveEntryPct: chase === null ? null : Number(chase.toFixed(3))
    },
    shadowExperiments: {
      trendFollowV2Eligible: trendEligible,
      breakoutV2Eligible: breakoutEligible
    }
  };
});

const output = {
  schemaVersion: '13.16.0',
  generatedAt: new Date().toISOString(),
  analysisSession: center.analysisSession || null,
  mode: 'SHADOW_DIAGNOSTICS_ONLY',
  affectsProductionRanking: false,
  affectsProductionDecision: false,
  changesStrategyRules: false,
  disclaimerAr: 'نتائج المختبر تشخيصية فقط ولا تغيّر ترتيب التطبيق أو القرار أو سجل الأدلة الأساسي.',
  summary: {
    candidates: rows.length,
    trendFollowV2Eligible: rows.filter(row => row.shadowExperiments.trendFollowV2Eligible).length,
    breakoutV2Eligible: rows.filter(row => row.shadowExperiments.breakoutV2Eligible).length,
    incompleteDiagnostics: rows.filter(row =>
      Object.values(row.diagnostics).some(item => item.pass === null)
    ).length
  },
  candidates: rows
};
writeJson(FILES.output, output);
console.log(`V13.16 shadow lab: candidates=${rows.length}, trendV2=${output.summary.trendFollowV2Eligible}, breakoutV2=${output.summary.breakoutV2Eligible}.`);
