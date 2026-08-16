import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MarketService } from '../src/services/market-service.mjs';
import { RecommendationLedger } from '../src/infrastructure/ledger.mjs';

function history(days = 1300) {
  const start = new Date('2022-01-01T00:00:00Z');
  let close = 80;
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const cycle = Math.sin(i / 13) * 0.004;
    close *= 1 + 0.0012 + cycle;
    return {
      date: date.toISOString().slice(0, 10),
      open: close * 0.997,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 50000 + i,
    };
  });
}

test('service connects source -> validation -> decision -> immutable ledger', async () => {
  const rows = history();
  const provider = {
    isConfigured: () => true,
    getHistory: async (ric) => ({
      history: rows,
      metadata: {
        provider: 'LSEG Data Platform',
        licenceClass: 'LICENSED',
        mode: 'LICENSED_EOD',
        instrument: ric,
        asOf: rows.at(-1).date,
        receivedAt: '2025-07-23T12:00:00Z',
      },
    }),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egx-service-'));
  const ledger = new RecommendationLedger(path.join(dir, 'ledger.jsonl'), {
    now: () => new Date('2025-07-23T12:00:00Z'),
  });
  const service = new MarketService({
    provider,
    ledger,
    risk: { minBacktestYears: 3, minBacktestTrades: 20, transactionCostBps: 10, maxEodAgeHours: 24 },
    now: () => new Date(`${rows.at(-1).date}T20:00:00Z`),
  });

  const result = await service.analyze({ ric: 'TEST.CA', horizon: 'short' });
  assert.equal(result.source.provider, 'LSEG Data Platform');
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(result.decision));
  if (result.decision === 'BUY' || result.decision === 'SELL') {
    assert.ok(result.confidenceInterval95Pct);
    assert.equal(ledger.readVerified().length, 1);
  } else {
    assert.equal(ledger.readVerified().length, 0);
  }
});

test('medium horizon is blocked without verified fundamentals', async () => {
  const rows = history();
  const provider = {
    isConfigured: () => true,
    getHistory: async (ric) => ({
      history: rows,
      metadata: {
        provider: 'LSEG Data Platform', licenceClass: 'LICENSED', mode: 'LICENSED_EOD',
        instrument: ric, asOf: rows.at(-1).date, receivedAt: '2025-07-23T12:00:00Z',
      },
    }),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egx-service-'));
  const service = new MarketService({
    provider,
    ledger: new RecommendationLedger(path.join(dir, 'ledger.jsonl')),
    risk: { minBacktestYears: 3, minBacktestTrades: 20, transactionCostBps: 10, maxEodAgeHours: 24 },
    now: () => new Date(`${rows.at(-1).date}T20:00:00Z`),
  });

  const result = await service.analyze({ ric: 'TEST.CA', horizon: 'medium' });
  assert.equal(result.decision, 'NO_RECOMMENDATION');
  assert.ok(result.reasonCodes.includes('VERIFIED_FUNDAMENTALS_REQUIRED'));
});
