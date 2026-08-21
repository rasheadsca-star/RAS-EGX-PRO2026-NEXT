const TIME_ZONE = 'Africa/Cairo';
const ENTRY_EXPIRY_SESSIONS = 3;
const MAX_HOLD_SESSIONS = 10;
const ROUND_TRIP_COST_PCT = 0.60;

const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
const round = (v, d = 2) => num(v) === null ? null : Number(Number(v).toFixed(d));
const iso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null;

export function cairoClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(now).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour), minute = Number(parts.minute);
  return { date, weekday:parts.weekday, hour, minute, minutes:hour * 60 + minute, time:`${parts.hour}:${parts.minute}` };
}

export function marketPhase(now = new Date()) {
  const c = cairoClock(now);
  const tradingDay = ['Sun','Mon','Tue','Wed','Thu'].includes(c.weekday);
  if (!tradingDay) return { ...c, phase:'WEEKEND', expectedOpen:false };
  const open = 10 * 60;
  const close = 14 * 60 + 30;
  if (c.minutes < open) return { ...c, phase:'PRE_OPEN', expectedOpen:false };
  if (c.minutes <= close) return { ...c, phase:'OPEN', expectedOpen:true };
  return { ...c, phase:'POST_CLOSE', expectedOpen:false };
}

function normalizeBar(row, partial = false) {
  const date = iso(row?.date ?? row?.sourceSessionDate ?? row?.marketSessionDate);
  const open = num(row?.open), high = num(row?.high), low = num(row?.low), close = num(row?.close ?? row?.price ?? row?.last);
  if (!date || ![open, high, low, close].every(x => x !== null && x > 0)) return null;
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null;
  return { date, open, high, low, close, partial:Boolean(partial) };
}

function fill(bar, plan) {
  const low = num(plan.entryLow), high = num(plan.entryHigh);
  if (!(low > 0) || !(high >= low)) return null;
  if (bar.open >= low && bar.open <= high) return bar.open;
  if (bar.open > high && bar.low <= high) return high;
  if (bar.open < low) return null;
  if (bar.low <= high && bar.high >= low) return high;
  return null;
}

export function quoteFreshness(quote, now = new Date()) {
  const phase = marketPhase(now);
  if (!quote) return { state:'UNAVAILABLE', className:'bad', labelAr:'مصدر المتابعة غير متاح', phase };
  const session = iso(quote.sourceSessionDate);
  if (phase.phase === 'PRE_OPEN') {
    return session && session < phase.date
      ? { state:'PRE_OPEN_REFERENCE', className:'neutral', labelAr:`قبل الافتتاح — آخر جلسة ${session}`, phase }
      : { state:'PRE_OPEN', className:'neutral', labelAr:'قبل الافتتاح', phase };
  }
  if (phase.phase === 'WEEKEND') return { state:'MARKET_CLOSED', className:'neutral', labelAr:'السوق خارج أيام التداول المعتادة', phase };
  if (session !== phase.date) return { state:'STALE_SESSION', className:'bad', labelAr:`بيانات المتابعة لم تصل لجلسة ${phase.date}`, phase };
  const sourceMinutes = num(quote.sourceMarketMinutes);
  if (sourceMinutes === null) return { state:'CURRENT_SESSION_UNKNOWN_AGE', className:'warn', labelAr:'جلسة اليوم — عمر السعر غير محدد', phase };
  const age = Math.max(0, phase.minutes - sourceMinutes);
  if (phase.phase === 'OPEN' && age <= 40) return { state:'DELAYED_LIVE', className:'good', labelAr:`متابعة جلسة اليوم — تأخير المصدر نحو ${quote.delayedMinutes ?? 15} دقيقة`, ageMinutes:age, phase };
  if (phase.phase === 'OPEN' && age <= 75) return { state:'LAGGING', className:'warn', labelAr:`السعر متأخر عن المعتاد (${age} دقيقة)`, ageMinutes:age, phase };
  if (phase.phase === 'OPEN') return { state:'STALE_INTRADAY', className:'bad', labelAr:`السعر قديم داخل الجلسة (${age} دقيقة)`, ageMinutes:age, phase };
  return { state:'CLOSED_SESSION', className:'neutral', labelAr:`جلسة ${session} مغلقة/مرجعية`, ageMinutes:age, phase };
}

