# EGX Independent Historical Recovery — Research Hub

This independent subsystem **does not write** to canonical \`data/history/\`, stable price truth,
Astra/G09/G11, orders, or any recommendation ledger.

## Purpose

Recover historical OHLCV evidence across old project versions and available market sources,
without confusing *archive depth* with current-session legal executable truth.

### Checked archives

1. Current \`data/history/*.json\`; 100-session and 50-session historical inventory metadata.
2. Legacy \`RAS-EGX-PRO2026\` checked out into \`sources/legacy-ras-egx-pro2026\`.
3. Earliest \`RAS-EGX0.1\` checked out when available.
4. V17 staged long-history Yahoo archive if it exists locally; **not corporate-action certified**.
5. Follow-on inventory: \`docs/astra/HISTORICAL_STORES.json\` lists 19 legacy stores,
   including quant feature stores and old decision/ledger evidence. Derived indicators and
   historic paper ledgers **are not raw OHLCV** and must not be used as invented candles.

No external archive is assumed to be present or trusted; checkout failures appear in
\`sources[].available=false\`.

### Public-source network staging

The scheduled research job probes:
- [Egyptian Exchange](https://www.egx.com.eg/): **official reference** only unless a
  documented dated row and source identity can be extracted and verified.
- [Mubasher Egypt EGX stock pages](https://english.mubasher.info/markets/EGX):
  secondary delayed prices; a page returning HTTP 200 is **not** evidence of a historical session.
- Yahoo Finance \`.CA\` chart via the existing \`yahoo-history-adapter.cjs\`:
  candidate historical OHLCV for source comparison only, with symbol/exchange/currency
  matching and adjustment provenance.

All fetching is read-only and bounded; respect source terms and rate limits. No
authorization bypass, HTML scraping assertion, or automatic promotion.

### Outputs (artifact only)

- \`inventory.json\`: current vs older archive coverage per ticker and expected session.
- \`candidate-ledger.json\`: legacy-only research gap rows with provenance and hashes,
  conflicting quotes, identity quarantine.
- \`source-probes.json\`: source availability status (not price authority).
- \`yahoo-stage/<TICKER>.json\`: unapproved candidate OHLCV.

The scheduled workflow is active **only if merged to the default branch**. On the research
branch it runs for the branch's push and publishes GitHub Actions artifacts; it does not push
any recovered candle into production.

## Promotion checklist — separate owner-reviewed change

An archived/externally collected candle must be checked for point-in-time identity,
real EGX session calendar, non-reconstructed OHLCV, independent source agreement or official
dated evidence, security splits/corporate actions and unit continuity. A 100-session history
store may aid technical training, but cannot certify the expected session by itself.

Blocked current-session data is not retroactively fabricated using tomorrow's quote.
Promotion must be a separate PR with line-level evidence, reproducible merge-diff,
G11/G09 diagnostics, hold-out backtest and owner authorization.

## Run

\`\`\`bash
node --test tests/research/egx-independent-history-recovery.test.cjs
EGX_RECOVERY_OUT=/tmp/recovery node scripts/research/egx-independent-history-recovery.cjs
EGX_RECOVERY_OUT=/tmp/recovery EGX_RECOVERY_SYMBOLS=BONY,TANM,KRDI,CEFM \
  node scripts/research/egx-independent-source-probes.cjs
\`\`\`

The network probe is optional, and it is normal for EGX or a Yahoo symbol to deny or lack
an accessible historical dataset. **No evidence is invented to achieve quota.**
