# TFE V20 Fusion RC2 — Stability & Red-Team Acceptance

Date: 2026-08-20

## Verdict

**PASS — FROZEN PRODUCTION CORE / VALIDATION SIDECARS ISOLATED**

This acceptance is about software stability, decision-path isolation, reproducibility safeguards, and evidence tooling. It is not a guarantee of future market performance.

## Accepted production runtime

Production URL: `https://egx-tfe-v20-fusion-rc2.vercel.app`

Production source commit remains:

`75aa7bd42c77db8d081278e0279611bc42ab5ec8`

The validation work intentionally did **not** redeploy production because no protected runtime file changed. A redeploy would add operational risk without changing runtime behavior.

## Zero-runtime-drift proof

A GitHub compare from accepted production commit `75aa7bd42c77db8d081278e0279611bc42ab5ec8` to validation head showed only new/modified:

- validation sidecars;
- validation scripts;
- stability contract;
- tests;
- documentation;
- append-only forward evidence;
- package test commands;
- CI audit workflow.

No changes were made to the protected production surface:

- `src/engine.js`
- `src/policy.js`
- `src/confidence.js`
- `src/backtest.js`
- `src/originalScore.js`
- `src/originalIndicators.js`
- `src/math.js`
- `src/quality.js`
- `src/repository.js`
- `api/index.js`
- `public/index.html`
- `public/ui-v169.js`
- `public/styles-v169.css`

## Frozen runtime contract

`stability/frozen-runtime-contract.js` records Git blob SHA-1 values for every protected runtime file, the exact policy object, the accepted recommendation/simulator baseline, and sidecar isolation rules.

`test/stability-contract.test.js` fails if:

- any protected runtime byte changes;
- policy changes;
- execution permissions open;
- a protected runtime module imports sidecar/evidence/validation code;
- the first strict forward evidence snapshot is mutated;
- sidecar rules permit production scan/UI boot influence.

## Current live production acceptance

Live production checks after sidecar implementation returned HTTP 200 for `/health` and `/scan` and still reported source commit `75aa7bd42c77db8d081278e0279611bc42ab5ec8`.

The accepted scan remained:

- session: 2026-08-19;
- scanned: 188;
- technically eligible: 4;
- publication eligible: 3;
- withheld for price reconciliation: 1;
- rank 1: COPR — Fusion 80.7;
- rank 2: FAIT — Fusion 76.5;
- rank 3: MPCO — Fusion 75.7;
- MILS: withheld, conflict 46.7911%, `PRICE_RECONCILIATION_REQUIRED`.

Execution permissions remained fully blocked.

Recent runtime logs for the acceptance requests showed only successful `/health` and `/scan` requests and no sidecar-generated runtime activity.

## Recorded historical simulator baseline

Unchanged accepted baseline:

- symbols completed: 188;
- entered trades: 64;
- T1: 73.4%;
- stop: 18.8%;
- positive: 73.4%;
- average net: +1.23%;
- profit factor: 2.33;
- Wilson 95% lower T1: 61.5%.

These are historical observations, not future probabilities.

## Forward OOS sidecar

`sidecars/forward-evidence.js`:

- freezes recommendations after publication;
- uses SHA-256 signal and snapshot hashes;
- begins entry evaluation only after the signal session;
- retains 3-session entry expiry;
- retains 10-session maximum hold;
- retains 0.60% modeled round-trip cost;
- retains conservative `STOP_FIRST` same-bar handling;
- never invents outcomes for unresolved signals;
- declares `scoringImpact: NONE`.

The first append-only evidence file is:

`evidence/forward/2026-08-19-75aa7bd42c77.json`

Its Git blob SHA is frozen in the stability contract so editing that historical snapshot causes a test failure.

## Official-data verification sidecar

`sidecars/data-verification.js` is reporting-only and accepts an independently supplied official reference. It can report:

- `VERIFIED`
- `CONFLICT`
- `SESSION_MISMATCH`
- `MISSING_OFFICIAL`
- `UNVERIFIED_REFERENCE`
- `INSUFFICIENT_PRICE_DATA`

It explicitly returns `alphaMutationAllowed: false` and `scoringImpact: NONE`.

No undocumented or unstable EGX scraping endpoint was wired into production. The public EGX site is treated as an external source whose stable machine-readable OHLC feed must be established independently before automated official verification is claimed.

## History-depth and long-history validation

`sidecars/history-depth.js` labels coverage honestly and requires at least 500 sessions before calling a symbol suitable for robust regime study.

`sidecars/long-history-validation.js` accepts external multi-year datasets and reuses the frozen RC2 `backtestHistory()` without modifying parameters or production runtime.

No multi-year dataset was fabricated or silently substituted. Multi-year statistical conclusions remain pending until such a dataset is supplied and provenance-checked.

## Regime analysis

`sidecars/regime-analysis.js` provides evidence-only BULL / BEAR / SIDEWAYS segmentation.

`classifyRegimeAtDate()` truncates benchmark history at the signal date before classification, preventing future benchmark leakage. Shorter-than-200-session classifications are explicitly marked `PROVISIONAL_SHORT_HISTORY`.

Regime labels do not enter Alpha, hard gates, Fusion Rank, publication gates, or UI boot.

## Red-team tests added

The new tests cover:

- byte-level critical-runtime freeze;
- exact policy equality;
- execution fail-closed;
- forbidden runtime→sidecar dependency;
- immutable forward snapshots;
- post-signal-only entry;
- `STOP_FIRST`;
- unresolved-forward neutrality;
- official verification reporting-only behavior;
- honest history-depth labeling;
- regime future-row exclusion;
- evidence-only regime segmentation;
- isolated long-history harness with no runtime/parameter mutation.

A targeted independent execution of the sidecar suite before the final long-history test addition passed all executed sidecar checks. The repository CI workflow is also configured to run the full `npm test` suite and a separate `npm run red-team` gate on every relevant push/PR. At the time of this acceptance, the connector did not expose a completed Actions status for the latest documentation/test-only head, so this report does not falsely claim a newly observed GitHub Actions pass.

The last full production build before this sidecar-only work passed 70/70 tests with zero failures; the protected runtime files covered by those tests have not changed.

## Performance protection

No sidecar is imported or called by:

- `/scan`;
- production Alpha modules;
- UI boot.

Therefore the sidecars add no network request, CPU work, or latency to the current production decision path.

## External evidence still required

The software work is complete. Two evidence inputs cannot be manufactured by code:

1. a stable, provenance-verified official EGX OHLC feed/file for automated official-source comparison;
2. a provenance-verified multi-year history dataset for robust multi-regime statistics.

When supplied, existing sidecars can evaluate them without changing RC2 architecture or recommendations.

## Change policy going forward

RC2 remains frozen. New evidence may inform human review, but it must not automatically alter thresholds, Alpha inputs, Fusion weights, recommendations, execution permissions, or Champion status.

Any future protected-runtime change requires a new explicit acceptance cycle and a deliberate replacement of the frozen contract. Validation-sidecar changes alone do not justify a production redeploy.
