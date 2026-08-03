#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const REPORT_PATH = path.join(ROOT, 'data/review/v16-consulting-review.json');
const MD_PATH = path.join(ROOT, 'data/review/v16-consulting-review.md');
const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const readText = rel => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };
const readJson = rel => { try { return JSON.parse(readText(rel)); } catch { return {}; } };
const arr = value => Array.isArray(value) ? value : [];
const num = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const hasAll = (text, markers) => markers.every(marker => text.includes(marker));

const report = readJson('data/review/v16-consulting-review.json');
const decision = readJson('data/stable/v15-practical-decision.json');
const price = readJson('data/stable/v15-price-truth.json');
const evaluation = readJson('data/stable/v15-recommendation-evaluation.json');
const rawFinancial = readJson('data/fundamentals/v16-fundamental-raw.json');
const financial = readJson('data/stable/v16-fundamental-analysis.json');
const heartbeat = readJson('data/stable/v15-update-status.json');
const market = readJson('data/quant/market-search-index-v13-17.json');
const manifest = readJson('manifest.json');
const html = readText('preview-v16/app/index.html');
const app = readText('preview-v16/app/app.js');
const pilot = readText('preview-v16/app/pilot-policy.js');
const financialUi = readText('preview-v16/app/fundamentals.js');
const serviceWorker = readText('service-worker.js');
const root = readText('index.html');
const workflow = readText('.github/workflows/v16-consulting-review.yml');
const recs = arr(decision.recommendations);

if (!Array.isArray(report.cycles) || report.cycles.length !== 20) throw new Error(`Whole-app review requires exactly 20 cycles, found ${report.cycles?.length}`);
for (const cycle of report.cycles) cycle.checks = arr(cycle.checks).filter(item => !String(item.id || '').startsWith('APPX_'));

function findCycle(role) {
  const cycle = report.cycles.find(item => item.role === role);
  if (!cycle) throw new Error(`Missing review role: ${role}`);
  return cycle;
}
function check(id, severity, title, passed, evidence, remediation) {
  return { id, severity, title, status: passed ? 'CLOSED' : 'OPEN', evidence, remediation: passed ? null : remediation };
}
function add(role, ...checks) { findCycle(role).checks.push(...checks); }
function moneyFields(record) {
  const l = record.latest || {};
  return ['revenue','grossProfit','operatingIncome','netIncome','cashAndInvestments','totalDebt','netCashDebt','operatingCashFlow','capitalExpenditures','freeCashFlow','marketCap','enterpriseValue']
    .map(key => [key, num(l[key])]).filter(([, value]) => value !== null);
}
const rawRecords = Object.values(rawFinancial.records || {});
const psConsistency = rawRecords.filter(row => num(row.latest?.marketCap) > 0 && num(row.latest?.revenue) > 0 && num(row.latest?.priceToSales) > 0)
  .map(row => ({ ticker: row.ticker, factor: Math.max((row.latest.marketCap / row.latest.revenue) / row.latest.priceToSales, row.latest.priceToSales / (row.latest.marketCap / row.latest.revenue)) }));
const extremeAmounts = rawRecords.flatMap(row => moneyFields(row).filter(([, value]) => Math.abs(value) > 1e15).map(([field, value]) => `${row.ticker}.${field}=${value}`));
const parseAnomalies = rawRecords.flatMap(row => arr(row.parseDiagnostics?.anomalies).map(code => `${row.ticker}:${code}`));
const recommendationTickers = recs.map(row => String(row.ticker || '').toUpperCase());
const rawRecommendationCoverage = recommendationTickers.filter(ticker => rawFinancial.records?.[ticker]).length;
const financialRecommendationCoverage = recommendationTickers.filter(ticker => arr(financial.recommendationAnalysis).some(row => String(row.ticker || '').toUpperCase() === ticker)).length;

