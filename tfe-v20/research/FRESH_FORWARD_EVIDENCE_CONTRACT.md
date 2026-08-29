# Fresh Forward Evidence Ledger — Frozen Contract V1

Status: research-only. This contract gives no production authority, does not alter V16.9 ranking, and does not assign positive alpha weight to any challenger.

## Why this ledger exists

Retrospective rule-mining is stopped. Breadth V1 did not clear its frozen drawdown gate, and the apparent GEOMETRY loss family is not independent because entry width, stop distance, and target distance are algebraically derived from the same ATR construction. The next admissible evidence class is therefore fresh, point-in-time, pre-outcome evidence.

## Immutable capture rule

Each accepted record must be created after the signal snapshot exists and strictly before the next EGX session opens. The record must contain:

- the source-declared signal/reference date;
- an explicit date semantic stating that the source-declared date is **not automatically assumed to be a real trading session**;
- market-calendar context when known, including holiday/closed status and the next trading-session date;
- UTC capture timestamp and the declared next-session-open timestamp;
- exact research-branch source commit SHA;
- source URLs plus SHA-256 digest for every fetched source;
- full V16 recommendation geometry needed for later evaluation;
- same-reference-date Meta Shadow rows and decisions;
- the frozen evaluation policy and its policy hash;
- one snapshot hash covering the complete payload, including the market-calendar context.

A capture at or after the declared next-session open is invalid and cannot be repaired by changing timestamps. Existing snapshots are append-only; edits invalidate the snapshot hash.

### Trading-calendar guard

A field named `sessionDate` in an upstream source is treated as a **source-declared reference date**, not proof that EGX traded on that date. The ledger must not relabel a holiday, exchange closure, weekend, or otherwise unverified date as a market session. Outcome evaluation starts at the first observed market bar strictly after the frozen reference date, and the preregistered next-session-open timestamp remains the anti-backfill boundary.

For the first intended observation, upstream V16 currently declares `2026-08-27`, but EGX announced that Thursday 27 August 2026 was a market holiday and that work would resume Sunday 30 August 2026. Therefore this date must be preserved as an upstream reference date rather than described as a 27-Aug trading session.

## Frozen outcome policy

The policy is fixed before observing the forward outcome:

1. Entry may occur on the **next actual market session only**. No delayed entry on session 2 or 3.
2. Entry uses the frozen V16 entry zone. A gap below the entry zone is not filled advantageously.
3. Maximum holding period is **3 observed market sessions**, including the entry session.
4. Round-trip transaction cost is **0.60%**.
5. If target and stop are both touched in the same daily bar, score **STOP_FIRST**.
6. If neither target nor stop resolves by the third observed session, exit at that session's close.
7. Missing future bars remain unresolved; they are not converted to zero return.
8. `NO_ENTRY_NEXT_SESSION` is recorded as no entry, not silently re-entered later.

## Streams frozen at capture

- **Champion:** V16 recommendations are preserved exactly as published. Primary recommendations are the champion benchmark cohort; conditional/reserve names remain recorded for diagnosis but are not silently promoted into the primary basket.
- **Meta Shadow:** Meta decisions are attached to the same frozen V16 names as a zero-authority shadow cohort. A positive historical-looking split does not grant weight.
- **Sources:** source digests, source-declared dates, generation timestamps when available, calendar context, and research-branch SHA are stored for auditability.

## Promotion gate

No challenger receives positive alpha weight from one session or a small forward sample. Forward observations first accumulate without retuning. Any later promotion proposal must be a separate preregistered decision using the untouched ledger and must compare against V16 under identical entry, holding, cost, stop-first, liquidity, and missing-data rules.

## Operational locks

`researchOnly=true`, `scoringImpact=NONE`, no automatic orders, no automatic promotion, no merge or deployment implied by ledger creation. PR #68 remains a Draft research vehicle until separate acceptance.
