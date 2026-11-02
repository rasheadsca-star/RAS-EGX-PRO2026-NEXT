# EGX PRO — Real-source ingestion validation, 2026-11-03

**Authority:** Research only. NO_STRATEGY_APPROVED. This document does not approve any ticker mapping or trading strategy.

## Actual supplied official EGX PDFs inspected offline
- 2026-11-01 bulletin: 1525x1078 page geometry, 228 stock rows (215 MAIN + 13 SME). Of these, 35 rows have an internally inconsistent open/high/low/close relationship and must be quarantined, not repaired or silently accepted.
- 2026-11-02 bulletin: 1539x1088 geometry, 231 stock rows (218 MAIN + 13 SME), 222 EGP + 9 USD. 16 rows have inconsistent OHLC (11 EGP + 5 USD). The remaining **211 EGP rows** are eligible for *identity review*, not automatically eligible for trading.
- The November 1 report has one final stock row on a page followed by a multi-ISIN company table. The old parser missed that final record. The corrected parser explicitly recognizes the stock table header and isolates the rank/currency/column geometry.
- Source reports originally stored under `DiscDoc_ID1022_01-Nov-2026_ENG.pdf` and `DiscDoc_ID1022_02-Nov-2026_ENG.pdf`; they are not committed to this public repository.

## Identity mapping and scope change
- The *older* local matching flow reported **143 provisional mappings**. These are NOT 143 verified ticker identities.
- The stricter current resolver intentionally refuses provisional prior-day closes and past `RESOLVED_SCORE` official-session names as standalone mapping authority.
- An offline rerun on the supplied November 1 SQLite baseline + November 2 PDF yielded **128 PROVISIONAL_NAME_PREVCLOSE**, **83 QUARANTINED_NAME_OR_AMBIGUITY**, **11 QUARANTINED_OHLC**, **9 QUARANTINED_NON_EGP**. Sum: 231. These figures supersede 143 for this *strict-mode run*, and may change upon independent official ISIN validation.
- Compared with the 110 old Nov 2 confirmed-name/previous-close mappings: 98 overlap, 12 old mappings are conservatively withheld, and 30 new proposals exist. The 12 withheld are *not* necessarily incorrect; their evidence does not pass current thresholds.
- Do not weaken the resolver merely to reach a prior reported count of 145.

## Independent source-continuity spot-check
- 30 evenly spaced ticker-sorted records, selected deterministically from 110 prior accepted Nov 2 records, were joined against Nov 1 source rows.
- 30/30 prior-close implied-price checks pass within 0.7%; **maximum deviation 0.00511%**. Raw company-name similarity minimum 0.7722.
- These checks validate numerical source continuity, *not* independent ticker/ISIN identity. Keep symbol identity UNVERIFIED until independent official reference confirms.

## Fail-closed market consequences
- `PROVISIONAL_SYMBOL_IDENTITY` bars are ineligible for stock rankings or paper scenarios and are included in a visible research-source warning.
- If a current-session bar is provisional, market regime is UNKNOWN. Neither CASH nor IN_MARKET can be presented as a trustworthy aggregate for that session.
- No public GitHub repo assets may be used as private SQLite backup. Existing repo visibility PUBLIC (checked GitHub metadata).
- Do not promote to main or Vercel production; do not claim live availability from a Vercel READY state alone.

## Testing
- Feature PR: https://github.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/pull/198
- CI workflow result for parser and isolation guards: https://github.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/actions/runs/41541842804 (SUCCESS, unit + browser).
- Real-PDF parsing checks were run locally on user-supplied PDFs. The synthetic GitHub unit tests do not prove ongoing future EGX website access, 2-session scheduled EOD processing, or licensed source integrity.

## Remaining acceptance gates
- [ ] Independent, dated official ISIN/ticker dictionary and approval of mapped identities.
- [ ] Permanent storage with immutable base+deltas, verified restore, rollback; external owner approval.
- [ ] EOD GitHub workflow on main, two real scheduled sessions with artifact and error notifications.
- [ ] Full deployment preview and externally GET-verified session/HTML/snapshot hashes.
- [ ] Independent fees/tick-size reference and positive frozen walk-forward / holdout strategy performance.
