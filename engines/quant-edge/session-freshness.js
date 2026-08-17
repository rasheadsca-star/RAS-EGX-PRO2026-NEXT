'use strict';

const TIME_ZONE = 'Africa/Cairo';
const DEFAULT_COMPLETE_AFTER_MINUTE = 15 * 60; // 15:00 Cairo, 30m after normal cash close.

function ymdFromParts({ year, month, day }) {
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function cairoParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    year: Number(obj.year), month: Number(obj.month), day: Number(obj.day),
    hour: Number(obj.hour), minute: Number(obj.minute)
  };
}

function parseHolidaySet(value = process.env.QE_EGX_HOLIDAYS || '') {
  const vals = Array.isArray(value) ? value : String(value || '').split(',');
  return new Set(vals.map(v => String(v).trim()).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v)));
}

function utcDateFromYmd(ymd) {
  const [y,m,d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function shiftYmd(ymd, days) {
  const d = utcDateFromYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

function isEgxTradingDay(ymd, holidays = parseHolidaySet()) {
  if (holidays.has(ymd)) return false;
  const dow = utcDateFromYmd(ymd).getUTCDay();
  return dow >= 0 && dow <= 4; // Sunday through Thursday.
}

function previousTradingDay(ymd, holidays = parseHolidaySet()) {
  let d = shiftYmd(ymd, -1);
  for (let i = 0; i < 14; i++) {
    if (isEgxTradingDay(d, holidays)) return d;
    d = shiftYmd(d, -1);
  }
  throw new Error('EGX_PREVIOUS_SESSION_UNRESOLVED');
}

function lastCompletedEgxSession(now = new Date(), options = {}) {
  const holidays = options.holidays instanceof Set ? options.holidays : parseHolidaySet(options.holidays);
  const completeAfterMinute = Number.isFinite(Number(options.completeAfterMinute))
    ? Number(options.completeAfterMinute)
    : Number(process.env.QE_EGX_COMPLETE_AFTER_MINUTE || DEFAULT_COMPLETE_AFTER_MINUTE);
  const p = cairoParts(now);
  const today = ymdFromParts(p);
  const minuteOfDay = p.hour * 60 + p.minute;
  if (isEgxTradingDay(today, holidays) && minuteOfDay >= completeAfterMinute) return today;
  return previousTradingDay(today, holidays);
}

function tradingSessionLag(actualAsOf, requiredSession, holidays = parseHolidaySet()) {
  if (!actualAsOf || !requiredSession) return null;
  if (actualAsOf >= requiredSession) return 0;
  let lag = 0;
  let d = actualAsOf;
  for (let i = 0; i < 30 && d < requiredSession; i++) {
    d = shiftYmd(d, 1);
    if (isEgxTradingDay(d, holidays) && d <= requiredSession) lag++;
  }
  return lag;
}

function evaluateFreshness(asOf, now = new Date(), options = {}) {
  const holidays = options.holidays instanceof Set ? options.holidays : parseHolidaySet(options.holidays);
  const requiredSession = options.requiredSession || lastCompletedEgxSession(now, { ...options, holidays });
  const lagSessions = tradingSessionLag(asOf, requiredSession, holidays);
  return {
    timeZone: TIME_ZONE,
    requiredSession,
    actualAsOf: asOf || null,
    lagSessions,
    isFresh: Boolean(asOf && asOf >= requiredSession),
    policy: 'FAIL_CLOSED_IF_BEHIND_LAST_COMPLETED_EGX_SESSION'
  };
}

module.exports = {
  TIME_ZONE,
  DEFAULT_COMPLETE_AFTER_MINUTE,
  cairoParts,
  parseHolidaySet,
  shiftYmd,
  isEgxTradingDay,
  previousTradingDay,
  lastCompletedEgxSession,
  tradingSessionLag,
  evaluateFreshness
};
