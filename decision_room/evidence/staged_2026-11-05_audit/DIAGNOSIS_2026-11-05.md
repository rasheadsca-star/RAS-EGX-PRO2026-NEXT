# Diagnosis — CAED, EXPA, PRMH, AJWA, MTIE/MMAT (staging DB, research only)

## MTIE / MMAT (owner decision)
- MMAT: official bars kept (identity_review status OWNER_ACCEPTED_KEEP).
- MTIE: legacy official bars of 2026-11-01 and 2026-11-02 kept untouched (RAW unchanged), status **LEGACY_IDENTITY_PENDING_REVIEW** (table identity_review). Audit against the official bulletin pages: both bars match bulletin rows (p22 #132 and p20 #93) — OHLC identical, name similarity 1.00 to the MTIE registry name vs 0.18 to MMAT, implied previous close equals the MTIE previous close (gap 0.00% and 0.004%). ISIN: NOT_AVAILABLE_IN_ANY_INPUT (none invented). The evidence supports the identity; closing the review is the owner's call.
- Guard: `official_map.IDENTITY_GUARD` — fuzzy matching never proposes/applies MTIE or MMAT; an alias link to either is refused unless the bulletin name is clearly closer to its own registry name than to the sibling's; `build_staged.py` refuses approvals for them. 5 bulletin rows moved from PROPOSED_FUZZY_NEEDS_APPROVAL to QUARANTINED_GUARDED_IDENTITY; no bar changed.

## CAED — JUMP (+20.00% on 2026-11-03)
- The move is in the OFFICIAL bulletin (open 82.70, low 83.00, high=close 99.24, change +20.00%, 698,226 shares ≈ 7x its usual volume, 2,538 trades; price × listed shares = 99.24 × 12,000,000 = 1,190,880,000 = the bulletin's market cap). Not a parsing or mapping error.
- Same sessions: Tycoon, Grand Investment Capital, El Kahera El Watania (3-Nov) and Tycoon, El Arabia, Odin fund (4-Nov) are at +19.98…+20.00% too, so the bulletin shows several stocks moving ~20% — the price-limit schedule is NOT in the bulletin, so the limit cannot be proven from it.
- No corporate event for CAED in the 3/4-Nov Corporate Actions pages (none matched by name). 
- The window also holds −15.8% (25-Oct) and +15.0% (27-Oct) on corroborated NON-official bars.
- Result: the gate JUMP (>11%) stays — it is a real, officially recorded move, and loosening the gate was not authorised. A limit-aware gate would need the official price-limit schedule.

## EXPA — CONFLICT (11 dates) and JUMP
- All 11 conflicts are Mubasher vs Yahoo. 7 of them (28-Sep…6-Oct) differ by a constant factor: Yahoo/Mubasher = 0.7559 (0.7556–0.7573). On 7-Oct both providers agree at 15.82 and the series drops −26.4% from 21.50 (6-Oct).
- Reading: an event on ~7-Oct (consistent with a bonus/split-type action) that Yahoo back-adjusts and Mubasher leaves RAW. The conflicts are a basis mismatch, not random candle errors; the other 4 conflicts (1-Sep, 10-Sep, 24-Sep, 14-Oct) are 0.6–1.9% single-day provider disagreements.
- No official corporate-event record for EXPA exists in the inputs (official pages only 29-Oct…4-Nov) and no price_factor was invented. Result: remains BLOCKED (CONFLICT + JUMP); needs the official corporate-action notice for early Oct 2026.

## PRMH — CONFLICT (1) and JUMP
- Conflict: only 2026-08-31 (Mubasher 2.72 vs Yahoo 2.65, −2.57%), single day.
- JUMP: 12-Oct 2.09 → 13-Oct 1.86 (−11.0%), then +8.6%, −8.9%, +9.7% (14/18/19-Oct). Both providers agree on each of these bars, but agreement of two public providers is not official confirmation; −11.0% exceeds 10%. No official bulletin exists for those dates.
- Result: remains BLOCKED; cannot be resolved with available evidence.

## AJWA — stop-loss bar 2026-10-26 (close 195.41)
- Only source: Mubasher (S1_MAIN_HISTORY; the V16 file's "volume-statistics date match" is another Mubasher page, not an independent source). Yahoo ledger has no AJWA observations; no official bulletin for 22–28 Oct. The 29-Oct bulletin anchors 28-Oct (previous close 200.88), not 26-Oct.
- Not provable → paper stop, T1 and T2 are WITHHELD in ranking.csv/json (`paper_levels_status=WITHHELD_STOP_BAR_2026-10-26_SINGLE_PROVIDER_UNVERIFIED`); candidates are kept only as `*_candidate_untrusted` fields and the chart note says so. The same rule applies to every ranked/watchlist stock (stop bar must be OFFICIAL or corroborated by 2 providers).
