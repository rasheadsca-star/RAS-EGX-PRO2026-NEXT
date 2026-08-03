#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = file => path.join(ROOT, file);
const read = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(P(file), 'utf8')); } catch { return fallback; } };
const text = file => { try { return fs.readFileSync(P(file), 'utf8'); } catch { return ''; } };
const checks = [];
function check(id, severity, title, passed, evidence) { checks.push({ id, severity, title, status: passed ? 'CLOSED' : 'OPEN', evidence }); }
const decision = read('data/stable/v15-practical-decision.json');
const price = read('data/stable/v15-price-truth.json');
const fundamental = read('data/stable/v16-fundamental-analysis.json');
const raw = read('data/fundamentals/v16-fundamental-raw.json');
const official = read('data/stable/v16-official-disclosures.json');
const regime = read('data/stable/v16-market-regime.json');
const live = read('data/stable/v16-live-evidence.json');
const correlation = read('data/stable/v16-correlation-risk.json');
const alerts = read('data/stable/v16-alerts.json');
const heartbeat = read('data/stable/v15-update-status.json');
const browser = read('data/stable/v16-browser-test-status.json');
const launch = text('preview-v16/app/launch.js');
const ui = text('preview-v16/app/v16-3.js');
const css = text('preview-v16/app/v16-3.css');
const recs = Array.isArray(decision.recommendations) ? decision.recommendations : [];
const minimumCoverage = Math.min(180, Math.ceil((raw.universeCount || 225) * 0.7));

