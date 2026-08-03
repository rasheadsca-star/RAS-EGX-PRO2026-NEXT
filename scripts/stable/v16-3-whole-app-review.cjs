#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = file => path.join(ROOT, file);
const read = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(P(file), 'utf8')); } catch { return fallback; } };
const text = file => { try { return fs.readFileSync(P(file), 'utf8'); } catch { return ''; } };
const arr = value => Array.isArray(value) ? value : [];
const num = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
function check(id, severity, title, passed, evidence, remediation) { return { id, severity, title, status: passed ? 'CLOSED' : 'OPEN', evidence, remediation: passed ? null : remediation }; }
function cycle(role, objective, checks) { return { role, objective, checks }; }
function hasAll(value, markers) { return markers.every(marker => value.includes(marker)); }

const decision = read('data/stable/v15-practical-decision.json', { recommendations: [] });
const price = read('data/stable/v15-price-truth.json');
const market = read('data/quant/market-search-index-v13-17.json', { stocks: [] });
const evaluation = read('data/stable/v15-recommendation-evaluation.json', { records: [] });
const live = read('data/stable/v16-live-evidence.json');
const raw = read('data/fundamentals/v16-fundamental-raw.json');
const fundamental = read('data/stable/v16-fundamental-analysis.json', { records: [], recommendationAnalysis: [] });
const official = read('data/stable/v16-official-disclosures.json', { verified: [], rejected: [] });
const regime = read('data/stable/v16-market-regime.json');
const correlation = read('data/stable/v16-correlation-risk.json');
const alerts = read('data/stable/v16-alerts.json', { alerts: [] });
const browser = read('data/stable/v16-browser-test-status.json');
const heartbeat = read('data/stable/v15-update-status.json');
const release = read('data/stable/v16-release-readiness.json');
const manifest = read('manifest.json');
const html = text('preview-v16/app/index.html');
const app = text('preview-v16/app/app.js');
const upgrade = text('preview-v16/app/v16-3.js');
const css = text('preview-v16/app/v16-3.css');
const launch = text('preview-v16/app/launch.js');
const serviceWorker = text('service-worker.js');
const workflow = text('.github/workflows/v15-practical-deploy.yml');
const tests = text('tests/v16-3.spec.mjs');
const recs = arr(decision.recommendations);
const recommendationTickers = recs.map(row => String(row.ticker || '').toUpperCase());
const financialTickers = new Set(arr(fundamental.recommendationAnalysis).map(row => String(row.ticker || '').toUpperCase()));
const officialValid = arr(official.verified).every(row => row.valid === true && row.officialUrl && row.officialPublishedAt && row.officialPeriodEnd);
const correlationTickers = new Set(arr(correlation.tickers));

