import path from 'node:path';

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const config = Object.freeze({
  port: numberEnv('PORT', 3000),
  provider: Object.freeze({
    name: 'LSEG Data Platform',
    baseUrl: process.env.LSEG_BASE_URL || 'https://api.refinitiv.com',
    tokenUrl: process.env.LSEG_TOKEN_URL || 'https://api.refinitiv.com/auth/oauth2/v2/token',
    clientId: process.env.LSEG_CLIENT_ID || '',
    clientSecret: process.env.LSEG_CLIENT_SECRET || '',
    scope: process.env.LSEG_SCOPE || 'trapi',
    mode: 'LICENSED_EOD',
  }),
  risk: Object.freeze({
    maxEodAgeHours: numberEnv('MAX_EOD_AGE_HOURS', 120),
    minBacktestYears: numberEnv('BACKTEST_MIN_YEARS', 3),
    minBacktestTrades: numberEnv('BACKTEST_MIN_TRADES', 100),
    transactionCostBps: numberEnv('TRANSACTION_COST_BPS', 60),
  }),
  ledgerPath: path.resolve(process.env.LEDGER_PATH || 'data/recommendations.ledger.jsonl'),
});

export function providerConfigured(cfg = config) {
  return Boolean(cfg.provider.clientId && cfg.provider.clientSecret);
}
