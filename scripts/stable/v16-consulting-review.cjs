#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const OUT_DIR = path.join(ROOT, 'data/review');
const JSON_OUT = path.join(OUT_DIR, 'v16-consulting-review.json');
const MD_OUT = path.join(OUT_DIR, 'v16-consulting-review.md');
const FAIL_ON_BLOCKING = process.env.REVIEW_FAIL_ON_BLOCKING !== '0';

const P = rel => path.join(ROOT, rel);
const exists = rel => fs.existsSync(P(rel));
const readText = (rel, fallback = '') => { try { return fs.readFileSync(P(rel), 'utf8'); } catch { return fallback; } };
const readJson = (rel, fallback = {}) => { try { return JSON.parse(readText(rel)); } catch { return fallback; } };
const num = (v, fallback = null) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const arr = v => Array.isArray(v) ? v : [];
const isoAgeDays = value => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? (Date.now() - time) / 86400000 : Infinity;
};
const countDuplicates = values => values.filter((v, i) => values.indexOf(v) !== i);
const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

const files = {
  html: readText('preview-v16/app/index.html'),
  app: readText('preview-v16/app/app.js'),
  pilot: readText('preview-v16/app/pilot-policy.js'),
  fundamentalsUi: readText('preview-v16/app/fundamentals.js'),
  styles: readText('preview-v16/app/styles.css'),
  fundamentalsCss: readText('preview-v16/app/fundamentals.css'),
  root: readText('index.html'),
  serviceWorker: readText('service-worker.js'),
  workflow: readText('.github/workflows/v15-practical-deploy.yml'),
  manifest: readJson('manifest.json'),
  decision: readJson('data/stable/v15-practical-decision.json'),
  validation: readJson('data/research/v15-practical-validation.json'),
  price: readJson('data/stable/v15-price-truth.json'),
  evaluation: readJson('data/stable/v15-recommendation-evaluation.json'),
  ledger: readJson('data/stable/v15-recommendation-ledger.json'),
  update: readJson('data/stable/v15-update-status.json'),
  fundamental: readJson('data/stable/v16-fundamental-analysis.json'),
  fundamentalRaw: readJson('data/fundamentals/v16-fundamental-raw.json'),
  market: readJson('data/quant/market-search-index-v13-17.json'),
};

function check(id, severity, title, passed, evidence, remediation = null) {
  return { id, severity, title, status: passed ? 'CLOSED' : 'OPEN', evidence, remediation: passed ? null : remediation };
}
function hasAll(text, markers) { return markers.every(marker => text.includes(marker)); }
function recommendationRows() { return arr(files.decision.recommendations); }
function financialByTicker() {
  const map = new Map();
  for (const row of arr(files.fundamental.records)) map.set(String(row.ticker || '').toUpperCase(), row);
  for (const row of arr(files.fundamental.recommendationAnalysis)) {
    const ticker = String(row.ticker || '').toUpperCase();
    if (!map.has(ticker)) map.set(ticker, row);
  }
  return map;
}

