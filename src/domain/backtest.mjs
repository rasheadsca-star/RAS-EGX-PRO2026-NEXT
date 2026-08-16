import { buildFeatures, labelFromScore } from './indicators.mjs';
import { round } from './math.mjs';
import { wilsonInterval } from './confidence.mjs';

function spanYears(from, to) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms / (365.2425 * 24 * 60 * 60 * 1000);
}

export function runBacktest(history, {
  minYears = 3,
  minTrades = 100,
  transactionCostBps = 60,
  warmup = 60,
} = {}) {
  if (!Array.isArray(history) || history.length <= warmup + 1) {
    return {
      validated: false,
      reasonCodes: ['INSUFFICIENT_HISTORY'],
      directionalTrades: 0,
      confidenceInterval95Pct: null,
    };
  }

  const cost = transactionCostBps / 10000;
  let directionalTrades = 0;
  let wins = 0;
  let losses = 0;
  let signedReturnSum = 0;
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;

  for (let i = warmup - 1; i < history.length - 1; i += 1) {
    const slice = history.slice(0, i + 1);
    const feature = buildFeatures(slice);
    const label = labelFromScore(feature.finalScore);
    if (label === 'HOLD') continue;

    const currentClose = Number(history[i].close);
    const nextClose = Number(history[i + 1].close);
    const rawReturn = nextClose / currentClose - 1;
    const signedNetReturn = (label === 'BUY' ? rawReturn : -rawReturn) - cost;

    directionalTrades += 1;
    if (signedNetReturn > 0) wins += 1;
    else losses += 1;
    signedReturnSum += signedNetReturn;

    equity *= 1 + signedNetReturn;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
  }

  const from = history[0].date;
  const to = history.at(-1).date;
  const years = spanYears(from, to);
  const reasonCodes = [];
  if (years < minYears) reasonCodes.push('BACKTEST_SPAN_TOO_SHORT');
  if (directionalTrades < minTrades) reasonCodes.push('BACKTEST_TRADE_COUNT_TOO_LOW');

  return {
    validated: reasonCodes.length === 0,
    reasonCodes,
    from,
    to,
    spanYears: round(years, 2),
    sessions: history.length,
    directionalTrades,
    wins,
    losses,
    winRatePct: directionalTrades ? round((wins / directionalTrades) * 100, 2) : null,
    averageSignedNetReturnPct: directionalTrades ? round((signedReturnSum / directionalTrades) * 100, 4) : null,
    compoundedSignedReturnPct: round((equity - 1) * 100, 2),
    maximumDrawdownPct: round(maxDrawdown * 100, 2),
    transactionCostBps,
    confidenceInterval95Pct: wilsonInterval(wins, directionalTrades),
  };
}