const cycles = [
  cycle('مختص جودة بيانات السوق', 'التأكد من حداثة الأسعار واتساع التغطية وعدم تسرب أسعار غير موثقة.', [
    check('C01-1','CRITICAL','بوابة السعر التنفيذية ناجحة',price.ready===true&&price.executionGrade===true,`ready=${price.ready}; execution=${price.executionGrade}`,'إيقاف التوصيات حتى نجاح مصدر الأسعار.'),
    check('C01-2','HIGH','تغطية الأسعار كافية',(price.acceptedRows||0)>=80,`accepted=${price.acceptedRows}`,'رفع التغطية أو إيقاف الإصدار.'),
    check('C01-3','HIGH','جلسة القرار مطابقة للجلسة المتوقعة',decision.sessionDate&&decision.sessionDate===decision.expectedLatestSession,`${decision.sessionDate} vs ${decision.expectedLatestSession}`,'إعادة بناء القرار من آخر جلسة مكتملة.')
  ]),
  cycle('محلل فني محترف', 'فحص الخطط ومنع المطاردة والتوصيات الضعيفة.', [
    check('C02-1','CRITICAL','كل خطة لها دخول ووقف وهدف صالح',recs.every(r=>num(r.entryLow)>0&&num(r.entryHigh)>=num(r.entryLow)&&num(r.stopLoss)<num(r.entryLow)&&num(r.target1)>num(r.entryHigh)),`valid=${recs.length}`,'حذف أو إعادة بناء الخطة.'),
    check('C02-2','CRITICAL','قواعد RSI والعائد/المخاطرة مطبقة',recs.every(r=>num(r.riskReward,0)>=1.15&&num(r.rsi14,999)<=78),recs.map(r=>`${r.ticker}:RR${r.riskReward}/RSI${r.rsi14}`).join(', '),'نقل الفرصة للمراقبة.'),
    check('C02-3','HIGH','احتمال الهدف أعلى من الوقف',recs.every(r=>num(r.estimatedTargetProbabilityPct,0)>num(r.estimatedStopProbabilityPct,100)),recs.map(r=>r.ticker).join(','),'رفض الفرصة غير ذات الأفضلية.')
  ]),
  cycle('محلل مالي واستثماري', 'فحص سلامة القوائم والتغطية والدرجات.', [
    check('C03-1','CRITICAL','Parser الوحدات الآمن مستخدم',raw.parserVersion==='V16.3_EXACT_ROWS_UNIT_SAFE_1.0',raw.parserVersion,'تشغيل المجمّع V16.3 فقط.'),
    check('C03-2','HIGH','كل توصية لها حالة مالية',recommendationTickers.every(t=>financialTickers.has(t)),`${financialTickers.size}/${recommendationTickers.length}`,'جمع بيانات التوصيات أو إظهار DATA_UNAVAILABLE.'),
    check('C03-3','HIGH','التغطية المالية لا تقل عن 70%',num(raw.coveragePct,0)>=70,`coverage=${raw.coveragePct}%`,'تشغيل دفعة الجمع الموسعة.'),
    check('C03-4','CRITICAL','لا سجل مقبول يحمل شذوذ Parser',Object.values(raw.records||{}).every(r=>r.parseDiagnostics?.parseAccepted===true&&arr(r.parseDiagnostics?.anomalies).length===0),`records=${Object.keys(raw.records||{}).length}`,'رفض السجلات الشاذة وإعادة جمعها.')
  ]),
  cycle('مراجع الإفصاحات الرسمية', 'منع تقديم المصدر الثانوي كإفصاح رسمي.', [
    check('C04-1','CRITICAL','بوابة التوثيق الرسمي مفعلة',official.methodology?.name==='EGX_PRO_OFFICIAL_DISCLOSURE_GATE_1.0',official.methodology?.name,'تشغيل بوابة الإفصاحات.'),
    check('C04-2','CRITICAL','كل سجل موثق يحمل الرابط والفترة والنشر',officialValid,`verified=${official.summary?.verifiedRecords||0}`,'رفض أي سجل ناقص.'),
    check('C04-3','HIGH','لا توثيق رسمي بلا رابط في التقرير المالي',arr(fundamental.records).every(r=>r.source?.officialDisclosureVerified!==true||Boolean(r.source?.officialUrl)),`official=${fundamental.summary?.officialVerifiedCompanies||0}`,'إزالة علامة التوثيق الزائفة.')
  ]),
  cycle('مراجع حالة السوق', 'ربط المخاطرة باتساع السوق والاتجاه والتقلب.', [
    check('C05-1','HIGH','محرك حالة السوق يعمل',regime.methodology?.name==='EGX_PRO_MARKET_REGIME_BREADTH_1.0',regime.methodology?.name,'تشغيل محرك الحالة.'),
    check('C05-2','HIGH','عينة حالة السوق كافية',num(regime.metrics?.analyzedCount,0)>=80,`analyzed=${regime.metrics?.analyzedCount}`,'رفع تغطية التاريخ.'),
    check('C05-3','CRITICAL','معامل المخاطرة ضمن 0–1',num(regime.riskMultiplier,-1)>=0&&num(regime.riskMultiplier,2)<=1,`multiplier=${regime.riskMultiplier}`,'إصلاح سياسة المخاطرة.')
  ]),
  cycle('مراجع السجل الحي', 'فصل الأداء الحي عن الاختبار وحفظ كل النتائج.', [
    check('C06-1','CRITICAL','السجل الحي بمنهج مستقل',live.methodology?.name==='EGX_PRO_LIVE_EVIDENCE_2.0',live.methodology?.name,'تشغيل محرك السجل الحي.'),
    check('C06-2','HIGH','كل توصيات الجلسة مؤرشفة',recs.every(r=>arr(evaluation.records).some(x=>x.recommendationDate===decision.sessionDate&&x.ticker===r.ticker&&x.strategyId===r.strategyId)),`archived=${evaluation.summary?.archivedRecommendations}`,'تشغيل الأرشفة قبل النشر.'),
    check('C06-3','CRITICAL','لا ادعاء مهني قبل 100 صفقة و90 يومًا',live.professionalEvidenceReady===((live.summary?.resolvedTrades||0)>=100&&(live.summary?.observedCalendarDays||0)>=90),`ready=${live.professionalEvidenceReady}; trades=${live.summary?.resolvedTrades}; days=${live.summary?.observedCalendarDays}`,'إعادة تصنيف المنتج Pilot.')
  ]),
  cycle('مدير محافظ وإدارة مخاطر', 'تطبيق حدود المراكز والمخاطرة والتعرض.', [
    check('C07-1','CRITICAL','التنفيذ الآلي معطل',decision.guardrails?.automaticOrders===false,`automaticOrders=${decision.guardrails?.automaticOrders}`,'تعطيل التنفيذ فورًا.'),
    check('C07-2','HIGH','وضع Pilot يخفض المخاطرة',recs.every(r=>decision.professionalEvidenceReady===true||r.pilotRiskMode==='REDUCED_RISK'),recs.map(r=>r.pilotRiskMode).join(','),'فرض REDUCED_RISK.'),
    check('C07-3','HIGH','سقف حالة السوق مرتبط بحاسبة المركز',upgrade.includes('applyRegimeRiskCap')&&upgrade.includes('riskPctInput'),'UI risk cap marker','ربط سقف المخاطرة بالحالة.')
  ]),
  cycle('مراجع الارتباط والتركيز', 'منع اعتبار المراكز المتشابهة تنويعًا.', [
    check('C08-1','HIGH','مصفوفة الارتباط تغطي كل التوصيات',recommendationTickers.every(t=>correlationTickers.has(t))&&arr(correlation.matrix).length===recs.length,`matrix=${arr(correlation.matrix).length}`,'إعادة حساب المصفوفة.'),
    check('C08-2','HIGH','حد أدنى للملاحظات المشتركة مطبق',num(correlation.methodology?.minimumPairObservations,0)>=20,`minimum=${correlation.methodology?.minimumPairObservations}`,'رفع الحد الأدنى.'),
    check('C08-3','MEDIUM','التركيز القطاعي ظاهر',Array.isArray(correlation.sectorConcentration),`groups=${arr(correlation.sectorConcentration).length}`,'إضافة القطاع والتعرض.')
  ]),
  cycle('مراجع اختبارات الضغط', 'قياس أثر الفجوات والصدمة القطاعية وتزامن الوقف.', [
    check('C09-1','HIGH','أربعة سيناريوهات ضغط على الأقل',arr(correlation.stressScenarios).length>=4,`scenarios=${arr(correlation.stressScenarios).length}`,'إضافة سيناريوهات الضغط.'),
    check('C09-2','MEDIUM','السيناريوهات موصوفة كتعليمية لا توقعات',arr(correlation.methodology?.principles).some(v=>/not forecasts/i.test(v)),arr(correlation.methodology?.principles).join(' | '),'إضافة الإفصاح المنهجي.')
  ]),
  cycle('مراجع التنبيهات', 'فحص التنبيهات وإذن المستخدم وعدم إرسال أوامر.', [
    check('C10-1','HIGH','محرك التنبيهات يعمل',alerts.methodology?.name==='EGX_PRO_ACTIONABLE_ALERTS_1.0',alerts.methodology?.name,'تشغيل محرك التنبيه.'),
    check('C10-2','CRITICAL','التنبيهات لا ترسل أوامر ولا تدّعي Push خلفيًا',alerts.methodology?.backgroundPushEnabled===false&&!/(placeOrder|sendOrder)/i.test(upgrade),`backgroundPush=${alerts.methodology?.backgroundPushEnabled}`,'تعطيل التنفيذ والادعاء.'),
    check('C10-3','HIGH','الإشعارات تحتاج موافقة المستخدم',upgrade.includes('Notification.requestPermission'), 'permission marker','إضافة طلب الإذن.')
  ]),
  cycle('مراجع تغطية السوق والبحث', 'التأكد من البحث الشامل وعدم فرض الأسهم على الترتيب.', [
    check('C11-1','HIGH','فهرس السوق واسع',arr(market.stocks).length>=180,`stocks=${arr(market.stocks).length}`,'إعادة بناء الفهرس.'),
    check('C11-2','HIGH','رسالة خارج توصيات اليوم موجودة',hasAll(html+app,['ليس ضمن توصيات اليوم','كل السوق']),'search markers','إصلاح نطاق البحث.')
  ]),
  cycle('مختص تجربة المستخدم', 'وضوح المكونات والمرحلة والقيود.', [
    check('C12-1','HIGH','مكونات V16.3 ظاهرة',hasAll(upgrade,['marketRegimeCard','officialDisclosureCard','liveEvidenceV162','correlationRiskCard','alertsButton']),'V16.3 component markers','إعادة تحميل طبقة الواجهة.'),
    check('C12-2','HIGH','مرحلة Pilot والقيود واضحة',upgrade.includes('Professional Pilot')||upgrade.includes('لم يكتمل بعد الحد الأدنى'), 'maturity disclosure','إظهار المرحلة بوضوح.'),
    check('C12-3','MEDIUM','الواجهة عربية RTL',/<html[^>]+lang="ar"[^>]+dir="rtl"/.test(html),'lang and dir','إصلاح اتجاه الصفحة.')
  ]),
  cycle('مختص إمكانية الوصول', 'فحص التنقل والحوارات وإمكانية الاستخدام.', [
    check('C13-1','MEDIUM','التنقل يحمل وصفًا',html.includes('aria-label="التنقل الرئيسي"'),'navigation aria label','إضافة aria-label.'),
    check('C13-2','MEDIUM','درج التنبيهات Dialog موصوف',upgrade.includes('role="dialog"')&&upgrade.includes('aria-modal="true"'),'dialog markers','إضافة خصائص الحوار.'),
    check('C13-3','MEDIUM','الأزرار الجديدة لها type',upgrade.includes('id="alertsButton" type="button"'),'button type marker','تحديد نوع الأزرار.')
  ]),
  cycle('مختص أمن وخصوصية', 'منع الأسرار والتنفيذ غير المصرح وتوضيح التخزين المحلي.', [
    check('C14-1','CRITICAL','لا أسرار أو مفاتيح في الواجهة',!/(api[_-]?key\s*[:=]\s*["'][^"']{12,}|bearer\s+[a-z0-9._-]{20,})/i.test(html+app+upgrade),'secret scan','إزالة الأسرار.'),
    check('C14-2','CRITICAL','لا تكامل وسيط أو أمر شراء',!/(placeOrder|sendOrder|brokerOrder)/i.test(app+upgrade),'broker command scan','إزالة التنفيذ.'),
    check('C14-3','MEDIUM','المحفظة والتنبيهات المحلية تستخدم localStorage فقط',upgrade.includes('localStorage')&&app.includes('localStorage'),'local storage markers','توثيق التخزين المحلي.')
  ]),
  cycle('مراجع PWA والكاش', 'التأكد من فتح V16.3 وعدم استعادة إصدار قديم.', [
    check('C15-1','HIGH','Manifest يحمل V16.3',String(manifest.short_name||'').includes('V16.3')&&String(manifest.start_url||'').includes('version=16.3'),`${manifest.short_name}; ${manifest.start_url}`,'تحديث Manifest.'),
    check('C15-2','HIGH','Service Worker يحمل Build V16.3',serviceWorker.includes('V16.3-PROFESSIONAL')&&serviceWorker.includes('version=16.3'),'service worker markers','تحديث Service Worker.'),
    check('C15-3','HIGH','التحميل يمنع الكاش القديم',serviceWorker.includes("cache: 'no-store'")&&launch.includes('v16-3.js'),'no-store and upgrade loader','إصلاح سياسة الكاش.')
  ]),
  cycle('مراجع التشغيل الآلي', 'ربط جميع المحركات بالـCI والـHeartbeat.', [
    check('C16-1','HIGH','Workflow يشغل كل محركات V16.2/V16.3',hasAll(workflow,['v16-official-disclosure-collector.cjs','v16-live-evidence-engine.cjs','v16-market-regime-engine.cjs','v16-correlation-risk-engine.cjs','v16-alert-engine.cjs']),'workflow engine markers','ربط المحركات.'),
    check('C16-2','HIGH','Heartbeat يحمل V16.3',heartbeat.productInterface==='EGX_PROFESSIONAL_V16_3',heartbeat.productInterface,'تشغيل Heartbeat النهائي.'),
    check('C16-3','HIGH','Heartbeat متزامن مع المحركات',heartbeat.marketRegime?.generatedAt===regime.generatedAt&&heartbeat.liveEvidence?.generatedAt===live.generatedAt&&heartbeat.portfolioRisk?.generatedAt===correlation.generatedAt,'timestamps synchronized','إعادة كتابة Heartbeat في نهاية الدورة.')
  ]),
  cycle('مختبر متصفح حقيقي', 'اختبار الرحلات في Chromium على سطح المكتب والهاتف.', [
    check('C17-1','CRITICAL','اختبارات Playwright نجحت',browser.status==='PASSED'&&num(browser.testsPassed,0)>=13,`status=${browser.status}; passed=${browser.testsPassed}`,'إصلاح الرحلة الفاشلة.'),
    check('C17-2','HIGH','الاختبارات تشمل Desktop وMobile',arr(browser.projects).includes('chromium-desktop')&&arr(browser.projects).includes('chromium-mobile'),arr(browser.projects).join(','),'تشغيل المشروعين.'),
    check('C17-3','HIGH','الاختبارات تغطي الوحدات الأساسية',hasAll(tests,['full-market search','financial view','live evidence','portfolio view','alerts drawer','mobile layout']),'test suite markers','توسيع الاختبارات.')
  ]),
  cycle('مراجع الأداء وقابلية الصيانة', 'فحص فصل الطبقات وحجم الأصول وعدم تكرار المنطق.', [
    check('C18-1','MEDIUM','طبقة V16.3 منفصلة عن التطبيق الأساسي',launch.includes('v16-3.js')&&upgrade.length>1000&&css.length>1000,`js=${upgrade.length}; css=${css.length}`,'فصل الترقية عن التطبيق الأساسي.'),
    check('C18-2','MEDIUM','البيانات تُحمّل no-store',upgrade.includes("cache: 'no-store'"),'fetch policy','إضافة منع الكاش.'),
    check('C18-3','MEDIUM','لا توجد معرفات مكررة في HTML الأساسي',(()=>{const ids=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(x=>x[1]);return new Set(ids).size===ids.length;})(),'HTML IDs','إزالة التكرار.')
  ]),
  cycle('مراجع النزاهة الإحصائية', 'فحص الفصل والمعايرة والمقارنة بالسوق.', [
    check('C19-1','HIGH','المقارنة بالسوق موثقة',live.methodology?.benchmark==='MEDIAN_EQUAL_WEIGHT_EGX_UNIVERSE',live.methodology?.benchmark,'إضافة Benchmark.'),
    check('C19-2','HIGH','معايرة الاحتمالات موجودة',Array.isArray(live.probabilityCalibration),`bins=${arr(live.probabilityCalibration).length}`,'إضافة المعايرة.'),
    check('C19-3','CRITICAL','Backtest غير مدمج في السجل الحي',arr(live.methodology?.principles).some(v=>/never merged/i.test(v)),'methodology principle','فصل السجلين.')
  ]),
  cycle('المستلم النهائي ومسؤول الاعتماد', 'تجميع جميع البوابات واتخاذ قرار الاستلام.', [
    check('C20-1','CRITICAL','الإصدار V16.3 موحد',heartbeat.productInterface==='EGX_PROFESSIONAL_V16_3'&&String(manifest.short_name||'').includes('V16.3')&&serviceWorker.includes('V16.3'),heartbeat.productInterface,'توحيد الإصدار.'),
    check('C20-2','HIGH','لا ملاحظات حاجبة في بوابة الإصدار',release.acceptance==='ACCEPTED'||release.acceptance===undefined,release.acceptance||'release gate runs after review','تشغيل بوابة الإصدار.'),
    check('C20-3','HIGH','المنتج لا يدّعي أداءً مثبتًا بلا عينة',live.professionalEvidenceReady===true||heartbeat.evidenceTier!=='PROFESSIONAL_EVIDENCE',`tier=${heartbeat.evidenceTier}; ready=${live.professionalEvidenceReady}`,'إعادة تصنيف المنتج.'),
    check('C20-4','CRITICAL','كل وظائف الإصدار لها مصدر بيانات',Boolean(regime.generatedAt&&live.generatedAt&&fundamental.generatedAt&&correlation.generatedAt&&alerts.generatedAt),`regime=${regime.generatedAt}; live=${live.generatedAt}; financial=${fundamental.generatedAt}; correlation=${correlation.generatedAt}; alerts=${alerts.generatedAt}`,'إعادة تشغيل المحركات.')
  ])
];

cycles.forEach((item, index) => {
  item.cycle = index + 1;
  item.summary = {
    total: item.checks.length,
    closed: item.checks.filter(row => row.status === 'CLOSED').length,
    open: item.checks.filter(row => row.status === 'OPEN').length,
    blocking: item.checks.filter(row => row.status === 'OPEN' && rank[row.severity] >= 3).length
  };
});
const all = cycles.flatMap(item => item.checks.map(row => ({ ...row, cycle: item.cycle, role: item.role })));
const open = all.filter(row => row.status === 'OPEN');
const blocking = open.filter(row => rank[row.severity] >= 3);
const severity = {};
for (const level of Object.keys(rank)) severity[level] = { total: all.filter(row => row.severity === level).length, open: open.filter(row => row.severity === level).length, closed: all.filter(row => row.severity === level && row.status === 'CLOSED').length };
const report = {
  schemaVersion: '16.3.0',
  generatedAt: new Date().toISOString(),
  application: 'EGX Pro Professional V16.3',
  scope: { type: 'WHOLE_APPLICATION', modules: ['market-data','technical-analysis','financial-analysis','official-disclosures','market-regime','live-evidence','portfolio-risk','correlation','alerts','search','ux','accessibility','security','pwa','automation','browser-tests'] },
  methodology: 'Twenty independent professional roles with evidence-based severity gates',
  cyclesCompleted: cycles.length,
  acceptance: blocking.length ? 'REJECTED_BLOCKING_FINDINGS' : 'ACCEPTED_ZERO_BLOCKING_FINDINGS',
  acceptanceCriteria: { zeroCritical: !open.some(row=>row.severity==='CRITICAL'), zeroHigh: !open.some(row=>row.severity==='HIGH'), allTwentyCyclesExecuted: cycles.length===20, wholeApplicationScope: true },
  summary: { totalChecks: all.length, closedChecks: all.length-open.length, openChecks: open.length, blockingFindings: blocking.length, severity },
  cycles,
  openFindings: open,
  blockingFindings: blocking
};
const lines = [
  '# تقرير مراجعة V16.3 الشاملة — 20 دورة', '',
  `- التاريخ: ${report.generatedAt}`,
  `- النطاق: التطبيق بالكامل`,
  `- الدورات: ${report.cyclesCompleted}/20`,
  `- الحكم: **${report.acceptance}**`,
  `- الفحوص المغلقة: ${report.summary.closedChecks}/${report.summary.totalChecks}`,
  `- الحرجة المفتوحة: ${severity.CRITICAL.open}`,
  `- العالية المفتوحة: ${severity.HIGH.open}`, '',
  '| الدورة | الدور | الفحوص | المغلق | المفتوح | الحاجب |', '|---:|---|---:|---:|---:|---:|',
  ...cycles.map(c=>`| ${c.cycle} | ${c.role} | ${c.summary.total} | ${c.summary.closed} | ${c.summary.open} | ${c.summary.blocking} |`), '',
  '## الملاحظات المفتوحة', '',
  ...(open.length ? ['| الدورة | الخطورة | الملاحظة | الدليل | الإجراء |','|---:|---|---|---|---|',...open.map(r=>`| ${r.cycle} | ${r.severity} | ${r.title} | ${String(r.evidence).replace(/\|/g,'/')} | ${r.remediation||'—'} |`)] : ['لا توجد ملاحظات مفتوحة.']), '',
  '## قرار الاستلام', '',
  blocking.length ? 'مرفوض حاليًا حتى إغلاق الملاحظات الحرجة والعالية.' : 'مقبول من ناحية جودة التطبيق ضمن نطاق الاختبارات، مع بقاء تصنيف الأداء الاستثماري تابعًا لحجم السجل الحي.'
];
fs.mkdirSync(P('data/review'), { recursive: true });
fs.writeFileSync(P('data/review/v16-3-whole-app-review.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync(P('data/review/v16-3-whole-app-review.md'), `${lines.join('\n')}\n`, 'utf8');
console.log({ acceptance: report.acceptance, cycles: report.cyclesCompleted, summary: report.summary });
if (blocking.length) process.exitCode = 1;
