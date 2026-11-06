# Before / after the correction (2026-11-05)
| Item | Before | After |
|---|---|---|
| official_session rows 2026-11-01 | 456 (two sets) | 228 |
| official_session rows 2026-11-02 | 460 (two sets) | 230 |
| Evidence deleted | — | 0 (458 legacy-parse rows archived (228+230) in `official_session_legacy_parse`, reason DUPLICATE_SET_OLD_PARSER_MARKET_SPLIT) |
| Legacy-resolved tickers absent from active set | — | 12 (1 Nov) + 3 (2 Nov); their OFFICIAL bars remain in canonical_bars, evidence kept in the archive |
| RAW bars / stocks / sessions | 425,199 / 201 / 2,489 | 425,199 / 201 / 2,489 (unchanged) |
| Qualified (ranked+watchlist) | 9 (1+8) | 9 (1+8); symbols_status rows changed: 0; ranking.csv byte-identical; snapshot sha256 92d9ec24… unchanged |
| Fuzzy matches applied | 0 | 0 (still owner approval; see proposals_review.csv: 12 HIGH recommended, 5 HIGH on HOLD: ADIB, AMOC, CIEB, CLHO, EDFM) |
Duplication did not affect ranking or coverage counts (those come from canonical_bars); it affected only official_session statistics.
