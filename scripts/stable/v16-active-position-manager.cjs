#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const POLICY_PATH = path.join(ROOT, 'data/stable/v16-active-position-manager-policy.json');
const DECISION_PATH = path.join(ROOT, 'data/stable/v16-main-app-current.json');
const EVAL_PATH = path.join(ROOT, 'data/stable/v15-recommendation-evaluation.json');
const MARKET_PATH = path.join(ROOT, 'data/market.json');
const LS1_PATH = path.join(ROOT, 'data/stable/v16-ls1-late-session-opportunities.json');
const OUT_PATH = path.join(ROOT, 'data/stable/v16-active-position-manager.json');

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round(v, digits = 4) {
  const n = num(v);
  return n === null ? null : Number(n.toFixed(digits));
}
function tickerOf(row) {
  return String(row?.ticker || row?.symbol || '').trim().toUpperCase();
}
function dateOnly(v) {
  return (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
}
function percentFrom(value, base) {
  return value > 0 && base > 0 ? (value / base - 1) * 100 : null;
}
function action(code, labelAr, tone, reasonAr) {
  return { code, labelAr, tone, reasonAr };
}
function cairoStamp() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date());
}

const policy = readJson(POLICY_PATH);
const decision = readJson(DECISION_PATH);
const evaluation = readJson(EVAL_PATH);
const market = readJson(MARKET_PATH);
const ls1 = readJson(LS1_PATH);

const signalDate = dateOnly(decision.sessionDate || decision.expectedLatestSession);
const currentRecommendations = Array.isArray(decision.recommendations) ? decision.recommendations : [];
const records = Array.isArray(evaluation.records) ? evaluation.records : [];
const marketRows = Array.isArray(market.rows) ? market.rows : [];
const marketMap = new Map(marketRows.map(row => [tickerOf(row), row]));
const ls1Rows = [
  ...(Array.isArray(ls1.signals) ? ls1.signals : []),
  ...(Array.isArray(ls1.watchTop) ? ls1.watchTop : [])
];
const ls1Map = new Map(ls1Rows.map(row => [tickerOf(row), row]));

const targetStatuses = new Set(['TARGET_HIT']);
const stopStatuses = new Set(['STOP_HIT', 'STOP_HIT_AMBIGUOUS_CONSERVATIVE']);
const closedStatuses = new Set([
  'TARGET_HIT', 'STOP_HIT', 'STOP_HIT_AMBIGUOUS_CONSERVATIVE',
  'EXPIRED_POSITIVE', 'EXPIRED_NEGATIVE', 'EXPIRED_FLAT',
  'CANCELLED_GAP_UP', 'CANCELLED_GAP_DOWN',
  'NOT_ENTERED_ABOVE_ZONE', 'NOT_ENTERED_BELOW_ZONE'
]);

function recordsFor(ticker) {
  return records
    .filter(r => tickerOf(r) === ticker)
    .filter(r => !signalDate || dateOnly(r.recommendationDate) <= signalDate)
    .sort((a, b) => {
      const ad = String(a.recommendationDate || '');
      const bd = String(b.recommendationDate || '');
      if (ad !== bd) return bd.localeCompare(ad);
      return String(b.evaluatedAt || '').localeCompare(String(a.evaluatedAt || ''));
    });
}

