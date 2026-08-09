'use strict';

const CAIRO_ZONE = 'Africa/Cairo';
const MARKET_WEEKDAYS = new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu']);

function cairoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_ZONE,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
}

function isTradingWeekday(date = new Date()) {
  return MARKET_WEEKDAYS.has(cairoParts(date).weekday);
}

function monitoringWindow(date = new Date()) {
  const p = cairoParts(date);
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  if (!MARKET_WEEKDAYS.has(p.weekday)) return 'WEEKEND_OR_NON_TRADING_DAY';
  if (minutes >= 450 && minutes < 570) return 'PRE_MARKET_REVIEW';
  if (minutes >= 570 && minutes < 870) return 'INTRADAY_MATERIAL_EVENT_MONITOR';
  if (minutes >= 870 && minutes < 1080) return 'POST_MARKET_FULL_REVIEW';
  return 'OUTSIDE_MONITORING_WINDOW';
}

function shouldRunMode(mode, date = new Date()) {
  const window = monitoringWindow(date);
  if (mode === 'PRE_MARKET') return window === 'PRE_MARKET_REVIEW';
  if (mode === 'INTRADAY') return window === 'INTRADAY_MATERIAL_EVENT_MONITOR';
  if (mode === 'POST_MARKET') return window === 'POST_MARKET_FULL_REVIEW';
  if (mode === 'WEEKLY') return cairoParts(date).weekday === 'Fri';
  return false;
}

function shouldRunScheduledMode(mode, date = new Date()) {
  const parts = cairoParts(date);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (mode === 'PRE_MARKET') return MARKET_WEEKDAYS.has(parts.weekday) && hour === 8 && minute >= 0 && minute < 30;
  if (mode === 'POST_MARKET') return MARKET_WEEKDAYS.has(parts.weekday) && hour === 15 && minute >= 0 && minute < 30;
  if (mode === 'WEEKLY') return parts.weekday === 'Fri';
  return shouldRunMode(mode, date);
}

module.exports = { CAIRO_ZONE, MARKET_WEEKDAYS, cairoParts, isTradingWeekday, monitoringWindow, shouldRunMode, shouldRunScheduledMode };
