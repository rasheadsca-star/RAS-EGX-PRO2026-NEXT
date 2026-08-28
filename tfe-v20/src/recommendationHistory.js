import { POLICY } from './policy.js';
import { normalizeBars } from './quality.js';
import { avg, round } from './math.js';

const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const dateOnly = (v) => (String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? null;

function fill(bar, plan) {
  if (bar.open >= plan.entryLow && bar.open <= plan.entryHigh) return bar.open;
  if (bar.open > plan.entryHigh && bar.low <= plan.entryHigh) return plan.entryHigh;
  if (bar.open < plan.entryLow) return null;
  if (bar.low <= plan.entryHigh && bar.high >= plan.entryLow) return plan.entryHigh;
  return null;
}

function pct(a, b) {
  return a != null && b > 0 ? (a / b - 1) * 100 : null;
}

function meanFinite(values) {
  const rows = values.filter(Number.isFinite);
  return rows.length ? avg(rows) : null;
}

function median(values) {
  const rows = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!rows.length) return null;
  const m = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[m] : (rows[m-1] + rows[m]) / 2;
}

export function evaluatePublishedRecommendation(record, rows, {
  entryExpirySessions = POLICY.entryExpirySessions,
  maxHoldSessions = POLICY.maxHoldSessions,
  costPct = POLICY.roundTripCostPct,
} = {}) {
  const bars = normalizeBars(rows).bars;
  const sessionDate = dateOnly(record?.sessionDate);
  const plan = {
    entryLow: num(record?.entryLow ?? record?.tradePlan?.entryLow),
    entryHigh: num(record?.entryHigh ?? record?.tradePlan?.entryHigh),
    stop: num(record?.stop ?? record?.tradePlan?.stop),
    target1: num(record?.target1 ?? record?.tradePlan?.target1),
    target2: num(record?.target2 ?? record?.tradePlan?.target2),
  };
  const base = {
    ...record,
    sessionDate,
    entryLow: plan.entryLow,
    entryHigh: plan.entryHigh,
    stop: plan.stop,
    target1: plan.target1,
    target2: plan.target2,
    outcome: 'UNRESOLVED',
    outcomeLabelAr: 'غير محسومة',
    entered: false,
    entryDate: null,
    entryPrice: null,
    exitDate: null,
    exitPrice: null,
    netPct: null,
    target1Hit: false,
    target2Hit: false,
    stopHit: false,
    timeExit: false,
    sessionsToEntry: null,
    sessionsToExit: null,
    sessionsToTarget1: null,
    sessionsToTarget2: null,
    sessionsToStop: null,
    latestObservedSession: bars.at(-1)?.date ?? null,
    latestObservedClose: bars.at(-1)?.close ?? null,
    plannedTarget1Pct: plan.entryHigh > 0 && plan.target1 > 0 ? round(pct(plan.target1, plan.entryHigh), 2) : null,
    plannedTarget2Pct: plan.entryHigh > 0 && plan.target2 > 0 ? round(pct(plan.target2, plan.entryHigh), 2) : null,
    plannedStopPct: plan.entryHigh > 0 && plan.stop > 0 ? round(Math.abs(pct(plan.stop, plan.entryHigh)), 2) : null,
    methodology: {
      entryTiming: 'NEXT_SESSION_OR_LATER_ONLY',
      entryExpirySessions,
      maxHoldSessions,
      sameBarAmbiguity: 'STOP_FIRST',
      primaryOutcomeExit: 'TARGET1_OR_STOP_OR_TIME_EXIT',
      target2Tracking: 'SECONDARY_WITHIN_ORIGINAL_HOLD_WINDOW',
      roundTripCostPct: costPct,
    },
  };

  if (!sessionDate || ![plan.entryLow, plan.entryHigh, plan.stop, plan.target1].every((v) => v > 0) || !(plan.entryHigh >= plan.entryLow) || !(plan.entryLow > plan.stop)) {
    return { ...base, outcome: 'PLAN_UNAVAILABLE', outcomeLabelAr: 'خطة غير مكتملة' };
  }

  const signalIndex = bars.findIndex((b) => b.date === sessionDate);
  if (signalIndex < 0) return { ...base, outcome: 'SIGNAL_SESSION_NOT_FOUND', outcomeLabelAr: 'جلسة الإشارة غير موجودة' };
  if (signalIndex >= bars.length - 1) return { ...base, outcome: 'AWAITING_NEXT_SESSION', outcomeLabelAr: 'بانتظار الجلسة التالية' };

  const entryEnd = Math.min(bars.length - 1, signalIndex + entryExpirySessions);
  let entry = null;
  for (let j = signalIndex + 1; j <= entryEnd; j += 1) {
    const p = fill(bars[j], plan);
    if (p != null) { entry = { j, price: p }; break; }
  }
  if (!entry) {
    const mature = bars.length - 1 >= signalIndex + entryExpirySessions;
    return {
      ...base,
      outcome: mature ? 'EXPIRED_NO_ENTRY' : 'PENDING_ENTRY',
      outcomeLabelAr: mature ? 'انتهت بدون دخول' : 'بانتظار الدخول',
    };
  }

  const fullWindowEnd = entry.j + maxHoldSessions - 1;
  const observedEnd = Math.min(bars.length - 1, fullWindowEnd);
  let primaryExit = null;
  let target1Date = null;
  let stopDate = null;
  let target2Date = null;
  let target2Blocked = false;
  let maxHigh = -Infinity;
  let minLow = Infinity;

  for (let j = entry.j; j <= observedEnd; j += 1) {
    const b = bars[j];
    maxHigh = Math.max(maxHigh, b.high);
    minLow = Math.min(minLow, b.low);
    const stop = b.low <= plan.stop;
    const t1 = b.high >= plan.target1;
    const t2 = plan.target2 > plan.target1 && b.high >= plan.target2;

    if (!target2Date && !target2Blocked) {
      if (stop && t2) target2Blocked = true;
      else if (stop) target2Blocked = true;
      else if (t2) target2Date = b.date;
    }

    if (!primaryExit) {
      if (stop && t1) {
        primaryExit = { j, price: plan.stop, outcome: 'STOP_SAME_BAR' };
        stopDate = b.date;
      } else if (stop) {
        primaryExit = { j, price: plan.stop, outcome: 'STOP' };
        stopDate = b.date;
      } else if (t1) {
        primaryExit = { j, price: plan.target1, outcome: 'TARGET1' };
        target1Date = b.date;
      }
    }
  }

  const windowMature = bars.length - 1 >= fullWindowEnd;
  if (!primaryExit && windowMature) {
    primaryExit = { j: fullWindowEnd, price: bars[fullWindowEnd].close, outcome: 'TIME_EXIT' };
  }

  const currentIndex = primaryExit?.j ?? observedEnd;
  const currentPrice = primaryExit?.price ?? bars[currentIndex].close;
  const outcome = primaryExit?.outcome ?? 'OPEN';
  const outcomeLabelAr = outcome === 'TARGET1' ? 'حقق T1'
    : outcome === 'STOP' ? 'إيقاف'
    : outcome === 'STOP_SAME_BAR' ? 'إيقاف — تعارض نفس الجلسة'
    : outcome === 'TIME_EXIT' ? 'خروج زمني'
    : 'مفتوحة';

  return {
    ...base,
    outcome,
    outcomeLabelAr,
    entered: true,
    entryDate: bars[entry.j].date,
    entryPrice: round(entry.price, 4),
    exitDate: primaryExit ? bars[primaryExit.j].date : null,
    exitPrice: primaryExit ? round(primaryExit.price, 4) : null,
    netPct: round(pct(currentPrice, entry.price) - (primaryExit ? costPct : 0), 2),
    target1Hit: outcome === 'TARGET1',
    target2Hit: Boolean(target2Date),
    stopHit: outcome === 'STOP' || outcome === 'STOP_SAME_BAR',
    timeExit: outcome === 'TIME_EXIT',
    sessionsToEntry: entry.j - signalIndex,
    sessionsToExit: primaryExit ? primaryExit.j - entry.j + 1 : observedEnd - entry.j + 1,
    sessionsToTarget1: target1Date ? bars.findIndex((b) => b.date === target1Date) - entry.j + 1 : null,
    sessionsToTarget2: target2Date ? bars.findIndex((b) => b.date === target2Date) - entry.j + 1 : null,
    sessionsToStop: stopDate ? bars.findIndex((b) => b.date === stopDate) - entry.j + 1 : null,
    target2Date,
    maxFavorablePct: Number.isFinite(maxHigh) ? round(pct(maxHigh, entry.price), 2) : null,
    maxAdversePct: Number.isFinite(minLow) ? round(pct(minLow, entry.price), 2) : null,
    currentMarkPrice: !primaryExit ? round(currentPrice, 4) : null,
  };
}