function cycleContext(ticker) {
  const all = recordsFor(ticker);
  const prior = all.filter(r => dateOnly(r.recommendationDate) !== signalDate);
  const latestPrior = prior[0] || null;
  const occurrences = new Set(all.map(r => dateOnly(r.recommendationDate)).filter(Boolean)).size;
  const priorTargets = prior.filter(r => targetStatuses.has(String(r.evaluationStatus || ''))).length;
  const priorStops = prior.filter(r => stopStatuses.has(String(r.evaluationStatus || ''))).length;
  const latestStatus = String(latestPrior?.evaluationStatus || '');

  let state = 'NEW_CYCLE';
  let stateAr = 'دورة توصية جديدة';
  if (latestPrior && targetStatuses.has(latestStatus)) {
    state = 'PREVIOUS_TARGET_CLOSED_NEW_CYCLE';
    stateAr = 'الهدف السابق تحقق — التوصية الحالية دورة جديدة';
  } else if (latestPrior && stopStatuses.has(latestStatus)) {
    state = 'PREVIOUS_STOP_CLOSED_NEW_CYCLE';
    stateAr = 'الصفقة السابقة أغلقت على وقف — التوصية الحالية دورة جديدة';
  } else if (latestPrior && latestStatus === 'OPEN') {
    state = 'PRIOR_CYCLE_STILL_OPEN';
    stateAr = 'يوجد مركز سابق ما زال مفتوحًا حسب سجل التوصيات';
  } else if (latestPrior && closedStatuses.has(latestStatus)) {
    state = 'PREVIOUS_CYCLE_CLOSED';
    stateAr = 'الدورة السابقة مغلقة — التوصية الحالية مستقلة';
  } else if (latestPrior) {
    state = 'PRIOR_CYCLE_UNRESOLVED';
    stateAr = 'الدورة السابقة غير محسومة بالكامل';
  }

  return {
    state,
    stateAr,
    latestPrior,
    recommendationOccurrences: occurrences,
    priorTargetHits: priorTargets,
    priorStopHits: priorStops,
    repeatedRecommendation: occurrences >= 2,
    repeatAfterTarget: Boolean(latestPrior && targetStatuses.has(latestStatus)),
  };
}

function genericAction(rec, priceRow, cycle) {
  const t = policy.thresholds || {};
  const entryLow = num(rec.entryLow);
  const entryHigh = num(rec.entryHigh);
  const stopLoss = num(rec.stopLoss);
  const target1 = num(rec.target1);
  const price = num(priceRow?.price, num(priceRow?.last, num(rec.close)));
  const high = num(priceRow?.high, price);
  const sourceSession = dateOnly(priceRow?.sourceSessionDate || priceRow?.marketSessionDate);
  const sessionVerified = Boolean(signalDate && sourceSession === signalDate && price > 0);
  const hot = rec.hotMomentumRisk === true || num(rec.rsi14, 0) >= num(t.hotMomentumRsi, 80);

  if (!sessionVerified) {
    return {
      ...action('WAIT_DATA', 'انتظر تحديث البيانات', 'neutral', 'لا توجد قراءة لحظية موثقة لنفس جلسة التوصية.'),
      price, high, sessionVerified, hot
    };
  }

  if (stopLoss > 0 && price <= stopLoss) {
    return {
      ...action('SELL', 'بيع / خروج', 'danger', 'السعر الحالي عند أو أسفل وقف الخسارة المنشور للتوصية.'),
      price, high, sessionVerified, hot
    };
  }

  const targetTouched = target1 > 0 && (price >= target1 || high >= target1);
  if (targetTouched && cycle.state === 'PRIOR_CYCLE_STILL_OPEN') {
    return {
      ...action('REDUCE', 'خفف / ثبت جزءًا من الربح', 'profit', 'مركز سابق ما زال مفتوحًا والهدف المنشور تم لمسه؛ لا يتحول الهدف تلقائيًا إلى استثمار طويل.'),
      price, high, sessionVerified, hot, targetTouched
    };
  }

  const tolerance = num(t.entryTolerancePct, 0.5) / 100;
  const chase = num(t.doNotChaseAboveEntryPct, 1) / 100;
  const inZone = entryLow > 0 && entryHigh > 0 && price >= entryLow * (1 - tolerance) && price <= entryHigh * (1 + tolerance);
  const aboveZone = entryHigh > 0 && price > entryHigh * (1 + chase);
  const belowZone = entryLow > 0 && price < entryLow * (1 - tolerance);

  if (cycle.repeatAfterTarget) {
    if (inZone) {
      return {
        ...action('REENTER', 'إعادة دخول', 'reentry', 'الهدف السابق تحقق وأغلق الدورة السابقة افتراضيًا؛ السعر عاد إلى نطاق دخول التوصية الجديدة.'),
        price, high, sessionVerified, hot, inZone
      };
    }
    if (aboveZone) {
      return {
        ...action('DO_NOT_CHASE', 'لا تطارد السعر', 'warning', 'الهدف السابق تحقق، لكن السعر الحالي أعلى من نطاق إعادة الدخول الجديد.'),
        price, high, sessionVerified, hot, aboveZone
      };
    }
    return {
      ...action('WAIT_REENTRY', 'انتظر إعادة الدخول', 'watch', 'الصفقة السابقة انتهت عند الهدف؛ انتظر دخول السعر في النطاق الجديد بدل اعتبارها استثمارًا ممتدًا تلقائيًا.'),
      price, high, sessionVerified, hot, belowZone
    };
  }

  if (cycle.state === 'PRIOR_CYCLE_STILL_OPEN') {
    if (hot) {
      return {
        ...action('HOLD_TODAY', 'لا تبيع اليوم', 'hold', 'المركز السابق ما زال مفتوحًا والسهم أعيد ترشيحه، لكن الزخم ساخن؛ احتفظ دون زيادة آلية وراقب الوقف.'),
        price, high, sessionVerified, hot
      };
    }
    if (inZone) {
      return {
        ...action('HOLD', 'احتفظ', 'hold', 'المركز السابق ما زال مفتوحًا والسهم ما زال داخل خطة التوصية الحالية.'),
        price, high, sessionVerified, hot, inZone
      };
    }
    if (aboveZone) {
      return {
        ...action('HOLD_TODAY', 'لا تبيع اليوم', 'hold', 'المركز السابق ما زال مفتوحًا والسعر أعلى من نطاق إضافة جديد؛ احتفظ ولا تطارد بزيادة.'),
        price, high, sessionVerified, hot, aboveZone
      };
    }
  }

  if (aboveZone) {
    return {
      ...action('DO_NOT_CHASE', 'لا تطارد السعر', 'warning', 'السعر الحالي أعلى من نطاق الدخول المنشور؛ انتظار فرصة أفضل أكثر تحفظًا.'),
      price, high, sessionVerified, hot, aboveZone
    };
  }
  if (belowZone) {
    return {
      ...action('WAIT_ENTRY', 'انتظر منطقة الدخول', 'watch', 'السعر لم يدخل بعد نطاق التنفيذ المنشور.'),
      price, high, sessionVerified, hot, belowZone
    };
  }
  return {
    ...action('WATCH', 'مراقبة', 'watch', 'السهم داخل أو قريب من خطة التوصية؛ التنفيذ يظل مشروطًا بقواعد الافتتاح والسيولة.'),
    price, high, sessionVerified, hot, inZone
  };
}