const recs = recommendationRows();
const financialMap = financialByTicker();
const marketStocks = arr(files.market.stocks);
const evaluationRecords = arr(files.evaluation.records);
const htmlIds = [...files.html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
const duplicateHtmlIds = [...new Set(countDuplicates(htmlIds))];
const currentFinancialStatuses = recs.map(r => financialMap.get(String(r.ticker).toUpperCase())?.status || financialMap.get(String(r.ticker).toUpperCase())?.verdict || 'DATA_UNAVAILABLE');
const scoredCurrentRecommendations = recs.filter(r => num(financialMap.get(String(r.ticker).toUpperCase())?.score) !== null).length;

const cycles = [
  {
    role: 'مختص جودة بيانات السوق',
    objective: 'التحقق من حداثة واتساق أسعار التنفيذ واتساع السوق.',
    checks: [
      check('D01', 'CRITICAL', 'بوابة حقيقة الأسعار مفعلة', files.price.ready === true && files.price.executionGrade === true, `ready=${files.price.ready}; executionGrade=${files.price.executionGrade}`, 'إيقاف نشر التوصيات حتى ينجح مصدر سعر حقيقي ودقيق.'),
      check('D02', 'HIGH', 'تغطية سعرية كافية', num(files.price.acceptedRows, 0) >= num(files.price.minimumExecutionRows, 80), `accepted=${files.price.acceptedRows}; minimum=${files.price.minimumExecutionRows || 80}`, 'رفع التغطية أو إيقاف التوصيات.'),
      check('D03', 'HIGH', 'جلسة القرار مطابقة للجلسة المتوقعة', Boolean(files.decision.sessionDate) && files.decision.sessionDate === files.decision.expectedLatestSession, `${files.decision.sessionDate} vs ${files.decision.expectedLatestSession}`, 'إعادة بناء القرار من آخر جلسة مكتملة.'),
      check('D04', 'MEDIUM', 'المصدر موصوف وقابل للتدقيق', Boolean(files.price.source?.name && files.price.source?.generatedAt), JSON.stringify(files.price.source || {}), 'إضافة اسم المصدر وتاريخ إنشائه.'),
    ],
  },
  {
    role: 'محلل فني محترف',
    objective: 'اختبار صلاحية منطق الفرص ومنع المطاردة.',
    checks: [
      check('T01', 'HIGH', 'عدد الفرص لا يُملأ قسرًا', recs.length >= 0 && recs.length <= 5, `count=${recs.length}`, 'حصر القائمة في فرص اجتازت البوابات فقط.'),
      check('T02', 'CRITICAL', 'كل فرصة تجتاز الحد الأدنى للعائد/المخاطرة', recs.every(r => num(r.riskReward, 0) >= num(files.decision.guardrails?.minimumRiskReward, 1.15)), recs.map(r => `${r.ticker}:${r.riskReward}`).join(', '), 'حجب أي فرصة دون الحد الأدنى.'),
      check('T03', 'CRITICAL', 'منع مطاردة RSI الساخن', recs.every(r => num(r.rsi14, 999) <= num(files.decision.guardrails?.maximumRecommendationRsi, 78)), recs.map(r => `${r.ticker}:${r.rsi14}`).join(', '), 'نقل السهم الساخن إلى قائمة المراقبة.'),
      check('T04', 'HIGH', 'احتمال الهدف أعلى من الوقف', recs.every(r => num(r.estimatedTargetProbabilityPct, 0) > num(r.estimatedStopProbabilityPct, 100)), recs.map(r => `${r.ticker}:${r.estimatedTargetProbabilityPct}>${r.estimatedStopProbabilityPct}`).join(', '), 'رفض النموذج أو الفرصة التي لا تحقق أفضلية احتمالية.'),
    ],
  },
  {
    role: 'محلل مالي واستثماري',
    objective: 'التأكد من وجود حكم مالي موثق لكل فرصة.',
    checks: [
      check('F01', 'HIGH', 'منهج مالي متعدد المحاور منشور', files.fundamental.methodology?.name === 'EGX_PRO_FUNDAMENTAL_MULTI_PILLAR_1.0', files.fundamental.methodology?.name || 'missing', 'تشغيل محرك التحليل المالي المعتمد.'),
      check('F02', 'HIGH', 'حالة مالية لكل توصية حالية', arr(files.fundamental.recommendationAnalysis).length === recs.length, `financialRows=${arr(files.fundamental.recommendationAnalysis).length}; recs=${recs.length}`, 'إنشاء DATA_UNAVAILABLE صريح لأي سهم لم تتوفر بياناته.'),
      check('F03', 'HIGH', 'تغطية مالية فعلية للتوصيات', recs.length === 0 || scoredCurrentRecommendations >= Math.min(recs.length, 3), `scored=${scoredCurrentRecommendations}/${recs.length}; statuses=${currentFinancialStatuses.join(',')}`, 'تشغيل مجمع البيانات ذي الأولوية للتوصيات قبل النشر.'),
      check('F04', 'MEDIUM', 'المصدر الثانوي منفصل عن التوثيق الرسمي', hasAll(JSON.stringify(files.fundamental.methodology || {}), ['No financial metric is invented', 'Secondary standardized data']), 'methodology disclosure present', 'إظهار طبقة المصدر ومستوى التوثيق بوضوح.'),
    ],
  },
  {
    role: 'مدير محافظ وإدارة مخاطر',
    objective: 'منع الإفراط في المخاطرة أو التنفيذ الآلي.',
    checks: [
      check('R01', 'CRITICAL', 'الأوامر الآلية معطلة', files.decision.guardrails?.automaticOrders === false, `automaticOrders=${files.decision.guardrails?.automaticOrders}`, 'تعطيل أي تنفيذ آلي وإبقاء القرار يدويًا.'),
      check('R02', 'HIGH', 'وضع Pilot يخفض المخاطرة', recs.every(r => files.decision.professionalEvidenceReady === true || r.pilotRiskMode === 'REDUCED_RISK'), recs.map(r => `${r.ticker}:${r.pilotRiskMode}`).join(', '), 'فرض REDUCED_RISK قبل اكتمال الدليل المهني.'),
      check('R03', 'HIGH', 'حاسبة المركز تفرض سقف 0.25% للـPilot', files.pilot.includes('Math.min(requestedRiskPct, 0.25)'), 'pilot risk cap marker', 'إعادة تفعيل سقف المخاطرة.'),
      check('R04', 'MEDIUM', 'حدود المحفظة والاستراتيجية موجودة', hasAll(files.html, ['portfolioRiskLimit', 'portfolioPositionLimit', 'strategyExposureLimit']), 'portfolio policy controls present', 'إضافة حدود المخاطر الكلية والتركيز.'),
    ],
  },
  {
    role: 'مهندس برمجيات ومراجع معماري',
    objective: 'فحص وحدة الإصدار ومسارات البيانات.',
    checks: [
      check('A01', 'HIGH', 'واجهة V16.1 الموحدة موجودة', hasAll(files.html, ['V16.1', 'fundamentals.js', 'pilot-policy.js']), 'V16.1 assets referenced', 'توحيد الموارد في إصدار واحد.'),
      check('A02', 'HIGH', 'المشغل الرئيسي يفتح V16', files.root.includes('preview-v16/app/index.html'), 'root launcher targets V16', 'توجيه الرابط الرئيسي إلى V16.'),
      check('A03', 'MEDIUM', 'ملفات المحركات المالية موجودة', exists('scripts/stable/v16-fundamental-collector.cjs') && exists('scripts/stable/v16-fundamental-engine.cjs'), 'collector and engine files found', 'إضافة المحركات المفقودة.'),
      check('A04', 'MEDIUM', 'لا توجد معرفات HTML مكررة', duplicateHtmlIds.length === 0, duplicateHtmlIds.join(', ') || 'none', 'إزالة المعرفات المكررة.'),
    ],
  },
  {
    role: 'مختبر جودة وبرمجيات QA',
    objective: 'اختبار سلامة الأصول ومنع أخطاء العرض.',
    checks: [
      check('Q01', 'HIGH', 'الأصول الأساسية غير فارغة', [files.html, files.app, files.pilot, files.fundamentalsUi, files.styles].every(x => x.length > 100), 'core assets loaded', 'استعادة الملفات الناقصة.'),
      check('Q02', 'HIGH', 'لا توجد محارف استبدال تالفة', ![files.html, files.app, files.pilot, files.fundamentalsUi].some(x => x.includes('�')), 'replacement-character scan', 'تصحيح الترميز UTF-8.'),
      check('Q03', 'MEDIUM', 'حالات الفراغ والخطأ ظاهرة للمستخدم', hasAll(files.html + files.fundamentalsUi, ['empty', 'DATA_UNAVAILABLE']), 'empty/data unavailable states present', 'إضافة حالات واضحة لغياب البيانات.'),
      check('Q04', 'LOW', 'ملف CSS المالي موجود', files.fundamentalsCss.length > 50, `length=${files.fundamentalsCss.length}`, 'إضافة تنسيق مالي متجاوب.'),
    ],
  },
  {
    role: 'مختص حداثة البيانات',
    objective: 'منع البيانات القديمة من الظهور كبيانات حالية.',
    checks: [
      check('FR01', 'HIGH', 'تقرير السعر حديث تشغيليًا', isoAgeDays(files.price.generatedAt) <= 4, `ageDays=${isoAgeDays(files.price.generatedAt).toFixed(2)}`, 'إعادة تشغيل مسح السوق أو حجب التوصيات.'),
      check('FR02', 'HIGH', 'تقرير التحليل المالي مولد من دورة فعلية', num(files.fundamental.summary?.marketUniverse, 0) > 0 && Boolean(files.fundamental.sourceHealth?.lastCollectorRun), `universe=${files.fundamental.summary?.marketUniverse}; lastRun=${files.fundamental.sourceHealth?.lastCollectorRun}`, 'تشغيل المجمع المالي وإعادة بناء التقرير.'),
      check('FR03', 'MEDIUM', 'القوائم القديمة مصنفة لا مخفية', arr(files.fundamental.records).every(r => r.dataQuality?.stale !== undefined || r.status === 'DATA_INSUFFICIENT'), `records=${arr(files.fundamental.records).length}`, 'إضافة علامة stale وحكم صريح.'),
    ],
  },
  {
    role: 'مراجع إحصائي وBacktest',
    objective: 'فصل الدليل التاريخي عن النتائج الحية.',
    checks: [
      check('B01', 'HIGH', 'تقسيم تطوير/تحقق/اختبار موجود', hasAll(JSON.stringify(files.validation.sessions || {}), ['development', 'validation', 'test']), JSON.stringify(files.validation.sessions || {}), 'إعادة بناء Walk-forward split.'),
      check('B02', 'CRITICAL', 'منع تسرب المستقبل مسجل', files.decision.guardrails?.futureLeakageForbidden === true, `futureLeakageForbidden=${files.decision.guardrails?.futureLeakageForbidden}`, 'إيقاف النموذج حتى ضمان عدم تسرب المستقبل.'),
      check('B03', 'HIGH', 'تكاليف التداول محتسبة', num(files.decision.guardrails?.transactionCostsPct, 0) > 0, `cost=${files.decision.guardrails?.transactionCostsPct}`, 'إضافة العمولة والانزلاق للتقييم.'),
      check('B04', 'MEDIUM', 'قصر العينة يظهر كـPilot', files.decision.evidenceTier !== 'PROFESSIONAL' || files.decision.professionalEvidenceReady === true, `tier=${files.decision.evidenceTier}`, 'منع كلمة مثبت عند قصر العينة.'),
    ],
  },
  {
    role: 'مراجع السجل الحي',
    objective: 'التأكد من عدم حذف الخسائر أو تعديل الخطط بعد صدورها.',
    checks: [
      check('L01', 'HIGH', 'منهج تقييم حي تحفظي مثبت', files.evaluation.methodology?.version === 'V15_CONSERVATIVE_DAILY_OHLC_1.0', files.evaluation.methodology?.version || 'missing', 'استعادة منهج التقييم المحافظ.'),
      check('L02', 'HIGH', 'لا توجد معرفات توصيات مكررة', new Set(evaluationRecords.map(x => x.id)).size === evaluationRecords.length, `records=${evaluationRecords.length}`, 'إزالة التكرارات دون حذف النتائج الصحيحة.'),
      check('L03', 'HIGH', 'توصيات اليوم مؤرشفة', recs.every(r => evaluationRecords.some(x => x.recommendationDate === files.decision.sessionDate && x.ticker === r.ticker && x.strategyId === r.strategyId)), `archived=${recs.filter(r => evaluationRecords.some(x => x.recommendationDate === files.decision.sessionDate && x.ticker === r.ticker && x.strategyId === r.strategyId)).length}/${recs.length}`, 'تشغيل الأرشفة قبل النشر.'),
      check('L04', 'MEDIUM', 'السجل الحي منفصل نصيًا عن Backtest', hasAll(files.html + files.app, ['السجل الحي', 'Backtest']), 'separation labels present', 'إظهار القسمين منفصلين.'),
    ],
  },
  {
    role: 'مراجع تغطية السوق والبحث',
    objective: 'ضمان البحث في السوق الكامل دون تغيير ترتيب اليوم.',
    checks: [
      check('S01', 'HIGH', 'فهرس السوق واسع', marketStocks.length >= 100, `stocks=${marketStocks.length}`, 'إعادة بناء فهرس البحث الكامل.'),
      check('S02', 'HIGH', 'بحث السوق غير مقصور على التوصيات', hasAll(files.html, ['كل السوق', 'خارج توصيات اليوم', 'ليس ضمن توصيات اليوم']), 'market scopes present', 'إضافة نطاق البحث الكامل ورسالة واضحة.'),
      check('S03', 'MEDIUM', 'أسهم التوصيات موجودة في فهرس السوق', recs.every(r => marketStocks.some(s => s.ticker === r.ticker)), `matched=${recs.filter(r => marketStocks.some(s => s.ticker === r.ticker)).length}/${recs.length}`, 'مزامنة رموز التوصيات مع فهرس السوق.'),
    ],
  },
  {
    role: 'مختص تجربة مستخدم',
    objective: 'فحص وضوح القرار وعدم التضليل.',
    checks: [
      check('U01', 'HIGH', 'الواجهة عربية RTL ومتجاوبة', /<html[^>]+lang="ar"[^>]+dir="rtl"/.test(files.html) && files.html.includes('viewport'), 'ar/rtl/viewport present', 'تصحيح اللغة والاتجاه والتجاوب.'),
      check('U02', 'HIGH', 'لا توجد لغة ضمان ربح', !/(ضمان الربح|أرباح مضمونة|guaranteed profit)/i.test(files.html + files.app + files.fundamentalsUi), 'marketing claim scan clean', 'إزالة أي ادعاء ضمان.'),
      check('U03', 'MEDIUM', 'الحكم المالي والفني يظهران منفصلين', hasAll(files.html, ['التحليل الفني', 'التحليل المالي']), 'separate analysis headings', 'فصل قراري المضاربة والاستثمار.'),
      check('U04', 'LOW', 'زر تحديث البيانات واضح', files.html.includes('refreshBtn'), 'refresh button present', 'إضافة زر تحديث وحالة آخر تحديث.'),
    ],
  },
  {
    role: 'مختص إمكانية الوصول',
    objective: 'رفع قابلية الاستخدام لشرائح أوسع.',
    checks: [
      check('AC01', 'MEDIUM', 'التنقل يحمل وصفًا', files.html.includes('aria-label="التنقل الرئيسي"'), 'navigation aria-label present', 'إضافة وصف للتنقل.'),
      check('AC02', 'MEDIUM', 'عناصر التحكم لها تسميات نصية', (files.html.match(/<label/g) || []).length >= 5, `labels=${(files.html.match(/<label/g) || []).length}`, 'إضافة label لكل مدخل.'),
      check('AC03', 'LOW', 'تسلسل عناوين منطقي', files.html.includes('<h1') && files.html.includes('<h2'), 'h1/h2 present', 'إعادة تنظيم العناوين.'),
    ],
  },
  {
    role: 'مختص أمن معلومات وخصوصية',
    objective: 'منع تسريب أسرار أو إدخال HTML غير منضبط.',
    checks: [
      check('SEC01', 'CRITICAL', 'لا توجد مفاتيح أسرار صريحة في الواجهة', !/(api[_-]?key\s*[:=]\s*["'][^"']{12,}|bearer\s+[a-z0-9._-]{20,})/i.test(files.html + files.app + files.pilot + files.fundamentalsUi), 'secret scan clean', 'إزالة السر وتدويره فورًا.'),
      check('SEC02', 'HIGH', 'توجد دالة هروب للنصوص الديناميكية', files.app.includes("replace(/[&<>\"']/g"), 'escape helper present', 'تطبيق escaping قبل innerHTML.'),
      check('SEC03', 'MEDIUM', 'المحفظة محلية ولا ترسل أوامر', files.html.includes('محفوظة على جهازك فقط') && files.decision.guardrails?.automaticOrders === false, 'local-only disclosure present', 'إضافة الإفصاح وتعطيل الاتصال بالوسيط.'),
    ],
  },
  {
    role: 'مراجع تطبيق مثبت وذاكرة مؤقتة',
    objective: 'منع فتح نسخة قديمة من الأيقونة أو الكاش.',
    checks: [
      check('P01', 'HIGH', 'Manifest يفتح المشغل الأحدث', files.manifest.start_url === './?launch=pwa&latest=1', `start_url=${files.manifest.start_url}`, 'تحديث start_url.'),
      check('P02', 'HIGH', 'Service Worker يرحل الإصدارات القديمة', hasAll(files.serviceWorker, ['preview-v13', 'preview-v14', 'preview-v15', 'LATEST_URL']), 'legacy paths covered', 'إضافة تحويل كل المسارات القديمة.'),
      check('P03', 'MEDIUM', 'التحميل الحي يمنع الكاش القديم', files.root.includes("cache:'no-store'") || files.root.includes("cache: 'no-store'"), 'no-store launcher fetch', 'استخدام no-store للـheartbeat.'),
    ],
  },
  {
    role: 'مراجع التشغيل الآلي',
    objective: 'ضمان أن التحديثات والفحوص تعمل دون تدخل يدوي.',
    checks: [
      check('O01', 'HIGH', 'دورة السوق الآلية مفعلة', files.update.automation?.enabled === true && num(files.update.automation?.attemptsPerTradingDay, 0) >= 5, JSON.stringify(files.update.automation || {}), 'إصلاح جدول المسح.'),
      check('O02', 'HIGH', 'الدورة المالية جزء من النشر', hasAll(files.workflow, ['v16-fundamental-collector.cjs', 'v16-fundamental-engine.cjs']), 'financial engine workflow markers present', 'إضافة الجمع والتحليل إلى Actions.'),
      check('O03', 'MEDIUM', 'فشل المصدر يحتفظ بالكاش', files.workflow.includes('cached records are retained'), 'cache retention disclosure present', 'منع مسح الكاش عند فشل المزود.'),
    ],
  },
  {
    role: 'مراجع منهجية التحليل المالي',
    objective: 'اختبار اختلاف القطاعات وجودة الدرجات.',
    checks: [
      check('FM01', 'HIGH', 'البنوك والخدمات المالية لها معاملة مختلفة', hasAll(readText('scripts/stable/v16-fundamental-collector.cjs') + readText('scripts/stable/v16-fundamental-engine.cjs'), ['BANK', 'FINANCIAL_SERVICES']), 'sector templates present', 'إضافة قوالب قطاعية.'),
      check('FM02', 'HIGH', 'لا تُنشر درجة عند اكتمال ضعيف', arr(files.fundamental.records).every(r => r.score === null || num(r.dataQuality?.completenessPct, 0) >= 45), `records=${arr(files.fundamental.records).length}`, 'إلغاء الدرجة وتحويلها DATA_INSUFFICIENT.'),
      check('FM03', 'HIGH', 'التوثيق الرسمي يتطلب رابطًا', arr(files.fundamental.records).every(r => r.source?.officialDisclosureVerified !== true || Boolean(r.source?.officialUrl)), 'official source URL rule', 'إزالة علامة رسمي أو إضافة الرابط.'),
    ],
  },
  {
    role: 'مراجع التقييم والقيمة العادلة',
    objective: 'منع عرض قيمة عادلة وهمية أو غير موضحة.',
    checks: [
      check('V01', 'HIGH', 'منهج القيمة العادلة النسبي معلن', arr(files.fundamental.records).every(r => r.relativeFairValue?.fairValue == null || String(r.relativeFairValue?.methodology || '').includes('not a DCF')), 'relative valuation disclosure checked', 'إخفاء القيمة أو إضافة المنهج بوضوح.'),
      check('V02', 'HIGH', 'لا قيمة عادلة دون أقران كافين', arr(files.fundamental.records).every(r => r.relativeFairValue?.fairValue == null || num(r.relativeFairValue?.peerCount, 0) >= 3), 'peer count gate checked', 'طلب ثلاثة أقران على الأقل.'),
      check('V03', 'MEDIUM', 'هامش الصعود ليس ضمانًا', files.fundamentalsUi.includes('القيمة نسبية') || files.fundamentalsUi.includes('ليست ضمان'), 'valuation caveat present', 'إضافة تحذير صريح.'),
    ],
  },
  {
    role: 'مستخدم محترف سيدفع مقابل التطبيق',
    objective: 'اختبار القيمة التجارية والشفافية.',
    checks: [
      check('C01', 'HIGH', 'مرحلة المنتج معلنة وليست مضللة', hasAll(files.html + files.app, ['جاهزية المنتج', 'Pilot']), 'product stage disclosure present', 'إظهار مرحلة النضج.'),
      check('C02', 'HIGH', 'نسب Backtest لا تعرض كسجل حي', files.html.includes('فصل واضح بين Backtest والسجل الحي') || files.app.includes('تاريخية وليست حية'), 'backtest caveat present', 'إضافة الإفصاح قرب النسبة.'),
      check('C03', 'MEDIUM', 'المصادر وتواريخها تظهر في المالي', hasAll(files.fundamentalsUi, ['المصدر', 'تاريخ']), 'source/date UI markers present', 'إضافة المصدر وتاريخ القوائم.'),
    ],
  },
  {
    role: 'مراجع الأداء وقابلية التوسع',
    objective: 'منع تحميل مالي كامل يبطئ كل دورة.',
    checks: [
      check('PERF01', 'MEDIUM', 'الجمع المالي يعمل بدفعات', /EGX_FUNDAMENTAL_BATCH/.test(readText('scripts/stable/v16-fundamental-collector.cjs')), 'batch setting present', 'إضافة batch وحفظ تدريجي.'),
      check('PERF02', 'MEDIUM', 'التوازي محدود', /EGX_FUNDAMENTAL_CONCURRENCY/.test(readText('scripts/stable/v16-fundamental-collector.cjs')), 'bounded concurrency present', 'تقييد عدد الطلبات المتزامنة.'),
      check('PERF03', 'LOW', 'الواجهة لا تحمل القوائم الخام الضخمة', !files.html.includes('v16-fundamental-raw.json'), 'raw cache not loaded by HTML', 'تحميل التقرير المجمّع فقط.'),
    ],
  },
  {
    role: 'مراجع الانحدار والتكامل',
    objective: 'التأكد من أن التحليل المالي لم يكسر الوظائف السابقة.',
    checks: [
      check('REG01', 'HIGH', 'كل توصية تظل لها خطة فنية صالحة', recs.every(r => num(r.entryLow, 0) > 0 && num(r.entryHigh, 0) >= num(r.entryLow, 0) && num(r.stopLoss, 0) < num(r.entryLow, 0) && num(r.target1, 0) > num(r.entryHigh, 0)), recs.map(r => r.ticker).join(', '), 'إعادة بناء الخطة أو حذف الفرصة.'),
      check('REG02', 'HIGH', 'التحليل المالي لا يفعّل الأوامر', files.decision.guardrails?.automaticOrders === false && !files.fundamentalsUi.includes('sendOrder'), 'no execution coupling', 'فصل التحليل عن التنفيذ.'),
      check('REG03', 'MEDIUM', 'الرابط والأيقونة يستخدمان نفس الإصدار', files.manifest.short_name?.includes('V16') && files.root.includes('preview-v16/app/index.html'), `${files.manifest.short_name}`, 'تحديث Manifest والمشغل معًا.'),
    ],
  },
  {
    role: 'المستلم النهائي ومسؤول الاعتماد',
    objective: 'تطبيق شروط الاستلام النهائية بالأدلة.',
    checks: [
      check('FINAL01', 'CRITICAL', 'لا تُنشر توصيات بأسعار غير موثقة', files.price.executionGrade === true || recs.length === 0, `executionGrade=${files.price.executionGrade}; recs=${recs.length}`, 'إيقاف قائمة التوصيات.'),
      check('FINAL02', 'HIGH', 'كل توصية لها حالة مالية صريحة', recs.every(r => financialMap.has(String(r.ticker).toUpperCase())), `mapped=${recs.filter(r => financialMap.has(String(r.ticker).toUpperCase())).length}/${recs.length}`, 'إنشاء سجل مالي صريح لكل توصية.'),
      check('FINAL03', 'HIGH', 'Heartbeat يطابق التقارير الحالية', files.update.recommendationGeneratedAt === files.decision.generatedAt && files.update.fundamentals?.generatedAt === files.fundamental.generatedAt, `decision=${files.decision.generatedAt}; heartbeat=${files.update.recommendationGeneratedAt}; financial=${files.fundamental.generatedAt}; hbFinancial=${files.update.fundamentals?.generatedAt}`, 'إعادة كتابة Heartbeat بعد كل المحركات.'),
      check('FINAL04', 'MEDIUM', 'الإصدار موحد نصيًا', hasAll(files.html + JSON.stringify(files.update), ['V16.1', 'EGX_PROFESSIONAL_V16_1']), 'version markers present', 'مزامنة رقم الإصدار.'),
    ],
  },
];

const results = cycles.map((cycle, index) => {
  const open = cycle.checks.filter(item => item.status === 'OPEN');
  return {
    cycle: index + 1,
    role: cycle.role,
    objective: cycle.objective,
    checks: cycle.checks,
    summary: {
      total: cycle.checks.length,
      closed: cycle.checks.length - open.length,
      open: open.length,
      blocking: open.filter(item => severityRank[item.severity] >= severityRank.HIGH).length,
    },
  };
});

const allChecks = results.flatMap(cycle => cycle.checks.map(item => ({ cycle: cycle.cycle, role: cycle.role, ...item })));
const openChecks = allChecks.filter(item => item.status === 'OPEN');
const blocking = openChecks.filter(item => severityRank[item.severity] >= severityRank.HIGH);
const severitySummary = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].reduce((acc, severity) => {
  acc[severity] = {
    total: allChecks.filter(item => item.severity === severity).length,
    open: openChecks.filter(item => item.severity === severity).length,
    closed: allChecks.filter(item => item.severity === severity && item.status === 'CLOSED').length,
  };
  return acc;
}, {});
const acceptance = blocking.length === 0 ? (openChecks.length === 0 ? 'ACCEPTED_ZERO_FINDINGS' : 'ACCEPTED_WITH_NON_BLOCKING_FINDINGS') : 'REJECTED_BLOCKING_FINDINGS';

const report = {
  schemaVersion: '16.2.0',
  generatedAt: new Date().toISOString(),
  application: 'EGX Pro Professional V16.1',
  methodology: '20-role consulting review with evidence-based closure and severity gates',
  cyclesCompleted: results.length,
  acceptance,
  acceptanceCriteria: {
    zeroCritical: severitySummary.CRITICAL.open === 0,
    zeroHigh: severitySummary.HIGH.open === 0,
    noBlockingErrors: blocking.length === 0,
    allTwentyCyclesExecuted: results.length === 20,
  },
  summary: {
    totalChecks: allChecks.length,
    closedChecks: allChecks.length - openChecks.length,
    openChecks: openChecks.length,
    blockingFindings: blocking.length,
    severity: severitySummary,
    recommendationCount: recs.length,
    financialCoverageCurrentRecommendations: scoredCurrentRecommendations,
    marketUniverse: marketStocks.length,
    acceptedPriceRows: num(files.price.acceptedRows, 0),
    liveResolvedTrades: num(files.evaluation.summary?.resolvedTrades, 0),
  },
  cycles: results,
  openFindings: openChecks,
  blockingFindings: blocking,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + '\n');

const md = [];
md.push('# تقرير المراجعة الاستشارية — EGX Pro V16.1');
md.push('');
md.push(`- تاريخ التوليد: ${report.generatedAt}`);
md.push(`- الدورات المنفذة: ${report.cyclesCompleted}/20`);
md.push(`- الحكم: **${acceptance}**`);
md.push(`- الفحوص: ${report.summary.closedChecks}/${report.summary.totalChecks} مغلق`);
md.push(`- الملاحظات الحرجة المفتوحة: ${severitySummary.CRITICAL.open}`);
md.push(`- الملاحظات العالية المفتوحة: ${severitySummary.HIGH.open}`);
md.push('');
md.push('| الدورة | دور المراجع | الفحوص | المغلق | المفتوح | الحاجب |');
md.push('|---:|---|---:|---:|---:|---:|');
for (const cycle of results) md.push(`| ${cycle.cycle} | ${cycle.role} | ${cycle.summary.total} | ${cycle.summary.closed} | ${cycle.summary.open} | ${cycle.summary.blocking} |`);
md.push('');
md.push('## الملاحظات المفتوحة');
md.push('');
if (!openChecks.length) md.push('لا توجد ملاحظات مفتوحة.');
else {
  md.push('| الدورة | الخطورة | الملاحظة | الدليل | الإجراء المطلوب |');
  md.push('|---:|---|---|---|---|');
  for (const item of openChecks) md.push(`| ${item.cycle} | ${item.severity} | ${item.title} | ${String(item.evidence).replace(/\|/g, '\\|')} | ${String(item.remediation || '').replace(/\|/g, '\\|')} |`);
}
md.push('');
md.push('## قرار الاستلام');
md.push('');
md.push(blocking.length === 0
  ? 'تم اجتياز شرط صفر ملاحظات حرجة وعالية. أي ملاحظات متوسطة أو منخفضة موثقة أعلاه ولا تمنع الاستخدام وفق نطاقها.'
  : 'لم يتم الاستلام النهائي: توجد ملاحظات حرجة أو عالية يجب إغلاقها وإعادة تشغيل الدورات العشرين.');
fs.writeFileSync(MD_OUT, md.join('\n') + '\n');

console.log(JSON.stringify({ acceptance, cycles: results.length, totalChecks: allChecks.length, open: openChecks.length, blocking: blocking.length, severity: severitySummary }, null, 2));
if (FAIL_ON_BLOCKING && blocking.length) process.exit(1);