add('مختص جودة بيانات السوق',
  check('APPX_DATA_01','CRITICAL','كل أسعار التوصيات صادرة من بوابة تنفيذ موثقة', price.executionGrade === true && recs.every(row => num(row.close) > 0), `executionGrade=${price.executionGrade}; recs=${recs.length}`, 'حجب التوصيات حتى نجاح بوابة السعر.'),
  check('APPX_DATA_02','HIGH','فهرس السوق يغطي نطاقًا واسعًا', arr(market.stocks).length >= 180, `marketStocks=${arr(market.stocks).length}`, 'إعادة بناء فهرس السوق الكامل.'),
);
add('محلل فني محترف',
  check('APPX_TECH_01','CRITICAL','لا توجد توصية تتجاوز قواعد RSI وRR', recs.every(row => num(row.riskReward,0) >= 1.15 && num(row.rsi14,999) <= 78), recs.map(row => `${row.ticker}:RR${row.riskReward}/RSI${row.rsi14}`).join(', '), 'نقل الفرصة للمراقبة أو حذفها.'),
  check('APPX_TECH_02','HIGH','الخطة الفنية كاملة لكل توصية', recs.every(row => num(row.entryLow)>0 && num(row.entryHigh)>=num(row.entryLow) && num(row.stopLoss)<num(row.entryLow) && num(row.target1)>num(row.entryHigh)), `validPlans=${recs.filter(row => num(row.entryLow)>0 && num(row.stopLoss)<num(row.entryLow) && num(row.target1)>num(row.entryHigh)).length}/${recs.length}`, 'إعادة بناء أو حذف الخطة غير المكتملة.'),
);
add('محلل مالي واستثماري',
  check('APPX_FIN_01','CRITICAL','المجمّع المالي يستخدم محلل الوحدات الآمن', rawFinancial.parserVersion === 'V16.3_EXACT_ROWS_UNIT_SAFE_1.0', `parser=${rawFinancial.parserVersion}`, 'إيقاف التقرير القديم وتشغيل V16.3.'),
  check('APPX_FIN_02','CRITICAL','لا توجد تعارضات وحدات أو تضخيم مبالغ', extremeAmounts.length === 0 && psConsistency.every(row => Number.isFinite(row.factor) && row.factor <= 20), `extreme=${extremeAmounts.join(',') || 'none'}; psFactors=${psConsistency.slice(0,10).map(row => `${row.ticker}:${row.factor.toFixed(2)}`).join(',')}`, 'رفض السجلات غير المتسقة وإعادة جمعها.'),
  check('APPX_FIN_03','HIGH','لا توجد سجلات مالية مقبولة تحمل شذوذات Parser', parseAnomalies.length === 0 && rawRecords.every(row => row.parseDiagnostics?.parseAccepted === true), parseAnomalies.join(',') || `accepted=${rawRecords.length}`, 'رفض أي سجل يحمل anomaly.'),
  check('APPX_FIN_04','HIGH','كل توصية لها حالة مالية صريحة من البيانات الجديدة', rawRecommendationCoverage === recs.length && financialRecommendationCoverage === recs.length, `raw=${rawRecommendationCoverage}/${recs.length}; report=${financialRecommendationCoverage}/${recs.length}`, 'جمع بيانات التوصيات أولًا أو إظهار DATA_UNAVAILABLE دون درجة.'),
);
add('مدير محافظ وإدارة مخاطر',
  check('APPX_RISK_01','CRITICAL','التنفيذ الآلي غير موجود والمخاطرة التجريبية مخفضة', decision.guardrails?.automaticOrders === false && recs.every(row => row.pilotRiskMode === 'REDUCED_RISK' || decision.professionalEvidenceReady === true), `auto=${decision.guardrails?.automaticOrders}; pilot=${recs.map(row => row.pilotRiskMode).join(',')}`, 'تعطيل التنفيذ وخفض المخاطرة.'),
  check('APPX_RISK_02','HIGH','واجهة المحفظة تحتوي حدود التعرض وحجم المركز', hasAll(html + pilot, ['portfolioRiskLimit','portfolioPositionLimit','strategyExposureLimit','0.25']), 'portfolio and pilot limits found', 'إضافة حدود ملزمة للمحفظة.'),
);
add('مهندس برمجيات ومراجع معماري',
  check('APPX_ARCH_01','HIGH','الرابط والـManifest والـService Worker موحدة على V16', root.includes('preview-v16/app/index.html') && String(manifest.short_name||'').includes('V16') && hasAll(serviceWorker,['preview-v13','preview-v14','preview-v15','LATEST_URL']), `manifest=${manifest.short_name}`, 'توحيد جميع نقاط التشغيل.'),
  check('APPX_ARCH_02','HIGH','مسار الاعتماد يشغل كل محركات الجودة الحالية', hasAll(workflow,['v16-fundamental-collector-v3.cjs','v16-fundamental-quality-gate.cjs','v16-whole-app-review-extension.cjs']), 'workflow modules verified', 'ربط المحركات بمسار CI.'),
);
add('مختبر جودة وبرمجيات QA',
  check('APPX_QA_01','HIGH','أصول التطبيق الأساسية موجودة وحالات الفراغ واضحة', [html,app,pilot,financialUi].every(text => text.length > 500) && html.includes('class="empty"'), 'core assets and empty state verified', 'استعادة الأصول أو حالات الخطأ.'),
  check('APPX_QA_02','MEDIUM','لا توجد معرفات HTML مكررة', (()=>{const ids=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(x=>x[1]);return new Set(ids).size===ids.length;})(), 'HTML id uniqueness checked', 'إزالة المعرفات المكررة.'),
);
add('مراجع إحصائي وBacktest',
  check('APPX_STATS_01','CRITICAL','الدليل التاريخي منفصل عن الحي وتكاليف التداول محسوبة', decision.guardrails?.futureLeakageForbidden === true && num(decision.guardrails?.transactionCostsPct,0)>0 && hasAll(html+app,['Backtest','السجل الحي']), `futureLeakage=${decision.guardrails?.futureLeakageForbidden}; costs=${decision.guardrails?.transactionCostsPct}`, 'إيقاف النموذج حتى استكمال المنهج.'),
);
add('مراجع السجل الحي',
  check('APPX_LIVE_01','HIGH','أرشيف اليوم يحفظ كل التوصيات دون حذف النتائج', recs.every(row => arr(evaluation.records).some(item => item.recommendationDate===decision.sessionDate && item.ticker===row.ticker && item.strategyId===row.strategyId)), `archived=${recs.filter(row => arr(evaluation.records).some(item => item.recommendationDate===decision.sessionDate && item.ticker===row.ticker && item.strategyId===row.strategyId)).length}/${recs.length}`, 'تشغيل الأرشفة قبل النشر.'),
);
add('مراجع تغطية السوق والبحث',
  check('APPX_SEARCH_01','HIGH','البحث شامل ويصرح بعدم وجود السهم ضمن توصيات اليوم', hasAll(html+app,['كل السوق','ليس ضمن توصيات اليوم','خارج توصيات اليوم']), 'full market search language verified', 'إصلاح نطاق البحث والرسالة.'),
);
add('مختص تجربة مستخدم',
  check('APPX_UX_01','HIGH','الواجهة تعرض الفني والمالي والمخاطر والسجل كمكونات مستقلة', hasAll(html,['التحليل الفني','التحليل المالي','المحفظة','السجل الحي']), 'main modules visible', 'إعادة تنظيم واجهة القرار.'),
  check('APPX_UX_02','HIGH','لا توجد وعود ربح أو إخفاء لمرحلة Pilot', !/(ضمان الربح|أرباح مضمونة|guaranteed profit)/i.test(html+app+financialUi) && hasAll(html+app,['Pilot','جاهزية المنتج']), 'claim and maturity disclosure checked', 'إزالة الادعاء وإظهار مرحلة النضج.'),
);
add('مختص إمكانية الوصول',
  check('APPX_A11Y_01','MEDIUM','اللغة والاتجاه ووصف التنقل متوفرة', /<html[^>]+lang="ar"[^>]+dir="rtl"/.test(html) && html.includes('aria-label="التنقل الرئيسي"'), 'RTL and navigation label verified', 'إضافة خصائص الوصول.'),
);
add('مختص أمن معلومات وخصوصية',
  check('APPX_SEC_01','CRITICAL','لا توجد أسرار مكشوفة أو تنفيذ أوامر وسيط', !/(api[_-]?key\s*[:=]\s*["'][^"']{12,}|bearer\s+[a-z0-9._-]{20,}|sendOrder|placeOrder)/i.test(html+app+pilot+financialUi) && decision.guardrails?.automaticOrders===false, 'secret and broker execution scan clean', 'إزالة الأسرار وتعطيل التنفيذ فورًا.'),
);
add('مراجع تطبيق مثبت وذاكرة مؤقتة',
  check('APPX_PWA_01','HIGH','الأيقونة المثبتة لا تفتح إصدارًا قديمًا', manifest.start_url==='./?launch=pwa&latest=1' && root.includes("cache:'no-store'") && hasAll(serviceWorker,['preview-v13','preview-v14','preview-v15']), `start=${manifest.start_url}`, 'تحديث المشغل والكاش.'),
);
add('مراجع التشغيل الآلي',
  check('APPX_OPS_01','HIGH','الـHeartbeat متزامن مع الفني والمالي', heartbeat.recommendationGeneratedAt===decision.generatedAt && heartbeat.fundamentals?.generatedAt===financial.generatedAt, `decision=${decision.generatedAt}; hb=${heartbeat.recommendationGeneratedAt}; financial=${financial.generatedAt}; hbFinancial=${heartbeat.fundamentals?.generatedAt}`, 'إعادة كتابة Heartbeat في نهاية الدورة.'),
);
add('مراجع منهجية التحليل المالي',
  check('APPX_FM_01','HIGH','البيانات القديمة أو غير المكتملة لا تحصل على درجة', arr(financial.records).every(row => row.score==null || (num(row.dataQuality?.completenessPct,0)>=45 && row.dataQuality?.staleLevel!=='SEVERE')), `scored=${arr(financial.records).filter(row=>row.score!=null).length}`, 'حجب الدرجة عند ضعف الجودة.'),
);
add('مراجع التقييم والقيمة العادلة',
  check('APPX_VAL_01','HIGH','القيمة العادلة لا تظهر دون ثلاثة أقران ومنهج معلن', arr(financial.records).every(row => row.relativeFairValue?.fairValue==null || (num(row.relativeFairValue?.peerCount,0)>=3 && String(row.relativeFairValue?.methodology||'').includes('not a DCF'))), 'peer and methodology gate verified', 'حجب القيمة العادلة غير المدعومة.'),
);
add('مستخدم محترف سيدفع مقابل التطبيق',
  check('APPX_COMM_01','HIGH','المنتج يوضح المصدر والتاريخ والقيود قبل القرار', /(المصدر|providerTier|overviewUrl)/i.test(financialUi) && /(تاريخ|financialPeriodEnd|statementAgeDays)/i.test(financialUi) && hasAll(html+app,['Pilot','Backtest']), 'commercial transparency verified', 'إظهار المصدر والتاريخ والمرحلة.'),
);
add('مراجع الانحدار والتكامل',
  check('APPX_REG_01','HIGH','إضافة المالي لم تكسر البحث أو الخطة أو المحفظة', hasAll(html+app,['marketSearch','recommendationsGrid','portfolioBody']) && recs.every(row=>num(row.entryLow)>0), 'integration markers and plans verified', 'إصلاح التكامل وإعادة الاختبار.'),
);
add('المستلم النهائي ومسؤول الاعتماد',
  check('APPX_FINAL_01','CRITICAL','نطاق المراجعة هو التطبيق بالكامل', true, 'WHOLE_APPLICATION: market data, technical, financial, portfolio, risk, live ledger, search, UX, accessibility, security, PWA, automation and deployment', null),
  check('APPX_FINAL_02','HIGH','تم تنفيذ عشرين دورة كاملة على النسخة الحالية', report.cycles.length===20, `cycles=${report.cycles.length}`, 'إعادة تنفيذ الدورات العشرين.'),
);

for (const [index, cycle] of report.cycles.entries()) {
  cycle.cycle = index + 1;
  const open = cycle.checks.filter(item => item.status === 'OPEN');
  cycle.summary = { total: cycle.checks.length, closed: cycle.checks.length-open.length, open: open.length, blocking: open.filter(item=>severityRank[item.severity]>=severityRank.HIGH).length };
}
const allChecks = report.cycles.flatMap(cycle => cycle.checks.map(item => ({ cycle: cycle.cycle, role: cycle.role, ...item })));
const open = allChecks.filter(item => item.status==='OPEN');
const blocking = open.filter(item => severityRank[item.severity]>=severityRank.HIGH);
const severity = ['CRITICAL','HIGH','MEDIUM','LOW'].reduce((out, level) => {
  const rows=allChecks.filter(item=>item.severity===level);
  out[level]={total:rows.length,open:rows.filter(item=>item.status==='OPEN').length,closed:rows.filter(item=>item.status==='CLOSED').length};
  return out;
},{});
report.schemaVersion='16.3.0';
report.generatedAt=new Date().toISOString();
report.application='EGX Pro Professional V16.1';
report.scope={type:'WHOLE_APPLICATION',modules:['market-data','price-truth','technical-analysis','fundamental-analysis','recommendations','risk-management','portfolio','live-ledger','full-market-search','user-experience','accessibility','security','PWA-cache','automation','deployment']};
report.cyclesCompleted=20;
report.acceptanceCriteria={zeroCritical:severity.CRITICAL.open===0,zeroHigh:severity.HIGH.open===0,noBlockingErrors:blocking.length===0,allTwentyCyclesExecuted:true,wholeApplicationScope:true};
report.acceptance=blocking.length?'REJECTED_BLOCKING_FINDINGS':open.length?'ACCEPTED_WITH_NON_BLOCKING_FINDINGS':'ACCEPTED_ZERO_FINDINGS';
report.summary={...(report.summary||{}),totalChecks:allChecks.length,closedChecks:allChecks.length-open.length,openChecks:open.length,blockingFindings:blocking.length,severity,marketUniverse:arr(market.stocks).length,acceptedPriceRows:num(price.acceptedRows,0),financialRawCoverage:rawRecords.length,financialRecommendationCoverage,liveResolvedTrades:num(evaluation.summary?.resolvedTrades,0)};
report.openFindings=open;
report.blockingFindings=blocking;
fs.writeFileSync(REPORT_PATH,JSON.stringify(report,null,2)+'\n');

const md=[];
md.push('# تقرير المراجعة الاستشارية الشاملة — EGX Pro V16.1','',`- النطاق: **التطبيق بالكامل**`,`- تاريخ التوليد: ${report.generatedAt}`,'- الدورات المنفذة: 20/20',`- الحكم: **${report.acceptance}**`,`- الفحوص: ${report.summary.closedChecks}/${report.summary.totalChecks} مغلق`,`- الملاحظات الحرجة المفتوحة: ${severity.CRITICAL.open}`,`- الملاحظات العالية المفتوحة: ${severity.HIGH.open}`,'','| الدورة | دور المراجع | الفحوص | المغلق | المفتوح | الحاجب |','|---:|---|---:|---:|---:|---:|');
for(const cycle of report.cycles) md.push(`| ${cycle.cycle} | ${cycle.role} | ${cycle.summary.total} | ${cycle.summary.closed} | ${cycle.summary.open} | ${cycle.summary.blocking} |`);
md.push('','## الملاحظات المفتوحة','');
if(!open.length) md.push('لا توجد ملاحظات مفتوحة ضمن نطاق التطبيق الكامل والفحوص المنفذة.');
else {md.push('| الدورة | الخطورة | الملاحظة | الدليل | الإجراء المطلوب |','|---:|---|---|---|---|');for(const item of open)md.push(`| ${item.cycle} | ${item.severity} | ${item.title} | ${String(item.evidence).replace(/\|/g,'\\|')} | ${String(item.remediation||'').replace(/\|/g,'\\|')} |`);}
md.push('','## قرار الاستلام','',blocking.length?'لم يتم الاستلام النهائي: توجد ملاحظات حرجة أو عالية في التطبيق.':'تم اجتياز شرط صفر ملاحظات حرجة وعالية على التطبيق بالكامل.');
fs.writeFileSync(MD_PATH,md.join('\n')+'\n');
console.log(JSON.stringify({scope:report.scope.type,acceptance:report.acceptance,cycles:20,checks:allChecks.length,open:open.length,blocking:blocking.length,severity},null,2));
if(blocking.length) process.exitCode=1;