const rows = currentRecommendations.map(rec => {
  const ticker = tickerOf(rec);
  const marketRow = marketMap.get(ticker) || null;
  const ls1Row = ls1Map.get(ticker) || null;
  const cycle = cycleContext(ticker);
  const act = genericAction(rec, marketRow, cycle);
  const prior = cycle.latestPrior;
  const priorEntry = num(prior?.entryPrice);
  const currentPrice = num(act.price);
  const priorOpenReturnPct = priorEntry > 0 && currentPrice > 0 ? round(percentFrom(currentPrice, priorEntry), 3) : null;

  return {
    ticker,
    companyNameAr: rec.companyNameAr || ticker,
    rank: num(rec.rank, null),
    signalDate,
    currentRecommendation: {
      entryLow: round(rec.entryLow),
      entryHigh: round(rec.entryHigh),
      stopLoss: round(rec.stopLoss),
      target1: round(rec.target1),
      holdingSessions: num(rec.holdingSessions, null),
      hotMomentumRisk: rec.hotMomentumRisk === true,
      rsi14: round(rec.rsi14, 2),
      portfolioWeightPct: round(rec.portfolioWeightPct, 4),
    },
    market: {
      price: round(act.price),
      open: round(marketRow?.open),
      high: round(marketRow?.high),
      low: round(marketRow?.low),
      changePct: round(marketRow?.changePct, 3),
      source: marketRow?.source || market.source || null,
      sourceSessionDate: dateOnly(marketRow?.sourceSessionDate || marketRow?.marketSessionDate),
      sessionVerified: act.sessionVerified === true,
    },
    cycle: {
      state: cycle.state,
      stateAr: cycle.stateAr,
      repeatedRecommendation: cycle.repeatedRecommendation,
      repeatAfterTarget: cycle.repeatAfterTarget,
      recommendationOccurrences: cycle.recommendationOccurrences,
      priorTargetHits: cycle.priorTargetHits,
      priorStopHits: cycle.priorStopHits,
      priorRecommendationDate: dateOnly(prior?.recommendationDate),
      priorEvaluationStatus: prior?.evaluationStatus || null,
      priorStatusAr: prior?.statusAr || null,
      priorEntryPrice: round(prior?.entryPrice),
      priorExitPrice: round(prior?.exitPrice),
      priorTarget1: round(prior?.target1),
      priorStopLoss: round(prior?.stopLoss),
      priorOpenReturnPct,
      horizonInterpretation: cycle.repeatAfterTarget
        ? 'NEW_TRADING_CYCLE_AFTER_TARGET'
        : cycle.state === 'PRIOR_CYCLE_STILL_OPEN' ? 'ACTIVE_SHORT_TERM_POSITION' : 'CURRENT_RECOMMENDATION_CYCLE',
      horizonInterpretationAr: cycle.repeatAfterTarget
        ? 'دورة تداول جديدة بعد تحقيق هدف سابق — ليست استثمارًا متوسط/طويل الأجل تلقائيًا.'
        : cycle.state === 'PRIOR_CYCLE_STILL_OPEN'
          ? 'مركز قصير الأجل ما زال مفتوحًا ويحتاج إدارة مستمرة.'
          : 'توصية حالية؛ لا توجد إشارة مستقلة تكفي لتصنيفها استثمارًا متوسط/طويل الأجل.'
    },
    action: {
      code: act.code,
      labelAr: act.labelAr,
      tone: act.tone,
      reasonAr: act.reasonAr,
      protectiveStop: round(rec.stopLoss),
      nextTarget: round(rec.target1),
      addEligibleServerSide: Boolean(
        cycle.state === 'PRIOR_CYCLE_STILL_OPEN' &&
        act.inZone === true &&
        act.hot !== true
      ),
      personalizedByLocalPortfolio: false,
      automaticOrder: false
    },
    ls1: ls1Row ? {
      state: ls1Row.state || null,
      eligible: ls1Row.eligible === true,
      score: round(ls1Row.ls1Score, 2),
      blockers: Array.isArray(ls1Row.blockers) ? ls1Row.blockers : []
    } : null
  };
});