export function summarizePublishedHistory(rows = []) {
  const records = Array.isArray(rows) ? rows : [];
  const entered = records.filter((x) => x.entered);
  const resolved = entered.filter((x) => ['TARGET1','STOP','STOP_SAME_BAR','TIME_EXIT'].includes(x.outcome));
  const target1 = resolved.filter((x) => x.outcome === 'TARGET1');
  const stops = resolved.filter((x) => x.stopHit);
  const time = resolved.filter((x) => x.timeExit);
  const target2 = entered.filter((x) => x.target2Hit);
  const wins = resolved.filter((x) => num(x.netPct) > 0);
  const losses = resolved.filter((x) => num(x.netPct) < 0);
  const gp = wins.reduce((s,x) => s + Number(x.netPct), 0);
  const gl = Math.abs(losses.reduce((s,x) => s + Number(x.netPct), 0));
  const matureEntrySignals = records.filter((x) => !['AWAITING_NEXT_SESSION','PENDING_ENTRY','PLAN_UNAVAILABLE','SIGNAL_SESSION_NOT_FOUND'].includes(x.outcome));

  return {
    totalSignals: records.length,
    entered: entered.length,
    resolved: resolved.length,
    open: entered.filter((x) => x.outcome === 'OPEN').length,
    pendingEntry: records.filter((x) => ['AWAITING_NEXT_SESSION','PENDING_ENTRY'].includes(x.outcome)).length,
    expiredNoEntry: records.filter((x) => x.outcome === 'EXPIRED_NO_ENTRY').length,
    entryRatePct: matureEntrySignals.length ? round(entered.length / matureEntrySignals.length * 100, 1) : null,
    target1HitPct: resolved.length ? round(target1.length / resolved.length * 100, 1) : null,
    target2HitPct: entered.length ? round(target2.length / entered.length * 100, 1) : null,
    stopPct: resolved.length ? round(stops.length / resolved.length * 100, 1) : null,
    timeExitPct: resolved.length ? round(time.length / resolved.length * 100, 1) : null,
    positivePct: resolved.length ? round(wins.length / resolved.length * 100, 1) : null,
    avgNetPct: resolved.length ? round(meanFinite(resolved.map((x) => num(x.netPct))), 2) : null,
    medianNetPct: resolved.length ? round(median(resolved.map((x) => num(x.netPct))), 2) : null,
    profitFactor: gl ? round(gp / gl, 2) : gp > 0 ? 'INF' : null,
    avgSessionsToEntry: entered.length ? round(meanFinite(entered.map((x) => num(x.sessionsToEntry))), 1) : null,
    avgSessionsHeld: resolved.length ? round(meanFinite(resolved.map((x) => num(x.sessionsToExit))), 1) : null,
    avgSessionsToTarget1: target1.length ? round(meanFinite(target1.map((x) => num(x.sessionsToTarget1))), 1) : null,
    avgSessionsToStop: stops.length ? round(meanFinite(stops.map((x) => num(x.sessionsToStop))), 1) : null,
    avgPlannedTarget1Pct: round(meanFinite(records.map((x) => num(x.plannedTarget1Pct))), 2),
    avgPlannedTarget2Pct: round(meanFinite(records.map((x) => num(x.plannedTarget2Pct))), 2),
    avgPlannedStopPct: round(meanFinite(records.map((x) => num(x.plannedStopPct))), 2),
  };
}

const CSV_COLUMNS = [
  'sessionDate','rank','ticker','decision','publicationState','outcome','outcomeLabelAr',
  'entryLow','entryHigh','entryDate','entryPrice','stop','target1','target2','target1Hit','target2Hit','stopHit',
  'exitDate','exitPrice','netPct','sessionsToEntry','sessionsToExit','fusionRankScore','researchScore','technicalScore','sourceType','sourceCommit'
];

function csvEsc(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}

export function toPublishedHistoryCsv(rows = []) {
  return '\uFEFF' + [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvEsc(r[c])).join(','))].join('\r\n') + '\r\n';
}
