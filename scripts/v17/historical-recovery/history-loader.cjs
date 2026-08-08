'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isEgxTradingWeekday(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day >= 0 && day <= 4;
}

function previousDate(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function mostRecentCalendarTradingCandidate(asOfDate, beforeSundayOpen = false) {
  let candidate = asOfDate;
  const day = new Date(`${candidate}T12:00:00Z`).getUTCDay();
  if (day === 0 && beforeSundayOpen) candidate = previousDate(candidate);
  while (!isEgxTradingWeekday(candidate)) candidate = previousDate(candidate);
  return candidate;
}

function latestExpectedEgxSession(asOfDate, observedMarketSessions, beforeSundayOpen = false) {
  const candidate = mostRecentCalendarTradingCandidate(asOfDate, beforeSundayOpen);
  return observedMarketSessions.filter(date => date <= candidate).at(-1) || null;
}

function validAdjustedSession(row) {
  return row.adjustedClose !== null && row.adjustedClose !== undefined && row.adjustedClose !== '' && Number.isFinite(Number(row.adjustedClose)) && Number(row.adjustedClose) > 0;
}

function missedExpectedSessionCount(lastSession, expectedMarketSessions) {
  return lastSession ? expectedMarketSessions.filter(date => date > lastSession).length : expectedMarketSessions.length;
}

function isStaleByExpectedSessions(lastSession, expectedMarketSessions, tolerance = 0) {
  return missedExpectedSessionCount(lastSession, expectedMarketSessions) > tolerance;
}

function loadHistory(root, config = {}) {
  const historyDir = path.join(root, 'data', 'history');
  const corporateFile = path.join(root, 'data', 'corporate-actions.json');
  const corporate = fs.existsSync(corporateFile) ? readJson(corporateFile) : { candidates: [] };
  const corporateByTicker = new Map();
  for (const item of corporate.candidates || []) {
    const ticker = String(item.ticker || '').toUpperCase();
    if (!corporateByTicker.has(ticker)) corporateByTicker.set(ticker, []);
    corporateByTicker.get(ticker).push(item);
  }
  const files = fs.readdirSync(historyDir).filter(file => file.endsWith('.json')).sort();
  const documents = files.map(file => {
    const document = readJson(path.join(historyDir, file));
    const ticker = String(document.ticker || path.basename(file, '.json')).toUpperCase();
    const sessions = Array.isArray(document.sessions)
      ? [...document.sessions].sort((a, b) => String(a.date).localeCompare(String(b.date)))
      : [];
    return { file, document, ticker, sessions };
  });
  const dateCoverage = new Map();
  for (const item of documents) for (const date of new Set(item.sessions.map(row => row.date).filter(Boolean))) dateCoverage.set(date, (dateCoverage.get(date) || 0) + 1);
  const minimumCoverage = Math.max(1, Math.ceil(documents.length * Number(config.expectedSessionCoveragePct || 25) / 100));
  const observedMarketSessions = [...dateCoverage.entries()].filter(([, count]) => count >= minimumCoverage).map(([date]) => date).sort();
  const asOfDate = String(config.asOfDate || new Date().toISOString().slice(0, 10));
  const latestExpectedSession = latestExpectedEgxSession(asOfDate, observedMarketSessions, config.beforeSundayOpen === true);
  const expectedMarketSessions = observedMarketSessions.filter(date => !latestExpectedSession || date <= latestExpectedSession);
  return documents.map(({ document, ticker, sessions }) => {
    const reasons = [];
    const minimum = Number(config.minimumSessions || 65);
    const cleanSessions = sessions.filter(validAdjustedSession);
    if (cleanSessions.length < minimum) reasons.push(`insufficient_history:${cleanSessions.length}/${minimum}`);
    const lastSession = sessions.at(-1)?.date || null;
    const missedExpectedSessions = missedExpectedSessionCount(lastSession, expectedMarketSessions);
    if (document.updateFailed === true || isStaleByExpectedSessions(lastSession, expectedMarketSessions, Number(config.maximumMissedExpectedSessions || 2))) reasons.push(`stale_history:${missedExpectedSessions}`);
    if (document.symbolVerified !== true) reasons.push('symbol_not_verified');
    const missingAdjusted = sessions.length - cleanSessions.length;
    if (missingAdjusted && cleanSessions.length < minimum) reasons.push(`missing_adjusted_close:${missingAdjusted}`);
    const duplicateDates = sessions.length - new Set(sessions.map(row => row.date)).size;
    const inconsistentRows = sessions.filter(row => !row.date || !(Number(row.close) > 0) || !(Number(row.high) >= Number(row.low)) || Number(row.high) < Number(row.close) || Number(row.low) > Number(row.close)).length;
    if (duplicateDates || inconsistentRows) reasons.push(`corrupt_history:${duplicateDates + inconsistentRows}`);
    const corporateActions = corporateByTicker.get(ticker) || [];
    if (corporateActions.length) reasons.push(`corporate_action_review:${corporateActions.length}`);
    return { ticker, document, sessions: cleanSessions, rawSessions: sessions, corporateActions, loaderReasons: reasons, coverage: { rawSessions: sessions.length, cleanAdjustedSessions: cleanSessions.length, missingAdjustedSessions: missingAdjusted, adjustedCloseCoveragePct: sessions.length ? Number((cleanSessions.length / sessions.length * 100).toFixed(4)) : 0, horizonStatus: 'SHORT_WINDOW_ONLY' }, staleness: { basis: 'EXPECTED_EGX_MARKET_SESSIONS_SUN_THU_WITH_OBSERVED_HOLIDAY_GUARD', asOfDate, latestExpectedSession, lastSession, missedExpectedSessions } };
  });
}

module.exports = { isEgxTradingWeekday, isStaleByExpectedSessions, latestExpectedEgxSession, loadHistory, missedExpectedSessionCount, mostRecentCalendarTradingCandidate, validAdjustedSession };