const counts = rows.reduce((acc, row) => {
  const key = row.action.code;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const out = {
  schemaVersion: '16.9.2-active-position-manager-1',
  generatedAt: new Date().toISOString(),
  generatedAtCairo: cairoStamp(),
  signalDate,
  refreshIntervalMinutes: num(policy.refreshIntervalMinutes, 10),
  model: 'V16_9_ACTIVE_POSITION_MANAGER_POST_SELECTION',
  status: rows.length ? 'READY' : 'NO_CURRENT_RECOMMENDATIONS',
  recommendationCount: rows.length,
  actionCounts: counts,
  portfolioPersonalization: {
    browserLocalStorageKey: 'egx-v137-portfolio',
    localOnly: true,
    serverDoesNotKnowExecutedTrades: true,
    targetHitDefaultAssumption: 'PRIOR_CYCLE_CLOSED_UNLESS_LOCAL_PORTFOLIO_SAYS_STILL_HELD'
  },
  interpretation: {
    repeatedAfterTarget: 'NEW_CYCLE_NOT_AUTOMATIC_LONG_TERM',
    mediumLongTermClassificationRequiresIndependentHorizonEvidence: true
  },
  governance: {
    postSelectionOnly: true,
    changesRecommendationSelection: false,
    changesRanking: false,
    changesWeights: false,
    changesRiskGates: false,
    automaticOrders: false
  },
  recommendations: rows
};

writeJson(OUT_PATH, out);
console.log(JSON.stringify({
  generatedAt: out.generatedAt,
  signalDate: out.signalDate,
  recommendationCount: out.recommendationCount,
  actionCounts: out.actionCounts,
  tickers: rows.map(r => `${r.ticker}:${r.action.code}`),
  governance: out.governance
}, null, 2));
