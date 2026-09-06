#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const LEDGER = path.join(ROOT, 'data/stable/v18-forward-ledger.json');
const OUT = path.join(ROOT, 'data/stable/v18-global-strategy-ensemble.json');
const STOCKS = path.join(ROOT, 'data/quant/stocks');
const TRACKING_START = '2026-09-07';

const CATALOG = [
  ['V16_9_BASKET', 'V16.9 Basket Pilot', 'سلة V16.9 Pilot'],
  ['V13_5_PAPER', 'V13.5 Paper', 'V13.5 Paper'],
  ['V13_4_PAPER', 'V13.4 Paper', 'V13.4 Paper'],
  ['V13_5_WATCH', 'V13.5 Watch', 'V13.5 Watch'],
  ['V13_4_WATCH', 'V13.4 Watch', 'V13.4 Watch'],
  ['EMA_MACD_CONTINUATION_SHADOW', 'EMA–MACD Continuation', 'EMA–MACD Continuation'],
  ['V15_EXTENDED', 'V15 Extended Momentum', 'V15 Extended Momentum'],
  ['V18_RS_LEADERSHIP_SHADOW', 'V18 RS Leadership', 'V18 Relative Strength Leadership'],
  ['V18_VCP_SHADOW', 'V18 VCP', 'V18 Volatility Contraction']
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 2) {
  const n = num(value);
  return n == null ? null : Number(n.toFixed(digits));
}

