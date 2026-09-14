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

A capture at or after the declared next-session open is invalid and cannot be repaired by changing timestamps. Existing snapshots are append-only; edits invalidate the snapshot hash. Once an accepted snapshot for the same reference date is persisted in the append-only ledger, duplicate recapture is skipped.

### Trading-calendar guard

A field named `sessionDate` in an upstream source is treated as a **source-declared reference date**, not proof that EGX traded on that date. The ledger must not relabel a holiday, exchange closure, weekend, or otherwise unverified date as a market session. Outcome evaluation starts at the first observed market bar strictly after the frozen reference date, and the preregistered next-session-open timestamp remains the anti-backfill boundary.

For the first observation, upstream V16 declares `2026-08-27`, but EGX announced that Thursday 27 August 2026 was a market holiday and that work would resume Sunday 30 August 2026. Therefore this date is preserved as an upstream reference date rather than described as a 27-Aug trading session.

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

## Meta Shadow measurement

Two different shadow questions are measured and must not be mixed:

- **READY/BUY cohort:** if Meta later emits READY or BUY on a V16 primary signal, the same frozen V16 outcome is measured for that admitted cohort.
- **NO_TRADE veto cohort:** when Meta emits NO_TRADE on a V16 primary signal, its counterfactual abstention value is measured as `avoided V16 loss - missed V16 gain`. A positive veto benefit means abstention avoided more loss than gain; a negative value means it discarded more gain than loss. This is a veto/abstention diagnostic, not alpha.

Neither measurement grants positive weight, production authority, automatic promotion, or permission to retune after seeing the result.

## Source-quality attribution guard

Operational forward evidence and algorithmic attribution are not the same thing. For each frozen observation, required source reference dates are compared with the frozen signal reference date before interpreting the outcome:

- `ALIGNED`: source reference date equals the frozen reference date.
- `STALE_REFERENCE_DATE`: source is older. The observation remains valid as evidence of what the live shadow actually did, but it is **not eligible for clean algorithmic attribution**.
- `FUTURE_REFERENCE_DATE`: explicit look-ahead. The observation is invalid for forward attribution and evaluation must fail rather than continue.
- `UNKNOWN_REFERENCE_DATE`: degraded input attribution; no clean algorithmic credit or blame.

The first frozen observation already records V16, Regime and Triple on `2026-08-27`, while V20 is frozen on `2026-08-16`. Therefore its Meta result is legitimate **operational shadow evidence under degraded inputs**, but cannot by itself be used to credit or blame the Meta algorithm as if all engines were synchronized.

## First immutable evidence anchor

The first accepted snapshot was frozen before the next EGX open with these identifiers:

- source reference date: `2026-08-27` (holiday/reference date, not a trading-session claim);
- next actual trading session: `2026-08-30`;
- captured at: `2026-08-29T15:33:25.551Z`;
- source commit: `012c9245542a014d104c1f819cc57bd17a7c27fa`;
- snapshot SHA-256: `4f7c9006e4c631d56105063fc0a861565c73a4e127a61303351fd4fa2e25f7af`;
- policy SHA-256: `0c04f096c1c6e28acea2f37506b8b8c77837c6d75e5f7018ab93b038dedd6d83`.

This anchor records evidence only; no outcome had been observed when it was captured.

## Promotion gate

No challenger receives positive alpha weight from one session or a small forward sample. Forward observations first accumulate without retuning. Any later promotion proposal must be a separate preregistered decision using the untouched ledger and must compare against V16 under identical entry, holding, cost, stop-first, liquidity, and missing-data rules. Evidence affected by stale/unknown required sources may be retained for operational robustness analysis but cannot be silently counted as clean algorithmic promotion evidence.

## Operational locks

`researchOnly=true`, `scoringImpact=NONE`, no automatic orders, no automatic promotion, no merge or deployment implied by ledger creation. PR #68 remains a Draft research vehicle until separate acceptance.
