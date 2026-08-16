# EGX Audit Core

A clean-room rebuild of the EGX application with one codebase, one licensed data source, explicit decision math, long-horizon backtesting gates, and an append-only recommendation ledger.

## Safety boundary

This branch is intentionally independent from MAIN APP. It contains no V11–V17 parallel implementations, no HTML scraping, no regex market-data parsers, and no legacy experimental workflows.

## Market-data policy

The only implemented market-data provider is **LSEG Data Platform / Refinitiv Data Platform REST**.

- OAuth v2 client-credentials token endpoint: `https://api.refinitiv.com/auth/oauth2/v2/token`
- Historical daily pricing endpoint: `/data/historical-pricing/v1/views/interday-summaries/{RIC}`
- No public-page scraping fallback exists.
- If licensed credentials are absent, authentication fails, the payload is malformed, the latest bar is stale, or the backtest is insufficient, the application returns **NO_RECOMMENDATION** and does not silently reuse old numbers.
- Every displayed market number carries `asOf`, `receivedAt`, provider, and instrument metadata.

Official LSEG references:
- https://developers.lseg.com/en/article-catalog/article/getting-started-with-version-2-authentication-for-refinitiv-real
- https://developers.lseg.com/en/api-catalog/refinitiv-data-platform/refinitiv-data-platform-apis/tutorials/introductory-tutorials/authorization-all-about-tokens
- https://developers.lseg.com/en/article-catalog/article/comparison-of-data-library-python-vs-python-requests

> A valid LSEG entitlement is required. Credentials are not included in this repository.

## Decision methodology

Short-horizon technical score is fixed and auditable:

| Component | Weight |
|---|---:|
| SMA20 vs SMA50 trend | 30% |
| RSI(14) regime | 25% |
| ATR(14) risk | 20% |
| 20-session momentum | 25% |

The final score is a weighted sum in `[-100, 100]`.

- `>= +35`: BUY candidate
- `<= -35`: SELL candidate
- otherwise: HOLD / no directional recommendation

A BUY/SELL label is **blocked** unless:
1. at least 3 calendar years of licensed history are available,
2. at least 100 out-of-sample-style walk-forward trades exist,
3. the latest licensed EOD observation passes the freshness gate,
4. a Wilson 95% confidence interval can be computed from the historical directional outcomes.

Medium/long-horizon investment classification is deliberately disabled until verified fundamentals from the same licensed source are implemented.

## Recommendation ledger

Every BUY/SELL recommendation returned by the API is appended to `data/recommendations.ledger.jsonl`.

Each line contains:
- sequence number,
- recording timestamp,
- previous entry hash,
- recommendation payload,
- current SHA-256 entry hash.

The server verifies the complete hash chain before reading or appending. There is no edit/delete API. A tampered ledger fails closed.

## No trading

This software never places orders and has no broker integration. It is a research/decision-support tool only and is **not investment advice and not a licensed broker**.

## Run

```bash
cp .env.example .env
# fill LSEG_CLIENT_ID and LSEG_CLIENT_SECRET
npm test
npm run check
npm start
```

Open `http://localhost:3000`.

An EGX instrument must be supplied as its LSEG RIC (for example, the exact RIC entitled by your LSEG account). The app never guesses ticker-to-RIC mappings.

## CI

`.github/workflows/ci.yml` is the only workflow. It runs syntax checks and all unit/integration tests on pushes and pull requests.
