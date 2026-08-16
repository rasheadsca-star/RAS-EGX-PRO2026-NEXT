import crypto from 'node:crypto';
import { evaluateDecision } from '../domain/decision.mjs';
import { DataUnavailableError } from '../infrastructure/errors.mjs';

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function yearsAgo(now, years) {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

function ageHours(asOf, now) {
  const endOfDayUtc = new Date(`${asOf}T23:59:59.999Z`).getTime();
  return (now.getTime() - endOfDayUtc) / 3_600_000;
}

export class MarketService {
  constructor({ provider, ledger, risk, now = () => new Date() }) {
    this.provider = provider;
    this.ledger = ledger;
    this.risk = risk;
    this.now = now;
  }

  status() {
    let ledgerValid = true;
    try {
      this.ledger.readVerified();
    } catch {
      ledgerValid = false;
    }
    return {
      provider: 'LSEG Data Platform',
      licenceClass: 'LICENSED',
      mode: 'LICENSED_EOD',
      configured: this.provider.isConfigured(),
      fallback: 'NONE',
      failClosed: true,
      automaticTrading: false,
      ledgerValid,
    };
  }

  async analyze({ ric, horizon = 'short' }) {
    if (!['short', 'medium', 'long'].includes(horizon)) {
      throw new DataUnavailableError('INVALID_HORIZON');
    }

    const now = this.now();
    const start = isoDate(yearsAgo(now, Math.max(5, this.risk.minBacktestYears + 1)));
    const end = isoDate(now);
    const { history, metadata } = await this.provider.getHistory(ric, { start, end, count: 10000 });

    const latestAgeHours = ageHours(metadata.asOf, now);
    if (latestAgeHours > this.risk.maxEodAgeHours) {
      throw new DataUnavailableError('STALE_LICENSED_DATA', 'Latest licensed EOD observation failed freshness gate.', {
        asOf: metadata.asOf,
        receivedAt: metadata.receivedAt,
        latestAgeHours,
      });
    }

    const fundamentals = null;
    const decision = evaluateDecision(history, {
      horizon,
      fundamentals,
      backtestOptions: {
        minYears: this.risk.minBacktestYears,
        minTrades: this.risk.minBacktestTrades,
        transactionCostBps: this.risk.transactionCostBps,
      },
    });

    const result = {
      ...decision,
      instrument: ric,
      source: metadata,
      latestPrice: {
        value: history.at(-1).close,
        asOf: metadata.asOf,
        receivedAt: metadata.receivedAt,
        provider: metadata.provider,
      },
    };

    if (decision.decision === 'BUY' || decision.decision === 'SELL') {
      const fingerprint = crypto.createHash('sha256')
        .update(`${ric}|${metadata.asOf}|${decision.decision}|${decision.score}|${horizon}`)
        .digest('hex');
      const { entry, appended } = this.ledger.appendIfNew({
        instrument: ric,
        decision: decision.decision,
        horizon,
        score: decision.score,
        confidenceInterval95Pct: decision.confidenceInterval95Pct,
        source: metadata,
        latestPrice: result.latestPrice,
        backtest: decision.backtest,
        disclaimer: decision.disclaimer,
      }, fingerprint);
      result.ledger = { sequence: entry.sequence, entryHash: entry.entryHash, appended };
    } else {
      result.ledger = null;
    }

    return result;
  }

  ledgerEntries() {
    return this.ledger.readVerified();
  }
}
