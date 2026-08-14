# V20 Phase 3 — Analytical Truth, Immutable Signals, and Decision UI

## Purpose

Phase 3 keeps the integration isolated to `develop/v20-integrated-decision-platform` and extends the governed data contract into the analytical and user-experience layers without changing the frozen V16 Champion, V17 governance branch, V19 research branch, or `main`.

## Risk / Reward audit

V20 now treats `CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS` as the primary displayed R/R metric. For the current long-only scope, risk math uses the high end of the entry range and the central 0.60% round-trip transaction-cost policy.

Legacy R/R values from the pre-existing opportunity ranking are retained for audit only. Their exact price reference/formula is not assumed. Material differences are flagged explicitly in `data/v20/risk-reward-audit.json`.

## Stock analytical profile

`data/v20/stock-profiles.json` provides one governed profile per V20 opportunity with:

- current session and status;
- current market snapshot fields;
- opportunity score clearly separated from confidence;
- independent market/data/model/execution confidence dimensions;
- support/resistance provenance, confidence, freshness/session alignment and execution eligibility;
- liquidity eligibility;
- conservative entry/stop/targets and cost-aware R/R;
- structured `whyThisStock` strengths and blockers;
- source/provenance fields.

Technical indicators such as RSI, MACD, ATR, SMA and EMA are intentionally left null until a verified point-in-time daily OHLC history adapter is wired to V20. The system does not manufacture indicators from a single current-session snapshot. Sector context is likewise not inferred without a verified classification source.

## Immutable signal archive

`scripts/v20/archive-signal.cjs` creates a daily immutable signal file under `data/v20/signal-archive/`.

The immutable signal hash is intentionally calculated only from issued decision fields:

- session date;
- active Champion;
- execution status;
- portfolio risk state/exposure/cash;
- ticker/status/entry/stop/targets/applied position weight.

New analytical/profile fields therefore do not alter the hash of an already issued signal. An existing archive file is never overwritten. A hash/core collision fails closed.

`data/v20/forward-evaluation.json` creates separate pending 1/3/5/10/20-session evaluation horizons. It contains no fabricated future returns; resolution must occur later from point-in-time evidence.

## V20 decision UI

The first isolated V20 UI lives under `v20/` and is Arabic-first RTL. It consumes only V20 governed evidence files and exposes:

- global execution/research status banner;
- coverage/freshness/critical-field quality;
- applied exposure and cash;
- market opportunity search and status filters;
- conservative Net R/R as the primary R/R column;
- stock-detail dialog with Why This Stock, trade plan, support/resistance, confidence dimensions and provenance;
- source-health and Champion/Challenger governance panels;
- explicit legacy R/R audit warning;
- responsive layouts for 1024/768/430/390 breakpoints and reduced-motion support.

This phase includes static UI contract validation. Pixel-level browser verification remains a separate acceptance step and must not be claimed until performed.