function pct(numerator, denominator) {
  return denominator > 0 ? round((numerator / denominator) * 100, 1) : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadStocks() {
  const map = new Map();
  for (const name of fs.readdirSync(STOCKS).filter(x => x.endsWith('.json'))) {
    const stock = readJson(path.join(STOCKS, name));
    if (stock?.ticker) map.set(String(stock.ticker).toUpperCase(), stock);
  }
  return map;
}

function barsAfter(stock, issueSession) {
  const chart = stock?.chart || {};
  const dates = Array.isArray(chart.dates) ? chart.dates : [];
  const index = dates.indexOf(issueSession);
  if (index < 0) return [];

  const bars = [];
  for (let i = index + 1; i < dates.length; i += 1) {
    const date = dates[i];
    if (date < TRACKING_START) continue;
    bars.push({
      date,
      open: num(chart.open?.[i]),
      high: num(chart.high?.[i]),
      low: num(chart.low?.[i]),
      close: num(chart.close?.[i]),
      volume: num(chart.volume?.[i])
    });
  }
  return bars;
}

function resultBase(status, noteAr, extra = {}) {
  return {
    status,
    trackingStartsOn: TRACKING_START,
    referenceActivation: false,
    resolved: false,
    noteAr,
    ...extra
  };
}

function evaluateEntry(entry, stock) {
  const issued = entry.issued || {};
  const plan = issued.preferredPlan || {};
  const entryLow = num(plan.entryLow);
  const entryHigh = num(plan.entryHigh);
  const stop = num(plan.stopLoss);
  const target = num(plan.target1);

  if ([entryLow, entryHigh, stop, target].some(x => x == null)) {
    return resultBase(
      'NO_EVALUABLE_PLAN',
      'لا توجد خطة Entry/Stop/Target كاملة؛ لا تدخل في نسبة تحقيق المستهدف.'
    );
  }

  const bars = barsAfter(stock, issued.sessionId);
  if (!bars.length) {
    return resultBase(
      'PENDING_FUTURE_SESSION',
      'لم تبدأ جلسة تقييم مستقبلية بعد.'
    );
  }

  const first = bars[0];
  const referenceClose = num(issued.referenceClose);
  const gapPct = referenceClose > 0 && first.open != null
    ? ((first.open / referenceClose) - 1) * 100
    : null;

  if (first.open != null && first.open > entryHigh) {
    return resultBase(
      'CANCELLED_NO_CHASE_GAP',
      'افتتاح أعلى نطاق الدخول؛ ألغيت الإشارة طبقًا لقاعدة عدم المطاردة.',
      { firstEvaluationSession: first.date, gapPct: round(gapPct) }
    );
  }

  if (first.open != null && first.open <= stop) {
    return resultBase(
      'CANCELLED_OPEN_BELOW_STOP',
      'افتتاح عند/أسفل الوقف؛ الإشارة ملغاة.',
      { firstEvaluationSession: first.date, gapPct: round(gapPct) }
    );
  }

  const openInBand = first.open != null && first.open >= entryLow && first.open <= entryHigh;
  const intradayTouch = first.low != null && first.high != null && first.low <= entryHigh && first.high >= entryLow;

  if (!openInBand && !intradayTouch) {
    return resultBase(
      'NOT_TRIGGERED_NEXT_SESSION',
      'لم يلمس السعر نطاق الدخول في جلسة التفعيل التالية.',
      { firstEvaluationSession: first.date, gapPct: round(gapPct) }
    );
  }

  const requestedHold = Number(plan.maximumHoldingSessions || plan.holdingSessions || 5);
  const maxHold = Math.max(1, Math.min(10, Number.isFinite(requestedHold) ? requestedHold : 5));
  const observed = bars.slice(0, maxHold);

  let mfe = -Infinity;
  let mae = Infinity;
  for (const bar of observed) {
    if (bar.high != null) mfe = Math.max(mfe, ((bar.high - entryHigh) / entryHigh) * 100);
    if (bar.low != null) mae = Math.min(mae, ((bar.low - entryLow) / entryLow) * 100);
  }

  for (let i = 0; i < observed.length; i += 1) {
    const bar = observed[i];
    const hitTarget = bar.high != null && bar.high >= target;
    const hitStop = bar.low != null && bar.low <= stop;

    if (hitTarget && hitStop) {
      return {
        status: 'AMBIGUOUS_TARGET_STOP_SAME_BAR',
        trackingStartsOn: TRACKING_START,
        firstEvaluationSession: first.date,
        resolutionSession: bar.date,
        referenceActivation: true,
        resolved: false,
        ambiguous: true,
        sessionsObserved: i + 1,
        mfePct: round(mfe),
        maePct: round(mae),
        noteAr: 'نفس شمعة OHLC لمست الهدف والوقف؛ ترتيب الأحداث غير معروف لذلك لا تُحسب نجاحًا أو فشلًا.'
      };
    }

    if (hitTarget) {
      return {
        status: 'TARGET1_HIT',
        trackingStartsOn: TRACKING_START,
        firstEvaluationSession: first.date,
        resolutionSession: bar.date,
        referenceActivation: true,
        resolved: true,
        outcome: 'TARGET',
        sessionsObserved: i + 1,
        mfePct: round(mfe),
        maePct: round(mae),
        noteAr: 'تحقق Target 1 على أساس Reference OHLC بعد تفعيل ميكانيكي.'
      };
    }

    if (hitStop) {
      if (i === 0 && !openInBand) {
        return {
          status: 'AMBIGUOUS_ENTRY_STOP_SEQUENCE',
          trackingStartsOn: TRACKING_START,
          firstEvaluationSession: first.date,
          resolutionSession: bar.date,
          referenceActivation: true,
          resolved: false,
          ambiguous: true,
          sessionsObserved: 1,
          mfePct: round(mfe),
          maePct: round(mae),
          noteAr: 'الشمعة لمست الدخول والوقف لكن ترتيب الحدثين غير معروف؛ لا تُحسب خسارة.'
        };
      }

      return {
        status: 'STOP_HIT',
        trackingStartsOn: TRACKING_START,
        firstEvaluationSession: first.date,
        resolutionSession: bar.date,
        referenceActivation: true,
        resolved: true,
        outcome: 'STOP',
        sessionsObserved: i + 1,
        mfePct: round(mfe),
        maePct: round(mae),
        noteAr: 'تحقق الوقف بعد تفعيل Reference.'
      };
    }
  }

  return {
    status: 'OPEN_UNRESOLVED',
    trackingStartsOn: TRACKING_START,
    firstEvaluationSession: first.date,
    referenceActivation: true,
    resolved: false,
    sessionsObserved: observed.length,
    mfePct: round(mfe),
    maePct: round(mae),
    noteAr: 'الإشارة تفعّلت ميكانيكيًا ولم تصل للهدف أو الوقف داخل نافذة الرصد المتاحة.'
  };
}

function barsAvailable(results) {
  return results.some(x => x.firstEvaluationSession || x.status === 'OPEN_UNRESOLVED' || x.resolved);
}

if (!fs.existsSync(LEDGER)) throw new Error('Persistent forward ledger missing');
if (!fs.existsSync(OUT)) throw new Error('V18 output missing');

const ledger = readJson(LEDGER);
const source = readJson(OUT);
const stocks = loadStocks();

if (!Array.isArray(ledger.entries)) throw new Error('Ledger entries missing');

for (const entry of ledger.entries) {
  const ticker = String(entry.issued?.ticker || '').toUpperCase();
  const stock = stocks.get(ticker);
  entry.futurePerformance = stock
    ? evaluateEntry(entry, stock)
    : resultBase('CANONICAL_STOCK_MISSING', 'السهم غير موجود في Canonical universe.');
}

const league = [];
for (const [engineId, label, labelAr] of CATALOG) {
  const entries = ledger.entries.filter(entry => (entry.issued?.sources || []).includes(engineId));
  const evaluations = entries.map(entry => entry.futurePerformance || {});
  const evaluable = evaluations.filter(x => ![
    'NO_EVALUABLE_PLAN',
    'PENDING_FUTURE_SESSION',
    'CANONICAL_STOCK_MISSING'
  ].includes(x.status));
  const activated = evaluations.filter(x => x.referenceActivation);
  const targetHits = evaluations.filter(x => x.outcome === 'TARGET').length;
  const stopHits = evaluations.filter(x => x.outcome === 'STOP').length;
  const ambiguous = evaluations.filter(x => x.ambiguous).length;
  const unresolved = evaluations.filter(x => x.referenceActivation && !x.resolved && !x.ambiguous).length;
  const cancelled = evaluations.filter(x => [
    'CANCELLED_NO_CHASE_GAP',
    'CANCELLED_OPEN_BELOW_STOP',
    'NOT_TRIGGERED_NEXT_SESSION'
  ].includes(x.status)).length;
  const resolvedSignals = targetHits + stopHits;

  league.push({
    engineId,
    label,
    labelAr,
    trackingStartsOn: TRACKING_START,
    issuedSignals: entries.length,
    evaluableSignals: evaluable.length,
    referenceActivated: activated.length,
    target1Hits: targetHits,
    stopHits,
    ambiguous,
    unresolved,
    cancelledOrNotTriggered: cancelled,
    resolvedSignals,
    activationRatePct: pct(activated.length, evaluable.length),
    targetHitRateResolvedPct: pct(targetHits, resolvedSignals),
    targetHitRateActivatedPct: pct(targetHits, activated.length),
    stopRateResolvedPct: pct(stopHits, resolvedSignals),
    rankingEligible: resolvedSignals >= 5,
    status: entries.length === 0
      ? 'NO_SIGNALS_YET'
      : barsAvailable(evaluations)
        ? 'TRACKING'
        : 'WAITING_FOR_2026_09_07'
  });
}

league.sort((a, b) => {
  if (a.rankingEligible !== b.rankingEligible) return Number(b.rankingEligible) - Number(a.rankingEligible);
  const ar = a.targetHitRateResolvedPct ?? -1;
  const br = b.targetHitRateResolvedPct ?? -1;
  if (ar !== br) return br - ar;
  if (a.resolvedSignals !== b.resolvedSignals) return b.resolvedSignals - a.resolvedSignals;
  if (a.issuedSignals !== b.issuedSignals) return b.issuedSignals - a.issuedSignals;
  return a.engineId.localeCompare(b.engineId);
});

let formalRank = 0;
for (const engine of league) {
  if (engine.rankingEligible) {
    formalRank += 1;
    engine.leagueRank = formalRank;
  } else {
    engine.leagueRank = null;
  }
}

source.enginePerformanceLeague = {
  schemaVersion: '18.3.0-forward-league',
  trackingStartsOn: TRACKING_START,
  noBackfillBeforeStart: true,
  measurementType: 'FUTURE_ONLY_REFERENCE_PLUS_EXECUTION_CONFIRMED_WHEN_AVAILABLE',
  rankingMinimumResolvedSignals: 5,
  sharedSignalCreditPolicy: 'Each contributing engine receives attribution for a shared signal; this measures engine participation, not mutually exclusive portfolios.',
  referenceRules: {
    nextSessionActivationOnly: true,
    noChaseOpenAboveEntryHigh: true,
    openAtOrBelowStopCancels: true,
    sameBarTargetAndStop: 'AMBIGUOUS_EXCLUDED_FROM_WIN_LOSS',
    missingIntradayLiquidityConfirmation: 'REFERENCE_ONLY_NOT_EXECUTION_CONFIRMED'
  },
  engines: league,
  summary: {
    enginesTracked: league.length,
    enginesWithSignals: league.filter(x => x.issuedSignals > 0).length,
    totalUniqueIssuedSignals: ledger.entries.length,
    totalResolvedReferenceSignals: ledger.entries.filter(x => x.futurePerformance?.resolved).length,
    totalAmbiguous: ledger.entries.filter(x => x.futurePerformance?.ambiguous).length
  }
};

ledger.schemaVersion = '18.3.0-forward';
ledger.trackingStartsOn = TRACKING_START;
ledger.performancePolicy = source.enginePerformanceLeague.referenceRules;
ledger.summary = {
  ...(ledger.summary || {}),
  trackingStartsOn: TRACKING_START,
  resolvedReference: ledger.entries.filter(x => x.futurePerformance?.resolved).length,
  ambiguousReference: ledger.entries.filter(x => x.futurePerformance?.ambiguous).length
};

writeJson(LEDGER, ledger);
writeJson(OUT, source);

console.log(JSON.stringify({
  trackingStartsOn: TRACKING_START,
  engines: league.map(x => ({
    engine: x.engineId,
    issued: x.issuedSignals,
    activated: x.referenceActivated,
    resolved: x.resolvedSignals,
    targetRate: x.targetHitRateResolvedPct,
    rankingEligible: x.rankingEligible,
    status: x.status
  })),
  summary: source.enginePerformanceLeague.summary
}, null, 2));
