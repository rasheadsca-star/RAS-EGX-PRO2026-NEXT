# EGX USD-traded share-class currency parity | 2026-10-27

Research and identity-metadata correction only. Source provenance is **NOT** an official EGX end-of-day OHLCV record.

## Affected securities
- `GTEX.CA`: mapped `currency: EGP` was contradicted by Mubasher's **Trading Currency US Dollar** label.
  Public page: https://english.mubasher.info/markets/EGX/stocks/GTEX/
  EGX-sourced corporate filing with USD currency shown via Sigma:
  https://www.sigma-capital.com/main/news_page_exact?newsId=45928535&newsType=EGX
- `VLMR.CA`: mapped `currency: EGP` was contradicted by Mubasher's **Trading Currency US Dollar** label.
  Public page: https://english.mubasher.info/markets/EGX/stocks/VLMR
  Investing reference lists VLMR USD and separate VLMRA EGP:
  https://ca.investing.com/equities/egypt-kuwait-holding-related-indices
- `VLMRA.CA`: EGP-denominated separate share class remains unchanged:
  https://english.mubasher.info/markets/EGX/stocks/VLMRA

## Contract
This changes ONLY `data/symbol-map.json` currencies for GTEX/VLMR from EGP to USD.
It does **not** assert authoritative ISIN or point-in-time listing status, does **not**
mark `symbolVerified` true, does **not** overwrite price history, and does not affect
recommendation or trading eligibility by itself. The historical Yahoo adapter now
checks a USD response against the correct mapped currency, still requiring exact
ticker and EGX exchange evidence and all other eligibility checks.

## Remaining authoritative checks
Before any historic candle is promoted, obtain dated ISIN and security class, current
EGX listing status, original unadjusted OHLCV in the right trading currency,
corporate-action history and an independent exact-session price source.
