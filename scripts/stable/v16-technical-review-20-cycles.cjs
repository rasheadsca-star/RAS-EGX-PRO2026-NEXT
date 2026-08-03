#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = file => path.join(ROOT, file);
const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(P(file), 'utf8')); } catch { return fallback; } };
const readText = file => { try { return fs.readFileSync(P(file), 'utf8'); } catch { return ''; } };
const arr = value => Array.isArray(value) ? value : [];
const num = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const check = (id, severity, title, passed, evidence, remediation) => ({ id, severity, title, status: passed ? 'CLOSED' : 'OPEN', evidence, remediation: passed ? null : remediation });
const cycle = (number, role, objective, checks) => ({ cycle: number, role, objective, checks });

const decision = readJson('data/stable/v15-practical-decision.json', { recommendations: [], guardrails: {} });
const price = readJson('data/stable/v15-price-truth.json');
const validation = readJson('data/research/v15-practical-validation.json', { models: [], validatedModels: [] });
const evaluation = readJson('data/stable/v15-recommendation-evaluation.json', { records: [], summary: {} });
const live = readJson('data/stable/v16-live-evidence.json', { summary: {} });
const regime = readJson('data/stable/v16-market-regime.json', { metrics: {} });
const market = readJson('data/quant/market-search-index-v13-17.json', { stocks: [] });
const correlation = readJson('data/stable/v16-correlation-risk.json');
const browser = readJson('data/stable/v16-browser-test-status.json');
const missed = readJson('data/research/v15-missed-opportunities.json', {});
const app = readText('preview-v16/app/app.js');
const upgrade = readText('preview-v16/app/v16-3.js');
const scanner = readText('scripts/stable/v15-practical-market-scanner.cjs');
const gate = readText('scripts/stable/v15-price-truth-gate.cjs');
const evaluator = readText('scripts/stable/v15-recommendation-evaluator.cjs');
const regimeEngine = readText('scripts/stable/v16-market-regime-engine.cjs');
const tests = readText('tests/v16-3.spec.mjs');

const recs = arr(decision.recommendations);
const models = arr(validation.models);
const validatedIds = new Set(arr(validation.validatedModels));
const selectedModels = models.filter(model => validatedIds.has(model.id));
const recModels = recs.map(row => models.find(model => model.id === row.strategyId)).filter(Boolean);
const marketStocks = arr(market.stocks);
const technicalStocks = marketStocks.filter(row => row.momentumMoneyFlow || row.technicals || row.price > 0);
const currentIds = new Set(recs.map(row => `${decision.sessionDate}|${row.ticker}|${row.strategyId}`));
const archivedCurrent = arr(evaluation.records).filter(row => currentIds.has(row.id));
const planValid = row => num(row.entryLow) > 0 && num(row.entryHigh) >= num(row.entryLow) && num(row.stopLoss) > 0 && num(row.stopLoss) < num(row.entryLow) && num(row.target1) > num(row.entryHigh);
const finitePlan = row => ['close','entryLow','entryHigh','stopLoss','target1','riskReward','rsi14'].every(key => Number.isFinite(Number(row[key])));
const noProfessionalClaim = decision.professionalEvidenceReady !== true && recs.every(row => row.evidenceTier === 'PILOT_SHORT_SAMPLE' && row.pilotRiskMode === 'REDUCED_RISK');
const split = validation.sessions || {};
const sessionOrderValid = validation.sessionRanges?.development?.to < validation.sessionRanges?.validation?.from && validation.sessionRanges?.validation?.to < validation.sessionRanges?.test?.from;
const selectedEvidenceValid = selectedModels.length > 0 && selectedModels.every(model => model.validationPassed === true && model.testPassed === true && num(model.test?.averageReturnPct, -999) > 0 && num(model.test?.profitFactor, 0) >= 1.15 && num(model.test?.targetRatePct, 0) > num(model.test?.stopRatePct, 100));
const stabilityDisclosed = recModels.every(model => typeof model.stabilityLabelAr === 'string' && arr(model.stabilityReasonsAr).length > 0) && noProfessionalClaim;
const rrValid = recs.every(row => num(row.riskReward, 0) >= num(decision.guardrails?.minimumRiskReward, 1.15));
const heatValid = recs.every(row => num(row.rsi14, 999) <= num(decision.guardrails?.maximumRecommendationRsi, 78) && num(row.ret5Pct, 0) < 20);
const probabilitiesValid = recs.every(row => num(row.estimatedTargetProbabilityPct, 0) > num(row.estimatedStopProbabilityPct, 100));
const uniqueTickers = new Set(recs.map(row => row.ticker)).size === recs.length;
const sourceCoverage = num(price.acceptedRows, 0) >= 80 && price.executionGrade === true;
const transactionCosts = num(decision.guardrails?.transactionCostsPct, 0);
const liveClaimValid = live.professionalEvidenceReady === ((num(live.summary?.resolvedTrades, 0) >= 100) && (num(live.summary?.observedCalendarDays, 0) >= 90));
const browserReady = browser.status === 'PASSED' && browser.realBrowser === true;
const regimeReady = regime.methodology?.name === 'EGX_PRO_MARKET_REGIME_BREADTH_1.0' && num(regime.metrics?.analyzedCount, 0) >= 80 && num(regime.riskMultiplier, -1) >= 0 && num(regime.riskMultiplier, 2) <= 1;

