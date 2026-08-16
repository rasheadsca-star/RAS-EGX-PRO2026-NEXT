# Architecture

## One-way dependency flow

`public UI -> HTTP API -> MarketService -> domain logic -> LsegProvider / Ledger`

The domain layer has no network or filesystem dependency.

## Source of truth

`LsegProvider` is the only market-data adapter. The application does not contain a second live provider, cached public scraper, or HTML parser.

## Fail-closed conditions

The analysis API returns `NO_RECOMMENDATION` when any of these are true:

- licensed credentials missing,
- OAuth token request fails,
- historical-pricing request fails,
- response schema is unexpected,
- a required price field is null/non-numeric,
- latest observation exceeds `MAX_EOD_AGE_HOURS`,
- history span is shorter than `BACKTEST_MIN_YEARS`,
- directional backtest trade count is below `BACKTEST_MIN_TRADES`,
- medium/long horizon requested without verified fundamentals,
- recommendation ledger hash chain is invalid.

## Persistence

The ledger is an append-only JSONL hash chain. For a multi-instance production deployment, replace the filesystem with an append-only database/WORM store while preserving the same hash-chain contract.

## Secrets

LSEG credentials are server-only environment variables. The browser receives source metadata but never receives credentials or bearer tokens.
