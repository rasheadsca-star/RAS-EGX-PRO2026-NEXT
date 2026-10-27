# EGX 27 October 2026 — Source-to-certification drift audit

Read from **main** after the local gate unit tests. This is an observation, **not** a re-run of G09/G11 and **not** a production-price promotion.

| Evidence | Value |
|---|---|
| Price-truth file | `data/stable/v15-price-truth.json` |
| Price-truth generatedAt | `2026-10-27T15:57:26.576Z` |
| Price-truth expectedSession | `2026-10-27` |
| Accepted / rejected rows | 193 / 21 |
| Updated history files | 172 |
| Missing history files | 21 |
| G11 metrics file | `docs/astra/G11_DATA_HEALTH_METRICS.json` |
| G11 latestExpectedSession | `2026-09-17` |
| G11 active / canonical / pipeline-ready | 224 / 213 / 211 |

Current source-to-G11 session equality: **FALSE**. The latest price-truth file is newer than the persisted G11 evidence. No production eligibility can be inferred from earlier G11 metrics.

Missing history tickers in current price truth:
BONY, TANM, VLMRA, KORA, UBEE, KRDI, AIHC, AIDC, QNBE, GGRN, GPIM, DGTZ, VLMR, VALU, TAQA, ACAP, NAPR, NARE, TYCN, CRST, ACTF.

Next acceptance actions:
1. Pin a single immutable market-session commit; reconcile the intended universe and all per-ticker actual price-source states.
2. Obtain identity-verified, session-specific OHLCV with vendor/official parity for gaps; quarantine unresolved records. Historical archive graphics do not count as certified prices.
3. Rebuild G11 indicators against this pinned canonical source and re-run the G09 snapshot.
4. Re-run full Astra gate suite and destructive reviews; preserve timestamped runner logs and CI artifacts.
5. Test order placement, fills, limits and cash/position ledgers in independent paper mode before enabling any execution.

**Current gate: BLOCKED. Paper-trading execution: NOT AUTHORIZED.**