function zone(price, plan) {
  const p = num(price), low = num(plan.entryLow), high = num(plan.entryHigh);
  if (!(p > 0) || !(low > 0) || !(high >= low)) return 'UNKNOWN';
  if (p < low) return 'BELOW_ENTRY';
  if (p <= high) return 'IN_ENTRY_ZONE';
  return 'ABOVE_ENTRY';
}

export function evaluateFrozenCandidate(signal, historyRows = [], liveQuote = null, now = new Date()) {
  const plan = {
    entryLow:num(signal?.entryLow), entryHigh:num(signal?.entryHigh), stop:num(signal?.stop),
    target1:num(signal?.target1), target2:num(signal?.target2),
  };
  const signalDate = iso(signal?.sessionDate);
  const ticker = String(signal?.ticker ?? '').toUpperCase();
  const freshness = quoteFreshness(liveQuote, now);
  if (!signalDate || !ticker || !Object.values(plan).slice(0,4).every(x => x !== null && x > 0)) {
    return { ticker, state:'INVALID_SIGNAL', resolved:false, scoringImpact:'NONE', freshness };
  }

  const phase = freshness.phase;
  const byDate = new Map();
  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    const bar = normalizeBar(row, false);
    if (bar && bar.date > signalDate) byDate.set(bar.date, bar);
  }
  const liveBar = normalizeBar(liveQuote, phase.phase === 'OPEN' && liveQuote?.sourceSessionDate === phase.date);
  if (liveBar && liveBar.date > signalDate) byDate.set(liveBar.date, liveBar);
  const bars = [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date));
  const entryWindow = bars.slice(0, ENTRY_EXPIRY_SESSIONS);

  let entryIndex = -1, entryPrice = null;
  for (let i = 0; i < entryWindow.length; i += 1) {
    const price = fill(entryWindow[i], plan);
    if (price !== null) { entryIndex = i; entryPrice = price; break; }
  }

  const currentPrice = num(liveQuote?.price) ?? bars.at(-1)?.close ?? num(signal?.price);
  const base = {
    ticker, signalDate, currentPrice, zone:zone(currentPrice, plan), freshness,
    entryLow:plan.entryLow, entryHigh:plan.entryHigh, stop:plan.stop, target1:plan.target1, target2:plan.target2,
    sessionsObserved:bars.length, scoringImpact:'NONE', recommendationMutationAllowed:false, executionAllowed:false,
  };

  if (entryIndex < 0) {
    const firstT1Touch = bars.find((bar) => bar.high >= plan.target1) ?? null;
    const firstT2Touch = plan.target2 > 0 ? (bars.find((bar) => bar.high >= plan.target2) ?? null) : null;
    const noEntryTargets = {
      target1TouchedWithoutEntry: Boolean(firstT1Touch),
      target2TouchedWithoutEntry: Boolean(firstT2Touch),
      target1TouchDateWithoutEntry: firstT1Touch?.date ?? null,
      target2TouchDateWithoutEntry: firstT2Touch?.date ?? null,
    };
    const third = entryWindow[ENTRY_EXPIRY_SESSIONS - 1];
    const thirdStillOpen = Boolean(third?.partial);
    if (entryWindow.length >= ENTRY_EXPIRY_SESSIONS && !thirdStillOpen) return { ...base, ...noEntryTargets, state:'ENTRY_EXPIRED', resolved:true, entered:false };
    if (base.zone === 'IN_ENTRY_ZONE') return { ...base, ...noEntryTargets, state:'ENTRY_ZONE_TOUCHED', resolved:false, entered:false };
    if (base.zone === 'ABOVE_ENTRY') return { ...base, ...noEntryTargets, state:'WAIT_PULLBACK_ABOVE_ENTRY', resolved:false, entered:false };
    if (base.zone === 'BELOW_ENTRY') return { ...base, ...noEntryTargets, state:'WAIT_RECOVERY_BELOW_ENTRY', resolved:false, entered:false };
    return { ...base, ...noEntryTargets, state:'WAITING_FOR_ENTRY', resolved:false, entered:false };
  }

  const entryBar = entryWindow[entryIndex];
  const absoluteEntryIndex = bars.findIndex(x => x.date === entryBar.date);
  const exitBars = bars.slice(absoluteEntryIndex, absoluteEntryIndex + MAX_HOLD_SESSIONS);
  for (const bar of exitBars) {
    const hitStop = bar.low <= plan.stop;
    const hitT1 = bar.high >= plan.target1;
    const hitT2 = plan.target2 > 0 && bar.high >= plan.target2;
    if (hitStop && hitT1) {
      return { ...base, state:'STOP_SAME_BAR', resolved:true, entered:true, entryDate:entryBar.date, entryPrice:round(entryPrice,4), exitDate:bar.date, exitPrice:plan.stop, netPct:round((plan.stop-entryPrice)/entryPrice*100-ROUND_TRIP_COST_PCT,2), stopFirstApplied:true };
    }
    if (hitStop) return { ...base, state:'STOP', resolved:true, entered:true, entryDate:entryBar.date, entryPrice:round(entryPrice,4), exitDate:bar.date, exitPrice:plan.stop, netPct:round((plan.stop-entryPrice)/entryPrice*100-ROUND_TRIP_COST_PCT,2) };
    if (hitT2) return { ...base, state:'TARGET2_REACHED', resolved:true, entered:true, entryDate:entryBar.date, entryPrice:round(entryPrice,4), exitDate:bar.date, exitPrice:plan.target2, netPct:round((plan.target2-entryPrice)/entryPrice*100-ROUND_TRIP_COST_PCT,2) };
    if (hitT1) return { ...base, state:'TARGET1_REACHED', resolved:true, entered:true, entryDate:entryBar.date, entryPrice:round(entryPrice,4), exitDate:bar.date, exitPrice:plan.target1, netPct:round((plan.target1-entryPrice)/entryPrice*100-ROUND_TRIP_COST_PCT,2) };
  }

  const completedExitBars = exitBars.filter(x => !x.partial);
  if (completedExitBars.length >= MAX_HOLD_SESSIONS) {
    const last = completedExitBars.at(-1);
    return { ...base, state:'TIME_EXIT', resolved:true, entered:true, entryDate:entryBar.date, entryPrice:round(entryPrice,4), exitDate:last.date, exitPrice:last.close, netPct:round((last.close-entryPrice)/entryPrice*100-ROUND_TRIP_COST_PCT,2) };
  }

  return {
    ...base,
    state:'POSITION_OPEN', resolved:false, entered:true, entryDate:entryBar.date, entryPrice:round(entryPrice,4),
    pnlFromEntryPct:currentPrice && entryPrice ? round((currentPrice-entryPrice)/entryPrice*100,2) : null,
    distanceToT1Pct:currentPrice && plan.target1 ? round((plan.target1-currentPrice)/currentPrice*100,2) : null,
    sessionsObservedAfterEntry:exitBars.length,
  };
}

export const MONITOR_POLICY = Object.freeze({
  timeZone:TIME_ZONE,
  pollingMs:300_000,
  expectedSessionOpen:'10:00',
  expectedSessionClose:'14:30',
  entryExpirySessions:ENTRY_EXPIRY_SESSIONS,
  maxHoldSessions:MAX_HOLD_SESSIONS,
  roundTripCostPct:ROUND_TRIP_COST_PCT,
  scoringImpact:'NONE',
  recommendationMutationAllowed:false,
  executionAllowed:false,
});