check('V163-01', 'CRITICAL', 'حقيقة الأسعار صالحة للتنفيذ', price.ready === true && price.executionGrade === true && (price.acceptedRows || 0) >= 80, `ready=${price.ready}; executionGrade=${price.executionGrade}; accepted=${price.acceptedRows}`);
check('V163-02', 'CRITICAL', 'التوصيات لا تتجاوز البوابات الصلبة', decision.guardrails?.automaticOrders === false && recs.every(row => row.riskReward >= 1.15 && row.rsi14 <= 78 && row.estimatedTargetProbabilityPct > row.estimatedStopProbabilityPct), `recommendations=${recs.length}; automaticOrders=${decision.guardrails?.automaticOrders}`);
check('V163-03', 'HIGH', 'السجل الحي منفصل عن Backtest', live.methodology?.name === 'EGX_PRO_LIVE_EVIDENCE_2.0' && live.methodology?.principles?.some(value => /never merged/i.test(value)), live.methodology?.name || 'missing');
check('V163-04', 'CRITICAL', 'لا ادعاء بإثبات مهني قبل اكتمال العينة', live.professionalEvidenceReady === ((live.summary?.resolvedTrades || 0) >= 100 && (live.summary?.observedCalendarDays || 0) >= 90), `ready=${live.professionalEvidenceReady}; resolved=${live.summary?.resolvedTrades}; days=${live.summary?.observedCalendarDays}`);
check('V163-05', 'HIGH', 'محرك حالة السوق يعمل على اتساع كافٍ', regime.methodology?.name === 'EGX_PRO_MARKET_REGIME_BREADTH_1.0' && (regime.metrics?.analyzedCount || 0) >= 80 && Number.isFinite(Number(regime.riskMultiplier)), `regime=${regime.regime}; analyzed=${regime.metrics?.analyzedCount}; riskMultiplier=${regime.riskMultiplier}`);
check('V163-06', 'HIGH', 'تغطية مالية موسعة', (raw.coverageCount || 0) >= minimumCoverage && (fundamental.summary?.currentRecommendationFinancialCoverage || 0) === recs.length, `coverage=${raw.coverageCount}/${raw.universeCount}; minimum=${minimumCoverage}; recommendationCoverage=${fundamental.summary?.currentRecommendationFinancialCoverage}/${recs.length}`);
check('V163-07', 'CRITICAL', 'الإفصاح الرسمي لا يمر بلا توثيق', official.methodology?.name === 'EGX_PRO_OFFICIAL_DISCLOSURE_GATE_1.0' && (official.verified || []).every(row => row.valid === true && row.officialUrl && row.officialPeriodEnd && row.officialPublishedAt), `verified=${official.summary?.verifiedRecords || 0}; rejected=${official.summary?.rejectedRecords || 0}`);
check('V163-08', 'HIGH', 'البيانات الثانوية لا تُعرض كمدققة', (fundamental.records || []).every(row => row.source?.officialDisclosureVerified !== true || Boolean(row.source?.officialUrl)), `officialVerified=${fundamental.summary?.officialVerifiedCompanies || 0}`);
check('V163-09', 'HIGH', 'مصفوفة الارتباط تغطي توصيات اليوم', correlation.methodology?.name === 'EGX_PRO_CORRELATION_PORTFOLIO_RISK_1.0' && correlation.tickers?.length === recs.length && correlation.matrix?.length === recs.length, `tickers=${correlation.tickers?.length}; matrix=${correlation.matrix?.length}; recs=${recs.length}`);
check('V163-10', 'HIGH', 'اختبارات الضغط موجودة', Array.isArray(correlation.stressScenarios) && correlation.stressScenarios.length >= 4, `scenarios=${correlation.stressScenarios?.length || 0}`);
check('V163-11', 'HIGH', 'التنبيهات قابلة للتنفيذ ولا ترسل أوامر', alerts.methodology?.name === 'EGX_PRO_ACTIONABLE_ALERTS_1.0' && alerts.methodology?.backgroundPushEnabled === false && Array.isArray(alerts.alerts), `alerts=${alerts.summary?.total}; backgroundPush=${alerts.methodology?.backgroundPushEnabled}`);
check('V163-12', 'HIGH', 'واجهة V16.3 مرتبطة بالإصدار الحالي', launch.includes('v16-3.js') && launch.includes('v16-3.css') && ['marketRegimeCard', 'officialDisclosureCard', 'liveEvidenceV162', 'correlationRiskCard', 'alertsButton'].every(marker => ui.includes(marker)) && css.length > 1000, 'V16.3 UI assets and markers');
check('V163-13', 'HIGH', 'اختبارات المتصفح نجحت', browser.status === 'PASSED' && (browser.testsPassed || 0) >= 6, `status=${browser.status}; passed=${browser.testsPassed}`);
check('V163-14', 'HIGH', 'Heartbeat موحد على V16.3', heartbeat.productInterface === 'EGX_PROFESSIONAL_V16_3' && heartbeat.marketRegime?.generatedAt === regime.generatedAt && heartbeat.liveEvidence?.generatedAt === live.generatedAt && heartbeat.portfolioRisk?.generatedAt === correlation.generatedAt, `interface=${heartbeat.productInterface}`);
check('V163-15', 'MEDIUM', 'النسخة تعرض حدود الإفصاحات والإشعارات', ui.includes('لا يجوز تقديمها كإفصاح رسمي') && ui.includes('إشعارات متصفح محلية') && ui.includes('Professional Pilot'), 'disclosure markers');

const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const open = checks.filter(row => row.status === 'OPEN');
const blocking = open.filter(row => rank[row.severity] >= 3);
const out = {
  schemaVersion: '16.3.0',
  generatedAt: new Date().toISOString(),
  release: 'EGX_PRO_V16_3',
  acceptance: blocking.length ? 'REJECTED_BLOCKING_FINDINGS' : 'ACCEPTED',
  summary: { totalChecks: checks.length, closedChecks: checks.length - open.length, openChecks: open.length, blockingFindings: blocking.length, minimumFinancialCoverage: minimumCoverage },
  checks,
  blockingFindings: blocking
};
fs.mkdirSync(path.dirname(P('data/stable/v16-release-readiness.json')), { recursive: true });
fs.writeFileSync(P('data/stable/v16-release-readiness.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(out.summary);
if (blocking.length) {
  console.error(blocking.map(row => `${row.id}: ${row.title} — ${row.evidence}`).join('\n'));
  process.exitCode = 1;
}
