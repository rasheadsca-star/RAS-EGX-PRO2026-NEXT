# EGX Pro V17 — Build, Critic and Repair Log

## Preservation baseline

- Frozen release branch: `release/v16.9.2-frozen-20260806`
- Frozen commit: `2351b2ec2bbcf3e36e992021e26b36845e879ab0`
- V17 work branch: `develop/v17-rebuild`
- Root launcher, V16 application, service worker, manifest and stable V16 engines are protected by a workflow diff gate.

## Cycle 1 — Structural rebuild

### Consulting/design team work

- Created an isolated V17 application and data namespace.
- Introduced one canonical UI snapshot: `data/v17/current.json`.
- Locked the displayed production engine to `V16_9_EQUAL_WEIGHT_BASKET`.
- Added an append-only signal ledger.
- Separated market strength, data quality, live evidence and operational integrity.
- Added market search, position sizing, portfolio cash policy and source lineage.

### Critic/destructive review focus

- Multiple-engine conflicts.
- Stale or mismatched sessions.
- Invalid entry/target/stop relationships.
- Excess exposure and weight redistribution.
- Hidden automatic orders.
- Legacy file references.
- Responsive and accessibility failures.

### Result

- Critical: 0
- Major: 0
- Minor: 0
- Verdict: `NO_COMMENTS`

## Cycle 2 — Evidence and data honesty

### Critic findings discovered outside the first automated scope

1. The original evidence display could mix old engines with V17 readiness.
2. Data quality did not penalize polluted company names or incomplete OHLC rows.
3. There was no native V17 next-session outcome resolver.
4. A basket weighting fallback could produce zero sleeve return when basket weights were absent from the immutable payload.
5. Full historical equity curves made the canonical snapshot unnecessarily large.

### Repairs

- Added `scripts/v17/resolve-ledger.cjs` with conservative target/stop ambiguity handling and 0.60% costs.
- Added native V17 evidence gates: 30 resolved baskets, 100 resolved members and 90 observed calendar days.
- Marked legacy V16.9 evidence and historical research with explicit non-live provenance.
- Recalculated data quality using price, OHLC and clean-name coverage.
- Fixed normalized basket weighting fallback.
- Removed full equity curves from the canonical snapshot.
- Added a prominent hot-momentum warning and opening confirmation rules.

### Result

- Critical: 0
- Major: 0
- Minor: 0
- Verdict: `NO_COMMENTS`

## Cycle 3 — Deployment and preservation

### Critic focus

- Accidental modification of the current V16 application.
- Publishing V17 over the root URL.
- Releasing without a no-comments review file.
- Daily operation without outcome resolution.

### Repairs

- Added a branch comparison gate against the frozen V16 branch.
- Restricted V17 deployment to `/preview-v17/app/`.
- Required resolver, snapshot builder, critic and browser smoke checks before deployment.
- Added scheduled post-close rebuilds on trading days.

### Result

- Frozen V16 files unchanged.
- V17 remains isolated.
- Critical: 0
- Major: 0
- Minor: 0

## Cycle 4 — Responsible performance improvement

### Critic focus

- Changing the successful method after one good or bad session.
- Selecting a challenger on the current session.
- Improving headline return while worsening drawdown or transaction-cost realism.
- Automatic replacement of the champion.

### Repairs

- Added `scripts/v17/challenger-gate.cjs`.
- V16.9 remains the active champion.
- A challenger must use blocked walk-forward testing with an independent holdout.
- It must exceed the champion's average net return by at least 0.15 percentage points, while not worsening profit factor, winning-session rate or maximum drawdown.
- It must include at least 0.60% trading costs and prohibit future leakage.
- Passing the research gate only permits a separate versioned release review; automatic promotion is forbidden.

## Release rule

V17 may be merged and deployed only when the latest `data/v17/review.json` reports zero critical, major and minor findings. Better investment performance is never claimed until the native V17 live-evidence gate passes.
