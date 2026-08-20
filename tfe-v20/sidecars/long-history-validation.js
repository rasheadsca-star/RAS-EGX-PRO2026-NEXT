import { backtestHistory, summarizeBacktest } from '../src/backtest.js';

export function validateLongHistories(histories = []) {
  const items = Array.isArray(histories) ? histories : [];
  const perTicker = [];
  const allTrades = [];
  const allExpired = [];
  let totalSessions = 0;
  let multiYearSymbols = 0;

  for (const item of items) {
    const ticker = String(item?.ticker ?? '').trim().toUpperCase();
    const rows = item?.rows ?? item?.sessions ?? [];
    if (!ticker || !Array.isArray(rows)) continue;
    totalSessions += rows.length;
    if (rows.length >= 500) multiYearSymbols += 1;
    const result = backtestHistory({ ticker, rows });
    allTrades.push(...result.trades);
    allExpired.push(...result.expired.map((x)=>({ ticker, ...x })));
    perTicker.push({ ticker, sessions: rows.length, ...result.summary });
  }

  return {
    schemaVersion: 'tfe.long-history-validation.1',
    scoringImpact: 'NONE',
    productionRuntimeMutation: false,
    engineParametersModified: false,
    symbols: perTicker.length,
    multiYearSymbols,
    totalSessions,
    aggregate: summarizeBacktest(allTrades, allExpired).summary,
    perTicker,
  };
}
