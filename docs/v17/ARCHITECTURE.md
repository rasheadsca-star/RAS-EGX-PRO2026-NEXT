# EGX Pro V17 — Architecture Contract

## Purpose

V17 is a clean, isolated rebuild. The frozen V16.9.2 release remains unchanged on `release/v16.9.2-frozen-20260806`.

## Non-negotiable rules

1. **One displayed decision engine:** `V16_9_EQUAL_WEIGHT_BASKET` until a separately versioned challenger passes the full acceptance gate.
2. **One canonical application snapshot:** `data/v17/current.json`.
3. **One writer pipeline:** `scripts/v17/build-snapshot.cjs` is the only component allowed to produce the canonical snapshot.
4. **No legacy routing:** the V17 UI never reads `v15-practical-decision.json` or `v15-update-status.json`.
5. **Session consistency:** market data, recommendation signal, regime and displayed session must agree or the application enters `BLOCKED_STALE_DATA`.
6. **Immutable signal ledger:** issued baskets are appended to `data/v17/ledger.json`; an existing session cannot be silently replaced.
7. **Honest readiness:** market strength, data quality, model evidence and operational health are shown as separate measures. A strong market score is never presented as professional readiness.
8. **No automatic orders:** all entries remain pending until the opening-range and liquidity checks are confirmed.
9. **Conservative ambiguity:** if target and stop are both touched in one daily candle and intraday order is unknown, the result is treated conservatively.
10. **Fail closed:** critical or major review findings block publication.

## V17 modules

- `scripts/v17/build-snapshot.cjs` — builds the canonical snapshot and appends the immutable ledger.
- `scripts/v17/review.cjs` — independent critic/destructive review gate.
- `preview-v17/app/` — isolated responsive application.
- `data/v17/current.json` — single UI data contract.
- `data/v17/ledger.json` — append-only issued-signal ledger.
- `data/v17/review.json` — latest critic report.

## Acceptance gate

A release candidate is accepted only when:

- critical findings = 0;
- major findings = 0;
- source session equals decision session;
- recommendations contain no duplicates and all price relations are valid;
- total planned exposure is at or below 50%;
- professional claims remain disabled until the live sample and elapsed-time gates pass;
- browser smoke checks and responsive checks pass;
- the frozen V16 branch and current root application are unchanged.