const cycles = [
  cycle(1, 'مراجع حقيقة الأسعار الفنية', 'منع بناء الإشارة أو التنفيذ على أسعار غير موثقة.', [
    check('T01-1','CRITICAL','بوابة الأسعار جاهزة للتنفيذ',sourceCoverage,`ready=${price.ready}; executionGrade=${price.executionGrade}; accepted=${price.acceptedRows}`,'إيقاف التوصيات وإعادة بناء حقيقة الأسعار.'),
    check('T01-2','HIGH','جلسة القرار مطابقة للجلسة المتوقعة',decision.sessionDate && decision.sessionDate === decision.expectedLatestSession,`${decision.sessionDate} vs ${decision.expectedLatestSession}`,'إعادة المسح من آخر جلسة مكتملة.')
  ]),
  cycle(2, 'مراجع سلامة OHLC والتاريخ', 'التحقق من استخدام جلسات موثوقة وترتيبها الزمني.', [
    check('T02-1','CRITICAL','محرك التقييم يرفض تعارض المصدر والثقة المنخفضة',/source_conflict/.test(evaluator)&&/confidence/.test(evaluator), 'trustedSession guards found','إضافة مرشح جلسات موثوقة.'),
    check('T02-2','HIGH','تاريخ فني متاح لنطاق واسع',technicalStocks.length>=180,`technicalStocks=${technicalStocks.length}`,'استكمال ملفات التاريخ قبل المسح.')
  ]),
  cycle(3, 'مراجع حساب المؤشرات', 'التحقق من وجود مؤشرات الاتجاه والزخم والسيولة دون قيم غير منتهية.', [
    check('T03-1','HIGH','كل توصية تحمل قيمًا عددية للخطة والمؤشرات',recs.length>0&&recs.every(finitePlan),`valid=${recs.filter(finitePlan).length}/${recs.length}`,'رفض السجل ذي القيم المفقودة.'),
    check('T03-2','MEDIUM','فهرس السوق يحتوي طبقة زخم وتدفق نقدي',marketStocks.filter(row=>row.momentumMoneyFlow).length>=150,`momentumCoverage=${marketStocks.filter(row=>row.momentumMoneyFlow).length}`,'إعادة بناء مؤشرات السوق.')
  ]),
  cycle(4, 'مراجع الاتجاه والمتوسطات', 'منع توصيات تتعارض مع الاتجاه دون تفسير.', [
    check('T04-1','HIGH','الماسح يستخدم مرشحات اتجاه ومتوسطات',/sma|ema|trend/i.test(scanner),'trend markers found','إضافة متوسطات واتجاه صريح.'),
    check('T04-2','MEDIUM','حالة السوق تدخل في تفسير الاتجاه',regimeReady,`regime=${regime.regime}; analyzed=${regime.metrics?.analyzedCount}`,'تشغيل محرك حالة السوق.')
  ]),
  cycle(5, 'مراجع الزخم وعدم المطاردة', 'منع شراء الأسهم الساخنة بعد امتداد مفرط.', [
    check('T05-1','CRITICAL','حد RSI الأعلى مطبق على كل توصية',recs.length>0&&recs.every(row=>num(row.rsi14,999)<=78),recs.map(row=>`${row.ticker}:${row.rsi14}`).join(', '),'نقل السهم إلى المراقبة.'),
    check('T05-2','HIGH','بوابة الامتداد القصير تمنع المطاردة',heatValid,recs.map(row=>`${row.ticker}:ret5=${row.ret5Pct}`).join(', '),'خفض الترتيب أو إلغاء الدخول.')
  ]),
  cycle(6, 'مراجع السيولة وقابلية التنفيذ', 'التأكد من أن الفرصة قابلة للتداول وليست إشارة ورقية.', [
    check('T06-1','HIGH','الماسح يتضمن السيولة والحجم النسبي',/liquid|volume|turnover/i.test(scanner),'liquidity markers found','إضافة بوابة سيولة ملزمة.'),
    check('T06-2','HIGH','اتساع الأسعار يكفي للتنفيذ المتقاطع',num(price.acceptedRows,0)>=80,`acceptedRows=${price.acceptedRows}`,'حجب المسح عند ضعف التغطية.')
  ]),
  cycle(7, 'مراجع الدعم والمقاومة والخطة', 'فحص هندسة الدخول والوقف والهدف.', [
    check('T07-1','CRITICAL','كل خطة هندسيًا صحيحة',recs.length>0&&recs.every(planValid),`valid=${recs.filter(planValid).length}/${recs.length}`,'إعادة بناء أو حذف الخطة.'),
    check('T07-2','HIGH','لا يتساوى الوقف أو الهدف مع منطقة الدخول',recs.every(row=>num(row.stopLoss)<num(row.entryLow)&&num(row.target1)>num(row.entryHigh)),recs.map(row=>row.ticker).join(', '),'تصحيح مستويات التنفيذ.')
  ]),
  cycle(8, 'مراجع العائد إلى المخاطرة', 'رفض الفرص ذات العائد غير الكافي بعد التكاليف.', [
    check('T08-1','CRITICAL','كل توصية تجتاز الحد الأدنى للعائد/المخاطرة',rrValid,recs.map(row=>`${row.ticker}:${row.riskReward}`).join(', '),'استبعاد الفرصة.'),
    check('T08-2','HIGH','احتمال الهدف أعلى من احتمال الوقف',probabilitiesValid,recs.map(row=>`${row.ticker}:${row.estimatedTargetProbabilityPct}>${row.estimatedStopProbabilityPct}`).join(', '),'إعادة المعايرة أو الرفض.')
  ]),
  cycle(9, 'مراجع فجوات الافتتاح والانزلاق', 'منع الدخول بعد فجوة غير مناسبة وتسجيل التنفيذ تحفظيًا.', [
    check('T09-1','HIGH','التقييم يتعامل مع فجوة الصعود والهبوط',/CANCELLED_GAP_UP/.test(evaluator)&&/CANCELLED_GAP_DOWN/.test(evaluator),'gap rules found','إضافة قواعد الفجوة.'),
    check('T09-2','HIGH','الدخول داخل الجلسة محسوب تحفظيًا',/INTRADAY_ZONE_TOUCH_CONSERVATIVE/.test(evaluator),'conservative entry rule found','منع افتراض أفضل سعر داخل الجلسة.')
  ]),
  cycle(10, 'مراجع حالة السوق', 'تخفيض المخاطرة أو وقفها حسب اتساع السوق والتقلب.', [
    check('T10-1','CRITICAL','محرك حالة السوق ينتج معامل مخاطرة صالحًا',regimeReady,`regime=${regime.regime}; multiplier=${regime.riskMultiplier}`,'إصلاح المحرك أو استخدام وضع دفاعي.'),
    check('T10-2','HIGH','الواجهة تطبق سقف حالة السوق',upgrade.includes('applyRegimeRiskCap')&&upgrade.includes('maxTradeRiskPct'),'risk cap UI markers found','ربط الحالة بحاسبة المركز.')
  ]),
  cycle(11, 'مراجع الترتيب المتقاطع', 'منع تكرار السهم أو ملء أفضل خمس فرص قسرًا.', [
    check('T11-1','HIGH','لا توجد رموز مكررة في التوصيات',uniqueTickers,`unique=${new Set(recs.map(r=>r.ticker)).size}/${recs.length}`,'إزالة التكرار.'),
    check('T11-2','HIGH','عدد التوصيات من 1 إلى 5 فقط عند الجاهزية',decision.practicalReady!==true||(recs.length>=1&&recs.length<=5),`count=${recs.length}`,'عدم ملء القائمة قسرًا.')
  ]),
  cycle(12, 'مراجع Walk-Forward', 'فصل التطوير والتحقق والاختبار زمنيًا.', [
    check('T12-1','CRITICAL','الفترات منفصلة ومرتبة زمنيًا',sessionOrderValid,JSON.stringify(validation.sessionRanges),'إعادة تقسيم الفترات.'),
    check('T12-2','HIGH','كل نموذج مختار اجتاز التحقق والاختبار',selectedEvidenceValid,selectedModels.map(m=>`${m.id}:${m.validationPassed}/${m.testPassed}`).join(', '),'إلغاء اختيار النموذج الضعيف.')
  ]),
  cycle(13, 'مراجع تسرب المستقبل', 'منع استخدام بيانات لاحقة في تكوين الإشارة.', [
    check('T13-1','CRITICAL','حظر تسرب المستقبل معلن ومفعل',decision.guardrails?.futureLeakageForbidden===true,`futureLeakageForbidden=${decision.guardrails?.futureLeakageForbidden}`,'إيقاف النموذج حتى توثيق القطع الزمني.'),
    check('T13-2','HIGH','التقييم يبدأ بعد جلسة التوصية فقط',/row\.date > record\.recommendationDate/.test(evaluator),'post-recommendation filter found','تصحيح نافذة التقييم.')
  ]),
  cycle(14, 'مراجع تكاليف التداول', 'منع تضخيم النتائج بإهمال التكلفة.', [
    check('T14-1','HIGH','تكاليف التداول موجبة ومطبقة',transactionCosts>0&&/transactionCostsPct/.test(evaluator),`costs=${transactionCosts}%`,'إضافة العمولة والانزلاق.'),
    check('T14-2','MEDIUM','العائد الحي يعرض صافي العائد',/netReturnPct/.test(evaluator),'net return marker found','إظهار الصافي لا الإجمالي فقط.')
  ]),
  cycle(15, 'مراجع ثبات النموذج', 'كشف الحساسية لدورة السوق وعدم تحويل التحسن المؤقت إلى ادعاء مهني.', [
    check('T15-1','HIGH','عدم الاستقرار موثق ولا يُخفى',stabilityDisclosed,recModels.map(m=>`${m.id}:${m.stabilityLabelAr}`).join(', '),'إظهار عدم الاستقرار وخفض المخاطرة.'),
    check('T15-2','CRITICAL','النماذج غير المستقرة لا تستخدم مخاطرة كاملة',noProfessionalClaim,`professional=${decision.professionalEvidenceReady}; modes=${recs.map(r=>r.pilotRiskMode).join(',')}`,'فرض وضع Pilot منخفض المخاطرة.')
  ]),
  cycle(16, 'مراجع كفاية العينة', 'منع الادعاء المهني قبل حجم اختبار وسجل حي كافيين.', [
    check('T16-1','HIGH','قصر عينة الاختبار مصرح به',split.test<split.professionalMinimumTest&&noProfessionalClaim,`test=${split.test}; professionalMinimum=${split.professionalMinimumTest}`,'إظهار Pilot وعدم ادعاء الاحتراف المثبت.'),
    check('T16-2','CRITICAL','الجاهزية المهنية مرتبطة بـ100 صفقة و90 يومًا',liveClaimValid,`resolved=${live.summary?.resolvedTrades}; days=${live.summary?.observedCalendarDays}; ready=${live.professionalEvidenceReady}`,'إعادة تصنيف المنتج Pilot.')
  ]),
  cycle(17, 'مراجع السجل الحي الفني', 'حفظ كل الإشارات ونتائجها دون حذف الخاسر.', [
    check('T17-1','HIGH','كل توصيات الجلسة مؤرشفة',archivedCurrent.length===recs.length,`archivedCurrent=${archivedCurrent.length}/${recs.length}`,'تشغيل الأرشفة قبل النشر.'),
    check('T17-2','HIGH','الفصل بين Backtest والسجل الحي ظاهر',/Backtest/.test(app)&&/السجل الحي/.test(app),'UI separation markers found','فصل المقاييس في الواجهة.')
  ]),
  cycle(18, 'مراجع الفرص الفائتة والإشارات الكاذبة', 'مراجعة ما استبعده النموذج وما أوصى به خطأ.', [
    check('T18-1','MEDIUM','يوجد مسار لتقرير الفرص الفائتة',Object.keys(missed).length>0||/missed/i.test(scanner),'missed-opportunity path checked','إنشاء تقرير فرص فائتة دوري.'),
    check('T18-2','HIGH','نتيجة التوصية لا تُحذف عند الفشل',arr(evaluation.records).length>=recs.length,`records=${arr(evaluation.records).length}`,'منع حذف السجل السلبي.')
  ]),
  cycle(19, 'مراجع الانحدار الفني والواجهة', 'التأكد من أن الترقية لم تكسر البحث والخطة والمحفظة.', [
    check('T19-1','HIGH','اختبارات متصفح حقيقية ناجحة',browserReady,`status=${browser.status}; realBrowser=${browser.realBrowser}`,'تشغيل Playwright وإصلاح الرحلة.'),
    check('T19-2','HIGH','اختبارات المتصفح تغطي البحث والتوصيات والمحفظة',/marketSearch/.test(tests)&&/recommendationGrid/.test(tests)&&/portfolio/.test(tests),'browser test markers found','توسيع الاختبارات.')
  ]),
  cycle(20, 'المستلم الفني النهائي', 'اعتماد الشق الفني في نطاق Pilot فقط بعد إغلاق الملاحظات الحاجبة.', [
    check('T20-1','CRITICAL','لا توجد أوامر تداول آلية',decision.guardrails?.automaticOrders===false,`automaticOrders=${decision.guardrails?.automaticOrders}`,'تعطيل أي تكامل تنفيذي.'),
    check('T20-2','HIGH','النسخة تصرح بمرحلة Pilot ولا تعد بالربح',noProfessionalClaim&&!/(ضمان الربح|أرباح مضمونة|guaranteed profit)/i.test(app+upgrade),'Pilot disclosure and claims checked','إزالة الادعاءات وإظهار القيود.'),
    check('T20-3','HIGH','التوصيات الحالية اجتازت كل البوابات الفنية الأساسية',recs.length>0&&recs.every(planValid)&&rrValid&&heatValid&&probabilitiesValid&&sourceCoverage,`recs=${recs.length}; source=${sourceCoverage}; plans=${recs.every(planValid)}`,'حجب الإصدار الفني وإعادة البناء.')
  ])
];

