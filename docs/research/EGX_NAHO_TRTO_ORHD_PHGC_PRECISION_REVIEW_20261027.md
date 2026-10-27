# EGX identity / fractional-price / corporate-action review (27 Oct 2026)

## Certified mapping-only change

NAHO and TRTO were listed in `data/symbol-map.json` as `EGP`. The companies' EGX-traded
shares are quoted in **USD** by direct Mubasher issuer security pages and October 26 Investing daily historical datasets:

- NAHO, ISIN EGS69182C011, USD: https://english.mubasher.info/markets/EGX/stocks/NAHO/
  https://www.investing.com/equities/naeem-hold.-historical-data
  2026-10-26 close **0.124 USD** (research evidence, not licensed imported row).
- TRTO, ISIN EGS79072C012, USD: https://english.mubasher.info/markets/EGX/stocks/TRTO/
  https://sa.investing.com/equities/transoceans-to-historical-data
  2026-10-26 close **0.056 USD** (research evidence, not licensed imported row).

Mapped `currency` was changed to USD for NAHO and TRTO ONLY. No quoted OHLCV is imported,
no existing historical files altered, `symbolVerified` remains false and G11 remains blocked
until the exact-session source, ISIN, trading currency and corporate-action checks pass.

## Extra rejection explanations discovered — no price promotion

### PHGC precision

The frozen main market feed reported rounded `PHGC` close **0.07 EGP** on Oct 26;
Investing.com and MarketScreener show **0.074 EGP** and volume **155,008,834**.
A 0.004 price difference is **5.4% of the true displayed 0.074**, far too large
to waive on a simple percentage-change rounding envelope. Therefore source precision,
not a wide price-change tolerance alone, must be corrected.
Sources:
https://www.investing.com/equities/city-lab-historical-data
https://www.marketscreener.com/quote/stock/PREMIUM-HEALTHCARE-GROUP-195246907/

### ORHD corporate action

Public copy of the EGX listing-committee notice states that **2.2288508184 bonus
shares per original share** became effective on **7 October 2026**, corresponding to
a post-action shares-per-original ratio **3.2288508184**. As a result, an older
unadjusted pre-action close around 38.81 must **not** be compared directly with
post-action October 26 prices near 9 EGP.

However, the immutable main source for October 26 lists ORHD 9.26 while independent
Investing/StockAnalysis historical pages show 9.17. The circa 1% quote difference
still exceeds the intended 0.5% parity tolerance. DO NOT replace the canonical price
with either value until certified exact-session EOD/source consistency is resolved.

Sources:
https://www.arabfinance.com/ar/news/newdetails/48415
https://www.investing.com/equities/orascom-hotels-and-development-historical-data-splits
https://stockanalysis.com/quote/egx/ORHD/history/

## Required engineering follow-up

1. Obtain right-licensed unrounded OHLCV (including 3- or 4-decimal penny prices)
   for PHGC, NAHO and TRTO and independent session-identical source.
2. Obtain signed ORHD bonus issue/capital action reference and create **separate**
   reviewed factor lineage; never silently rewrite historic closes or decide profit using split jumps.
3. Verify the G11 history, indicators and out-of-sample paper performance after event-aware rebuilding.

These are research findings. They do not change execution eligibility.
