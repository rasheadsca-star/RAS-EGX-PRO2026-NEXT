#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = file => path.join(ROOT, file);
const OUT_PATH = P('data/stable/v16-alerts.json');
const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(P(file), 'utf8')); } catch { return fallback; } };
const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function idFor(parts) { return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16); }
function ageHours(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? (Date.now() - time) / 3600000 : Infinity;
}
function add(list, input) {
  const alert = {
    id: idFor([input.type, input.ticker || 'MARKET', input.sessionDate || '', input.key || input.titleAr]),
    createdAt: new Date().toISOString(),
    severity: input.severity || 'INFO',
    type: input.type,
    ticker: input.ticker || null,
    titleAr: input.titleAr,
    messageAr: input.messageAr,
    actionAr: input.actionAr || null,
    sessionDate: input.sessionDate || null,
    sourceGeneratedAt: input.sourceGeneratedAt || null,
    dedupeKey: input.key || null,
    notificationEligible: input.notificationEligible !== false
  };
  list.push(alert);
}
function main() {
  const decision = readJson('data/stable/v15-practical-decision.json', { recommendations: [] });
  const price = readJson('data/stable/v15-price-truth.json', {});
  const regime = readJson('data/stable/v16-market-regime.json', {});
  const fundamental = readJson('data/stable/v16-fundamental-analysis.json', { recommendationAnalysis: [] });
  const official = readJson('data/stable/v16-official-disclosures.json', { summary: {}, verified: [] });
  const live = readJson('data/stable/v16-live-evidence.json', { summary: {}, professionalGate: {} });
  const correlation = readJson('data/stable/v16-correlation-risk.json', { highCorrelationPairs: [], summary: {} });
  const update = readJson('data/stable/v15-update-status.json', {});
  const alerts = [];
  const sessionDate = decision.sessionDate || regime.metrics?.sessionDate || null;

  if (regime.regime === 'RISK_OFF' || regime.regime === 'HIGH_VOLATILITY') {
    add(alerts, {
      type: 'MARKET_REGIME', severity: 'HIGH', sessionDate, sourceGeneratedAt: regime.generatedAt,
      titleAr: regime.regime === 'HIGH_VOLATILITY' ? 'تقلب استثنائي في السوق' : 'حالة سوق دفاعية',
      messageAr: `${regime.labelAr || 'حالة سوق مرتفعة المخاطر'} — معامل المخاطرة ${round(regime.riskMultiplier, 2)}.` ,
      actionAr: regime.guidanceAr || 'خفّض عدد المراكز والمخاطرة.'
    });
  } else if (regime.regime === 'NEUTRAL') {
    add(alerts, {
      type: 'MARKET_REGIME', severity: 'MEDIUM', sessionDate, sourceGeneratedAt: regime.generatedAt,
      titleAr: 'السوق انتقائي', messageAr: `اتساع الصعود ${regime.metrics?.advancePct ?? '—'}% والتداول فوق متوسط 20 جلسة ${regime.metrics?.aboveSma20Pct ?? '—'}%.`,
      actionAr: 'استخدم أحجام مراكز أقل وانتظر تأكيد الدخول.'
    });
  }

  if (price.executionGrade !== true || ageHours(price.source?.generatedAt) > 30) {
    add(alerts, {
      type: 'DATA_QUALITY', severity: 'CRITICAL', sessionDate, sourceGeneratedAt: price.source?.generatedAt,
      titleAr: 'تحذير جودة الأسعار',
      messageAr: price.executionGrade !== true ? 'أسعار التنفيذ لم تجتز بوابة الجودة.' : 'مصدر الأسعار أقدم من الحد التشغيلي.',
      actionAr: 'لا تعتمد أي منطقة دخول قبل تحديث السعر والتحقق منه.'
    });
  }

  const financialMap = new Map((fundamental.recommendationAnalysis || []).map(row => [String(row.ticker || '').toUpperCase(), row]));
  for (const rec of decision.recommendations || []) {
    const ticker = String(rec.ticker || '').toUpperCase();
    const current = num(rec.close);
    const low = num(rec.entryLow);
    const high = num(rec.entryHigh);
    const stop = num(rec.stopLoss);
    const financial = financialMap.get(ticker);
    if (current !== null && low !== null && high !== null) {
      if (current >= low && current <= high) add(alerts, { type: 'ENTRY_ZONE', severity: 'MEDIUM', ticker, sessionDate, titleAr: `${ticker} داخل منطقة الدخول`, messageAr: `السعر ${current} داخل النطاق ${low}–${high}.`, actionAr: 'راجع الافتتاح والسيولة وحالة السوق قبل القرار.' });
      else if (current > high * 1.02) add(alerts, { type: 'MISSED_ENTRY', severity: 'LOW', ticker, sessionDate, titleAr: `${ticker} أعلى من منطقة الدخول`, messageAr: `السعر أعلى من الحد العلوي بأكثر من 2%.`, actionAr: 'لا تطارد السعر؛ انتظر خطة جديدة.' });
      else if (stop !== null && current <= stop) add(alerts, { type: 'PLAN_INVALIDATED', severity: 'HIGH', ticker, sessionDate, titleAr: `خطة ${ticker} غير صالحة`, messageAr: 'السعر الحالي عند وقف الخسارة أو أسفله.', actionAr: 'ألغِ الخطة ولا تعِد توسيع الوقف.' });
    }
    if (financial && ['AVOID_INVESTMENT_REVIEW', 'WEAK'].includes(financial.verdict)) {
      add(alerts, {
        type: 'FINANCIAL_RISK', severity: financial.verdict === 'AVOID_INVESTMENT_REVIEW' ? 'HIGH' : 'MEDIUM', ticker, sessionDate, sourceGeneratedAt: fundamental.generatedAt,
        titleAr: `${ticker}: مخاطرة مالية`,
        messageAr: financial.verdictAr || 'التحليل المالي لا يدعم قرارًا استثماريًا طويل الأجل.',
        actionAr: 'إن تمت مراجعة السهم فتعامل معه كتداول قصير فقط وبحد مخاطرة منخفض.'
      });
    }
    if (financial?.dataQuality?.officialVerified !== true) {
      add(alerts, {
        type: 'DISCLOSURE_STATUS', severity: 'LOW', ticker, sessionDate, sourceGeneratedAt: fundamental.generatedAt,
        titleAr: `${ticker}: البيانات غير موثقة رسميًا`,
        messageAr: 'التحليل المالي مبني على بيانات معيارية ثانوية ولم يُطابق بعد بإفصاح رسمي.',
        actionAr: 'راجع الإفصاح الرسمي قبل قرار استثماري طويل الأجل.', notificationEligible: false
      });
    }
  }

  for (const pair of correlation.highCorrelationPairs || []) {
    add(alerts, {
      type: 'CORRELATION', severity: pair.correlation >= 0.85 ? 'HIGH' : 'MEDIUM', sessionDate, sourceGeneratedAt: correlation.generatedAt,
      titleAr: `ارتباط مرتفع: ${pair.left} و${pair.right}`,
      messageAr: `معامل الارتباط ${pair.correlation} خلال ${pair.observations} جلسة مشتركة.`,
      actionAr: 'لا تعتبر المركزين تنويعًا كاملًا، وخفّض إجمالي التعرض لهما.'
    });
  }
  if (correlation.summary?.largestSector?.sharePct > 40) {
    add(alerts, {
      type: 'CONCENTRATION', severity: 'HIGH', sessionDate, sourceGeneratedAt: correlation.generatedAt,
      titleAr: 'تركيز قطاعي مرتفع في الفرص الحالية',
      messageAr: `${correlation.summary.largestSector.sector}: ${correlation.summary.largestSector.sharePct}% من القائمة.`,
      actionAr: 'طبّق سقف القطاع قبل إضافة مراكز جديدة.'
    });
  }

  const resolved = num(live.summary?.resolvedTrades) || 0;
  if (resolved === 0) add(alerts, { type: 'LIVE_EVIDENCE', severity: 'MEDIUM', sessionDate, sourceGeneratedAt: live.generatedAt, titleAr: 'السجل الحي لم يبدأ بإغلاق صفقات', messageAr: 'لا توجد حتى الآن صفقة حية منتهية يمكن القياس عليها.', actionAr: 'استمر في الأرشفة اليومية ولا ترفع تصنيف المنتج إلى مثبت.' });
  else if ([10, 30, 100].includes(resolved)) add(alerts, { type: 'LIVE_MILESTONE', severity: 'INFO', sessionDate, sourceGeneratedAt: live.generatedAt, titleAr: `السجل الحي وصل إلى ${resolved} صفقة`, messageAr: `تم الوصول إلى مرحلة ${live.evidenceTier}.`, actionAr: 'راجع الثبات والتراجع والأداء حسب الاستراتيجية.' });

  if ((official.summary?.verifiedRecords || 0) === 0) {
    add(alerts, {
      type: 'OFFICIAL_DISCLOSURES', severity: 'MEDIUM', sessionDate, sourceGeneratedAt: official.generatedAt,
      titleAr: 'لا توجد إفصاحات رسمية موثقة بعد',
      messageAr: 'بوابة الإفصاحات تعمل، لكن لم يدخلها سجل يستوفي الرابط الرسمي والفترة ونوع المراجعة.',
      actionAr: 'اربط مصدر الإفصاحات الرسمي أو أضف سجلات مراجعة موثقة.'
    });
  }
  if (ageHours(update.generatedAt) > 30) add(alerts, { type: 'AUTOMATION', severity: 'HIGH', sessionDate, sourceGeneratedAt: update.generatedAt, titleAr: 'تحديث التطبيق متأخر', messageAr: 'آخر Heartbeat أقدم من 30 ساعة.', actionAr: 'تحقق من دورة GitHub Actions ومصادر السوق.' });

  const priority = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
  alerts.sort((a, b) => priority[b.severity] - priority[a.severity] || String(a.ticker || '').localeCompare(String(b.ticker || '')) || a.type.localeCompare(b.type));
  const out = {
    schemaVersion: '16.3.0',
    generatedAt: new Date().toISOString(),
    methodology: {
      name: 'EGX_PRO_ACTIONABLE_ALERTS_1.0',
      delivery: 'IN_APP_AND_LOCAL_BROWSER_NOTIFICATION',
      backgroundPushEnabled: false,
      principles: ['Alerts are deduplicated by condition and session.', 'No alert submits an order.', 'Local browser notifications require explicit user permission.']
    },
    summary: {
      total: alerts.length,
      critical: alerts.filter(row => row.severity === 'CRITICAL').length,
      high: alerts.filter(row => row.severity === 'HIGH').length,
      medium: alerts.filter(row => row.severity === 'MEDIUM').length,
      notificationEligible: alerts.filter(row => row.notificationEligible).length
    },
    alerts
  };
  writeJson(OUT_PATH, out);
  console.log(out.summary);
}

main();