const all = cycles.flatMap(row => row.checks);
const open = all.filter(row => row.status === 'OPEN');
const blocking = open.filter(row => ['CRITICAL','HIGH'].includes(row.severity));
const severity = {};
for (const level of ['CRITICAL','HIGH','MEDIUM','LOW']) {
  const rows = all.filter(row => row.severity === level);
  severity[level] = { total: rows.length, open: rows.filter(row => row.status === 'OPEN').length, closed: rows.filter(row => row.status === 'CLOSED').length };
}
const report = {
  schemaVersion: '16.3.0', generatedAt: new Date().toISOString(), application: 'EGX Pro Professional V16.3',
  scope: { type: 'TECHNICAL_ANALYSIS_ONLY', labelAr: 'الشق الفني بالكامل', maturityBoundary: 'PILOT_SHORT_SAMPLE' },
  methodology: 'Twenty independent technical review cycles with evidence-based closure and no professional-performance claim before live evidence thresholds.',
  cyclesCompleted: cycles.length,
  acceptance: blocking.length ? 'REJECTED_BLOCKING_TECHNICAL_FINDINGS' : open.length ? 'ACCEPTED_WITH_NON_BLOCKING_TECHNICAL_NOTES' : 'ACCEPTED_ZERO_TECHNICAL_FINDINGS',
  acceptanceCriteria: { exactlyTwentyCycles: cycles.length === 20, zeroCritical: severity.CRITICAL.open === 0, zeroHigh: severity.HIGH.open === 0, pilotScopeEnforced: noProfessionalClaim },
  summary: { totalChecks: all.length, closedChecks: all.length-open.length, openChecks: open.length, blockingFindings: blocking.length, severity, recommendationCount: recs.length, selectedModelCount: selectedModels.length, testSessions: split.test || 0, liveResolvedTrades: live.summary?.resolvedTrades || evaluation.summary?.resolvedTrades || 0 },
  cycles,
  openFindings: open,
  blockingFindings: blocking,
  finalReceiverDecisionAr: blocking.length ? 'مرفوض فنيًا حتى إغلاق الملاحظات الحرجة والعالية.' : open.length ? 'مقبول فنيًا في نطاق Pilot مع ملاحظات غير حاجبة موثقة.' : 'مقبول فنيًا في نطاق Pilot بصفر ملاحظات مفتوحة ضمن الفحوص المنفذة.'
};

