#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const POLICY_PATH = path.join(ROOT, 'data', 'v13-3-daily-production-policy.json');
const OUTPUT_DIR = path.join(ROOT, 'preview-v13', 'data');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'v13-3-daily-production.json');
const STATE_PATH = path.join(OUTPUT_DIR, 'v13-3-pipeline-state.json');

function readJson(relativePath, required = false) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    if (required) throw new Error(`Missing required JSON: ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    if (required) throw new Error(`Invalid JSON ${relativePath}: ${error.message}`);
    return null;
  }
}

function writeJson(fullPath, value) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const temp = `${fullPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, fullPath);
}

function dateOnly(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function cairoParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const get = (type) => parts.find((item) => item.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    hour: Number(get('hour')),
    minute: Number(get('minute'))
  };
}

function toUtcDate(dateText) {
  const [year, month, day] = String(dateText).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function jsWeekday(dateText) {
  return toUtcDate(dateText).getUTCDay();
}

function isTradingDate(dateText, policy) {
  return policy.market.tradingDayNumbersJs.includes(jsWeekday(dateText));
}

function previousTradingDate(dateText, policy) {
  const date = toUtcDate(dateText);
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (!isTradingDate(formatUtcDate(date), policy));
  return formatUtcDate(date);
}

function expectedLatestSession(cairo, policy) {
  const isTradingDay = policy.market.tradingDays.includes(cairo.weekday);
  if (isTradingDay && cairo.hour >= Number(policy.market.expectedPostSessionHourCairo || 15)) {
    return cairo.date;
  }
  return previousTradingDate(cairo.date, policy);
}

function tradingDayLag(fromDate, toDate, policy) {
  if (!fromDate || !toDate) return null;
  if (fromDate === toDate) return 0;
  const from = toUtcDate(fromDate);
  const to = toUtcDate(toDate);
  const direction = from < to ? 1 : -1;
  let cursor = new Date(from);
  let count = 0;
  let guard = 0;
  while (formatUtcDate(cursor) !== formatUtcDate(to) && guard < 2000) {
    cursor.setUTCDate(cursor.getUTCDate() + direction);
    const cursorText = formatUtcDate(cursor);
    if (isTradingDate(cursorText, policy)) count += direction;
    guard += 1;
  }
  return count;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function generatedAtOf(doc) {
  return doc?.generatedAt || doc?.updatedAt || doc?.completedAt || doc?.startedAt || null;
}

function sessionOf(doc) {
  return dateOnly(
    doc?.sessionId ||
    doc?.latestMarketSession ||
    doc?.lastProcessedSession ||
    doc?.marketSession ||
    doc?.coverageAfter?.latestMarketSession ||
    doc?.summaryAfter?.latestMarketSession
  );
}

function hoursOld(value, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, (now.getTime() - date.getTime()) / 3600000);
}

function summarizeSourceFile(relativePath, now) {
  const doc = readJson(relativePath, false);
  if (!doc) return { path: relativePath, exists: false, status: 'missing', generatedAt: null, session: null };
  const generatedAt = generatedAtOf(doc);
  const ageHours = hoursOld(generatedAt, now);
  let status = 'available';
  const explicitStatus = String(doc.status || doc.health || doc.overallStatus || '').toLowerCase();
  if (/fail|error|critical|down/.test(explicitStatus)) status = 'degraded';
  return {
    path: relativePath,
    exists: true,
    status,
    generatedAt,
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    session: sessionOf(doc),
    explicitStatus: explicitStatus || null
  };
}

function rejectionSummary(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    const reasons = safeArray(candidate.failedReasons);
    if (!reasons.length) {
      map.set('سبب غير مصنف', (map.get('سبب غير مصنف') || 0) + 1);
      continue;
    }
    for (const reason of reasons) {
      const key = String(reason).trim() || 'سبب غير مصنف';
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 20);
}

function uniqueMeasuredSessions(ledger) {
  const sessions = new Set();
  for (const trade of safeArray(ledger?.trades)) {
    const value = dateOnly(trade.signalSession || trade.createdSession || trade.entrySession || trade.exitSession);
    if (value) sessions.add(value);
  }
  return sessions.size;
}

function stage(name, labelAr, ok, detail, critical = true) {
  return { name, labelAr, status: ok ? 'passed' : (critical ? 'blocked' : 'warning'), ok, critical, detail };
}

function main() {
  const now = new Date();
  const policy = readJson('data/v13-3-daily-production-policy.json', true);
  const cairo = cairoParts(now);
  const forceNonTradingDay = String(process.env.V13_3_FORCE_NON_TRADING_DAY || 'false') === 'true';
  const normalTradingDay = policy.market.tradingDays.includes(cairo.weekday);
  const runDayAllowed = normalTradingDay || forceNonTradingDay;
  const expectedSession = expectedLatestSession(cairo, policy);

  const eligibility = readJson('data/history-eligibility.json', false);
  const reviewQueue = readJson('data/history-review-queue.json', false);
  const historySummary = readJson('data/history-summary.json', false);
  const decision = readJson('preview-v12/data/v13-2-decision.json', false);
  const metrics = readJson('preview-v12/data/v13-2-paper-metrics.json', false);
  const ledger = readJson('preview-v12/data/v13-2-paper-ledger.json', false);
  const ranking = readJson('data/final-opportunity-ranking.json', false);

  const marketSession =
    dateOnly(decision?.sessionId) ||
    dateOnly(eligibility?.latestMarketSession) ||
    dateOnly(historySummary?.latestMarketSession) ||
    sessionOf(ranking);

  const lagTradingDays = tradingDayLag(marketSession, expectedSession, policy);
  const decisionFresh =
    marketSession !== null &&
    lagTradingDays !== null &&
    lagTradingDays >= 0 &&
    lagTradingDays <= number(policy.freshness.maximumDecisionLagTradingDays, 0);
  const paperFresh =
    marketSession !== null &&
    lagTradingDays !== null &&
    lagTradingDays >= 0 &&
    lagTradingDays <= number(policy.freshness.maximumPaperLagTradingDays, 1);

  const eligibilityPresent = Boolean(eligibility && Array.isArray(eligibility.items));
  const decisionPresent = Boolean(decision && decision.decision);
  const metricsPresent = Boolean(metrics);
  const ledgerPresent = Boolean(ledger && Array.isArray(ledger.trades));
  const rankingPresent = Boolean(ranking);

  const stages = [
    stage('calendar', 'تقويم السوق', runDayAllowed, runDayAllowed ? `${cairo.weekday} — مسموح` : `${cairo.weekday} — السوق مغلق`, false),
    stage('marketData', 'بيانات السوق', rankingPresent && paperFresh, rankingPresent ? `جلسة ${marketSession || 'غير معروفة'}، التأخر ${lagTradingDays ?? '؟'} يوم تداول` : 'ملف ترتيب الفرص غير متاح'),
    stage('history', 'التاريخ', Boolean(historySummary), historySummary ? `${number(historySummary.symbolsComplete100 || historySummary.counts?.sessions100Count)} سهم مكتمل` : 'ملخص التاريخ غير متاح'),
    stage('eligibility', 'الأهلية', eligibilityPresent, eligibilityPresent ? `${number(eligibility.counts?.decisionEligible)} مؤهل للقرار` : 'ملف الأهلية غير متاح'),
    stage('decision', 'محرك القرار', decisionPresent && paperFresh, decisionPresent ? `${decision.decision?.code || 'UNKNOWN'} — جلسة ${decision.sessionId || '؟'}` : 'ملف قرار V13.2 غير متاح'),
    stage('paper', 'التداول الورقي', metricsPresent && ledgerPresent, metricsPresent && ledgerPresent ? `${number(metrics.totalTrades)} صفقة مسجلة` : 'دفتر أو مؤشرات التداول الورقي غير متاحة')
  ];

  const criticalFailures = stages.filter((item) => item.critical && !item.ok);
  const calendarBlocked = !runDayAllowed && !forceNonTradingDay;
  const failClosed = criticalFailures.length > 0 || calendarBlocked;

  const rawDecisionCandidates = safeArray(decision?.topDecisionCandidates);
  const rawPaperCandidates = safeArray(decision?.topPaperCandidates);
  const rawWatchOnly = safeArray(decision?.watchOnly);

  const blockedTickers = new Set(safeArray(policy.safety.explicitlyBlockedTickers).map((value) => String(value).toUpperCase()));
  const prohibitedStatuses = new Set(safeArray(policy.safety.prohibitedDecisionStatuses));

  const passesSafety = (candidate, paper = false) => {
    const ticker = String(candidate?.ticker || '').toUpperCase();
    const status = candidate?.eligibility?.status;
    if (!ticker || blockedTickers.has(ticker) || prohibitedStatuses.has(status)) return false;
    return paper ? candidate?.paperPass === true : candidate?.decisionPass === true;
  };

  const decisionCandidates = failClosed || !decisionFresh
    ? []
    : rawDecisionCandidates.filter((item) => passesSafety(item, false)).slice(0, number(policy.display.topDecisionCandidates, 10));
  const paperCandidates = failClosed || !paperFresh
    ? []
    : rawPaperCandidates.filter((item) => passesSafety(item, true)).slice(0, number(policy.display.topPaperCandidates, 15));
  const watchOnly = rawWatchOnly.slice(0, number(policy.display.topWatchOnly, 30));
  const reviews = safeArray(reviewQueue?.items).slice(0, number(policy.display.topReviewQueue, 30));

  const measuredSessions = uniqueMeasuredSessions(ledger);
  const promotionChecks = [
    {
      id: 'measuredSessions',
      labelAr: 'جلسات القياس',
      value: measuredSessions,
      target: number(policy.promotionGate.minimumMeasuredSessions, 20),
      pass: measuredSessions >= number(policy.promotionGate.minimumMeasuredSessions, 20)
    },
    {
      id: 'closedTrades',
      labelAr: 'الصفقات المغلقة',
      value: number(metrics?.closedTrades),
      target: number(policy.promotionGate.minimumClosedTrades, 50),
      pass: number(metrics?.closedTrades) >= number(policy.promotionGate.minimumClosedTrades, 50)
    },
    {
      id: 'profitFactor',
      labelAr: 'Profit Factor',
      value: number(metrics?.profitFactor),
      target: number(policy.promotionGate.minimumProfitFactor, 1.2),
      pass: number(metrics?.profitFactor) >= number(policy.promotionGate.minimumProfitFactor, 1.2)
    },
    {
      id: 'averageR',
      labelAr: 'متوسط R',
      value: number(metrics?.averageR),
      target: number(policy.promotionGate.minimumAverageR, 0.01),
      pass: number(metrics?.averageR) >= number(policy.promotionGate.minimumAverageR, 0.01)
    },
    {
      id: 'maxDrawdown',
      labelAr: 'أقصى تراجع',
      value: number(metrics?.maxDrawdownPct),
      target: number(policy.promotionGate.maximumDrawdownPct, 10),
      pass: number(metrics?.maxDrawdownPct) <= number(policy.promotionGate.maximumDrawdownPct, 10)
    },
    {
      id: 'independentConfidence',
      labelAr: 'أسهم بثقة مستقلة عالية',
      value: number(eligibility?.counts?.highConfidenceEligible),
      target: number(policy.promotionGate.minimumIndependentHighConfidenceSymbols, 5),
      pass: number(eligibility?.counts?.highConfidenceEligible) >= number(policy.promotionGate.minimumIndependentHighConfidenceSymbols, 5)
    }
  ];
  const promotionPassed = promotionChecks.every((item) => item.pass);

  let statusCode = 'WATCH_ONLY';
  let statusLabelAr = 'مراقبة فقط';
  let statusReasonAr = 'لا توجد مرشحات اجتازت جميع البوابات حاليًا.';
  if (calendarBlocked) {
    statusCode = 'MARKET_CLOSED';
    statusLabelAr = 'السوق مغلق';
    statusReasonAr = 'التشغيل الآلي مخصص للأحد إلى الخميس.';
  } else if (criticalFailures.length) {
    statusCode = 'FAIL_CLOSED';
    statusLabelAr = 'مغلق لحماية البيانات';
    statusReasonAr = criticalFailures.map((item) => item.detail).join(' — ');
  } else if (paperCandidates.length > 0) {
    statusCode = 'PAPER_ACTIVE';
    statusLabelAr = 'تداول ورقي نشط';
    statusReasonAr = `${paperCandidates.length} مرشحًا اجتاز بوابات التداول الورقي. التنفيذ الحقيقي مغلق.`;
  } else if (decisionCandidates.length > 0) {
    statusCode = 'DECISION_WATCH';
    statusLabelAr = 'مرشحو قرار للمراقبة';
    statusReasonAr = `${decisionCandidates.length} مرشحًا اجتاز بوابات القرار، دون تنفيذ حقيقي.`;
  }

  const sourceFiles = safeArray(policy.sourceHealthCandidates).map((item) => summarizeSourceFile(item, now));
  const availableSources = sourceFiles.filter((item) => item.exists);
  const degradedSources = sourceFiles.filter((item) => item.exists && item.status === 'degraded');

  const output = {
    schemaVersion: '13.3.0',
    generatedAt: now.toISOString(),
    mode: 'DAILY_PRODUCTION_UNIFIED_DECISION_CENTER',
    stableApplicationTouched: false,
    liveExecutionEnabled: false,
    failClosed,
    status: {
      code: statusCode,
      labelAr: statusLabelAr,
      reasonAr: statusReasonAr
    },
    schedule: {
      timezone: policy.market.timezone,
      tradingDays: policy.market.tradingDays,
      weekendDays: policy.market.weekendDays,
      cronUtc: policy.market.scheduledCronUtc,
      currentCairoDate: cairo.date,
      currentCairoWeekday: cairo.weekday,
      runDayAllowed,
      forceNonTradingDay
    },
    market: {
      latestAvailableSession: marketSession,
      expectedLatestSession: expectedSession,
      lagTradingDays,
      decisionFresh,
      paperFresh
    },
    pipeline: {
      stages,
      passed: criticalFailures.length === 0,
      criticalFailures: criticalFailures.map((item) => ({ name: item.name, detail: item.detail }))
    },
    counts: {
      activeSymbols: number(eligibility?.counts?.activeSymbols),
      numericComplete100: number(eligibility?.counts?.numericComplete100),
      decisionEligibleHistory: number(eligibility?.counts?.decisionEligible),
      paperEligibleHistory: number(eligibility?.counts?.paperTradingEligible),
      independentHighConfidenceHistory: number(eligibility?.counts?.highConfidenceEligible),
      reviewQueue: number(reviewQueue?.total, reviews.length),
      decisionCandidates: decisionCandidates.length,
      paperCandidates: paperCandidates.length,
      watchOnly: rawWatchOnly.length,
      closedTrades: number(metrics?.closedTrades),
      openTrades: number(metrics?.openTrades),
      pendingTrades: number(metrics?.pendingTrades)
    },
    today: {
      decisionCandidates,
      paperCandidates,
      watchOnly,
      rejectionSummary: rejectionSummary(rawWatchOnly)
    },
    paper: {
      metrics: metrics || {},
      recentTrades: safeArray(ledger?.trades)
        .slice()
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
        .slice(0, number(policy.display.recentTrades, 30)),
      assumptions: ledger?.assumptions || {},
      activationSession: ledger?.activationSession || null,
      lastProcessedSession: ledger?.lastProcessedSession || null
    },
    reviewQueue: {
      total: number(reviewQueue?.total, reviews.length),
      items: reviews
    },
    sourceHealth: {
      availableCount: availableSources.length,
      degradedCount: degradedSources.length,
      files: sourceFiles
    },
    promotionGate: {
      passed: promotionPassed,
      checks: promotionChecks,
      noteAr: promotionPassed
        ? 'استوفى سجل القياس الحدود الرقمية، لكن النقل إلى التطبيق المستقر يظل قرار مراجعة يدوية.'
        : 'لم يكتمل سجل القياس المطلوب لنقل V13 إلى التطبيق المستقر.'
    },
    navigation: {
      stableApplication: '../',
      historyEligibility: '../preview-v12/history-eligibility.html',
      detailedPaperDecision: '../preview-v12/decision-paper-v13-2.html'
    },
    warnings: [
      'هذه اللوحة للتداول الورقي والقياس فقط وليست توصية شراء أو ضمانًا للعائد.',
      'التنفيذ الحقيقي مغلق دائمًا في V13.3.',
      'الجمعة والسبت يومَا عطلة، والتشغيل المجدول من الأحد إلى الخميس.',
      'عند قدم البيانات أو فقد ملف حرج، تُفرغ المرشحات تلقائيًا بدل استخدام بيانات غير آمنة.'
    ]
  };

  const state = {
    schemaVersion: '13.3.0',
    generatedAt: output.generatedAt,
    status: output.status,
    latestAvailableSession: marketSession,
    expectedLatestSession: expectedSession,
    lagTradingDays,
    failClosed,
    decisionCandidates: decisionCandidates.length,
    paperCandidates: paperCandidates.length,
    lastProcessedPaperSession: ledger?.lastProcessedSession || null,
    promotionPassed
  };

  writeJson(OUTPUT_PATH, output);
  writeJson(STATE_PATH, state);

  console.log(`V13.3 status: ${statusCode}`);
  console.log(`V13.3 market session: ${marketSession || 'missing'}; expected: ${expectedSession}; lag: ${lagTradingDays}`);
  console.log(`V13.3 decision candidates: ${decisionCandidates.length}`);
  console.log(`V13.3 paper candidates: ${paperCandidates.length}`);
  console.log(`V13.3 critical failures: ${criticalFailures.length}`);
}

try {
  main();
} catch (error) {
  console.error(`V13.3 production build failed: ${error.stack || error.message}`);
  process.exit(1);
}