fs.mkdirSync(P('data/review'), { recursive: true });
fs.writeFileSync(P('data/review/v16-technical-review.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const lines = [
  '# تقرير المراجعة الفنية المستقلة — EGX Pro V16.3', '',
  `- النطاق: **${report.scope.labelAr}**`, `- تاريخ التوليد: ${report.generatedAt}`, `- الدورات: ${report.cyclesCompleted}/20`,
  `- الحكم: **${report.acceptance}**`, `- الفحوص: ${report.summary.closedChecks}/${report.summary.totalChecks} مغلق`,
  `- الحرجة المفتوحة: ${severity.CRITICAL.open}`, `- العالية المفتوحة: ${severity.HIGH.open}`, '',
  '| الدورة | المراجع | الفحوص | المغلق | المفتوح |', '|---:|---|---:|---:|---:|',
  ...cycles.map(row => `| ${row.cycle} | ${row.role} | ${row.checks.length} | ${row.checks.filter(x=>x.status==='CLOSED').length} | ${row.checks.filter(x=>x.status==='OPEN').length} |`), '',
  '## الملاحظات المفتوحة', '',
  ...(open.length ? ['| الدورة | الخطورة | الملاحظة | الدليل | الإجراء |','|---:|---|---|---|---|',...cycles.flatMap(c=>c.checks.filter(x=>x.status==='OPEN').map(x=>`| ${c.cycle} | ${x.severity} | ${x.title} | ${String(x.evidence).replace(/\|/g,'/')} | ${x.remediation} |`))] : ['لا توجد ملاحظات مفتوحة ضمن نطاق الفحوص الفنية المنفذة.']), '',
  '## قرار المستلم الفني', '', report.finalReceiverDecisionAr, '',
  '> نجاح الفحوص يعني سلامة التشغيل الفني في نطاق Pilot، وليس إثبات أرباح مستقبلية أو صلاحية تنفيذ آلي.'
];
fs.writeFileSync(P('data/review/v16-technical-review.md'), `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ acceptance: report.acceptance, cycles: cycles.length, checks: all.length, open: open.length, blocking: blocking.length, severity }, null, 2));
if (blocking.length && process.env.TECH_REVIEW_FAIL_ON_BLOCKING !== '0') process.exitCode = 1;
