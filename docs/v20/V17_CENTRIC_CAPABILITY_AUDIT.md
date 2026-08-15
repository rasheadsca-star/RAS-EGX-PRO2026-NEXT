# V20 V17-Centric Capability Audit

Status: IMPLEMENTATION BASELINE
Branch: `develop/v20-integrated-decision-platform`
Audit date: 2026-08-15

## Architectural rule

- V16 remains the frozen production Champion benchmark: `V16_9_EQUAL_WEIGHT_BASKET`.
- V17 is the authoritative production decision, data-truth, eligibility, and execution backbone.
- V20 Native remains the full-market independent discovery and research-ranking engine.
- V19 remains shadow/research only.
- V21 concepts are used selectively only where the integration directive specifies them. No V21 source branch/repository was discoverable during this audit, so no V21 source behavior is assumed or invented.

## Capability map

| Capability | Current V20 | V17 source | V21 reference | Final owner | Action |
|---|---|---|---|---|---|
| Full EGX discovery universe | 227-name independent master/full-market universe; Legacy contribution 0% | V17 recommendation base is current-session oriented, not the discovery owner | None required | V20 Native | KEEP |
| Native technical evidence | Trusted point-in-time technical history, identity/current-session/price reconciliation, no synthetic OHLC | V17 consumes existing technical-50/current recommendation methodology | None required | V20 Native | KEEP |
| Native ranking | `V20_FULL_MARKET_NATIVE_SELECTION_V1`; accepted runtime includes safety-strength exact-score tie-break V2 | Must not override V17 eligibility/execution | Model-freeze concept from directive | V20 Native research | KEEP + FREEZE; materialize accepted runtime behavior into Git without retuning |
| Legacy seed influence | Explicit comparison only; scoring contribution 0% in full-market Native | Not applicable | None | V20 Native | KEEP |
| Market session truth | V20 consumes V17 evidence but persisted copies can lag authoritative V17 | `market-session-truth`, source-verified session chain | None | V17 | PORT authoritative outputs via runtime sync |
| Data truth / quality | V20 data-truth layer exists | V17 resilient gate owns coverage/freshness/critical-fields/session truth | None | V17 semantics inside V20 contract | MERGE; V17 production eligibility is authoritative |
| Recommendation methodology | V20 currently has research scoring/challengers, but not a canonical V17 per-stock recommendation eligibility layer | `V17_CURRENT_SESSION_TECHNICAL_BASE_1`, existing technical-50 methodology, current-session price, no stale legacy confidence/plan | None | V17 Decision Core | PORT exact source outputs/semantics; do not invent a new recommendation formula |
| Liquidity | V20 Liquidity 2.0 research enrichment | V17 exact V11.1 gate: current 5M, avg20 2M, execution score 65; conditional 1M/45; history before verified session | None | V17 eligibility + V20 enrichment | MERGE; V17 decides eligibility, V20 enrichment remains research-only |
| Support / Resistance | V20 multi-method confluence: pivot/swing/ATR | V17 internal OHLC pivot + provenance/session/freshness/confidence + external validation; fail-closed execution readiness | Directive asks strongest validated V17+V20 merge | V17 eligibility, V20 research enrichment | MERGE |
| Technical eligibility | V20 has trusted technical readiness | V17 current recommendation base reuses technical-50 rather than inventing strategy | None | V17 production eligibility | MERGE; preserve V20 evidence quality, preserve V17 semantics |
| Corporate-action safety | Not a canonical per-stock V20 production eligibility field | Must be represented as an explicit V17 production blocker when authoritative evidence says unsafe | None | V17 Decision Core | ADD canonical field/reason; fail closed when authoritative state is unsafe/unknown where required |
| Price validity | V20 reconciles technical source close/current market price | V17 requires verified session/price chain; finalizer blocks execution when chain is not valid | None | V17 Decision Core | MERGE |
| Trade plan | V20 evidence-derived entry/stop/target/Net R:R with 0.6% round-trip costs and DO_NOT_CHASE | V17 execution permission is conditional on trusted current-session decision inputs | None | V20 plan + V17 validation | MERGE; Native plan cannot create execution permission |
| Global execution gate | Existing V20 respects V17 `executionGrade` | V17 resilient status + executionGrade authoritative; closed gate zeroes current allocations | None | V17 | KEEP/PORT as absolute authority |
| Per-stock V17 eligibility | Missing as one authoritative, explicit contract | Evidence exists across recommendation base, liquidity, S/R, session/source/conflict artifacts | None | `V20_V17_PRODUCTION_DECISION_CORE` | ADD |
| Canonical per-stock decision contract | Existing `current.json` is integrated but legacy/current-opportunity centric; Native and V17 are not yet one authoritative stock contract | V17 evidence available | Directive specifies canonical contract | V20 integration layer under V17 authority | ADD/REPLACE current decision ownership, preserving compatible outputs |
| Canonical final decision states | Mixed existing WATCH/ACTIONABLE/research states | V17 closed gate forces monitor-only/no allocation | Directive enumerates ACTIONABLE/WAIT_FOR_ENTRY/WATCHLIST/HIGH_QUALITY_RESEARCH/RESEARCH_ONLY/DO_NOT_CHASE/PLAN_REBUILD_REQUIRED/BLOCKED | Canonical V20 contract | ADD |
| Native authoritative artifact | Missing: Native ranking currently persisted inside regression evidence | N/A | Directive requires explicit native artifact | V20 Native | ADD `data/v20/native-current.json`; regression only validates it |
| Native model freeze | Policy identifies V1 but no complete immutable composite freeze registry | N/A | Directive specifies freezeId + component hashes + composite digest | V20 governance | ADD; preserve existing V1 forward observation and do not retune |
| Native immutable archive | Native shadow archive exists and avoids rewriting legacy immutable signal archive | V17 immutable signal principles and conservative ledger | Directive strengthens model/freeze/source issue-state metadata | V20 evidence | MERGE without rewriting issued evidence |
| Forward evaluation | Conservative V20 forward core/shadow exists, horizons 1/3/5/10/20 | V17 conservative ledger/reference; same-candle safety | Directive separates fresh forward and ambiguity states | V20 evidence | KEEP/MERGE |
| Evidence Registry | Separated performance registry exists; Native forward is isolated | V17/V16 evidence are references | V21-style canonical evidence schema from directive | V20 governance | MERGE/EXTEND; never blend development/holdout/fresh-forward |
| Portfolio production guard | Max total 50%, max 4 positions, max 12.5%, closed gate => 0 exposure/100 cash | V17 finalizer also zeroes allocation when execution is closed | Funded NAV concept from directive | V20 portfolio under V17 gate | KEEP guard + ADD Funded NAV timeline; forbid capital reuse |
| Champion / challenger | V16 Champion; V19 shadow; no auto-promotion | V17 controls execution | Comparison governance concept from directive | V20 governance | MERGE/EXTEND; manual review only |
| Market regime | V20 verified context, production influence false | Cannot bypass V17 | None | V20 research context | KEEP |
| Source health | Multiple V20/V17 artifacts exist | V17 owns source/session/conflict quality | Directive requests unified health UX | V17 evidence surfaced by V20 | MERGE |
| Provider contract vs connection | Not fully canonical in current UI | V17 fail-closed provider/source behavior | Directive distinguishes contract/connection/review/execution approval | V20 health contract | ADD explicit statuses |
| User portfolio | Existing V20 local portfolio functionality/validation | V17 state can be surfaced per holding | V21 behavior referenced conceptually | V20 UX | KEEP/MERGE; preserve privacy and V17/Native separation |
| Browser / responsive UI | Existing RTL responsive browser smoke | V17 health/gate data available | Decision Board/dossier UX concepts from directive | V20 UI | MERGE/EXTEND |
| Runtime algorithm self-patching | CI runs `apply-null-semantics-hardening.cjs`, which chains multiple `apply-*` scripts that modify analytical/UI source before tests | N/A | Directive explicitly forbids this | Checked-in V20 source | DEPRECATE after exact materialization of accepted behavior |
| Final certification | Existing acceptance/release evidence, but not the required last machine+human certification pair | V17 status source available | Directive specifies final certification | V20 release governance | ADD LAST |

## Material audit findings

### 1. V17 is already more than a global Boolean
V17 contains a verified-session chain, current recommendation rebuild, exact liquidity methodology, internal S/R evidence, source-conflict handling, resilient execution gate, snapshot enrichment, and a final safety pass that zeroes allocation/sets monitor-only when execution is not valid. V20 must consume these semantics per stock rather than reducing V17 to `executionGrade`.

### 2. Native V1 accepted behavior is not fully materialized in Git
The checked-in `build-full-market-native-selection.cjs` still uses the older discovery-based tie resolution, while `apply-native-ranking-discrimination.cjs` injects the accepted safety-strength exact-score tie-break at CI runtime. The accepted runtime behavior must be materialized exactly into checked-in source. This is an implementation/governance correction, not a Native methodology retune. Any later material methodology change requires a new model version/freeze/evidence window.

### 3. `native-current.json` is missing
The primary Native ranking is currently persisted inside `market-explorer-regression.json`. This makes regression evidence an accidental owner of the ranking. V20 needs an explicit `data/v20/native-current.json`; regression must validate, not own, ranking output.

### 4. V17 runtime sync is directionally correct but incomplete for the new architecture
V20 currently fetches authoritative V17 data at workflow runtime, but the whitelist does not yet include the current V17 recommendation base and its status artifact. These must be added with source SHA/session provenance, while never modifying/pushing V17.

### 5. Current V17 session is not execution grade
At the audited V17 head, status is DEGRADED and executionGrade is false due to S/R freshness below the execution threshold, critical source conflicts, and internal S/R not execution-candidate ready. Therefore the correct current production state is zero new exposure. V20 research discovery remains allowed.

### 6. V21 source limitation
No V21 branch/repository was discoverable during the audit. Selective V21 items are therefore implemented only from the explicit requirements in the integration directive (Funded NAV, model freeze, evidence/governance/UX contracts). No undocumented V21 algorithm or behavior will be invented.

## Non-regression / implementation rules

1. Do not change V20 Native V1 weights, thresholds, indicators, Net R:R threshold, or scoring methodology merely to improve results.
2. Preserve full-market discovery and Legacy scoring contribution = 0%.
3. V17 production eligibility and global execution authority are absolute.
4. A high Native rank may remain V17_BLOCKED and must be explainable.
5. Global gate closed means `productionActionableCount = 0` and `productionNewExposure = 0%`.
6. V16.9 remains Champion; V19 remains Shadow; no automatic promotion or broker execution.
7. Do not rewrite issued Native/V17 signal hashes or contaminate fresh-forward evidence.
8. Materialize accepted runtime source behavior before removing patchers; do not silently change the algorithm while doing so.
9. Final certification is generated only after semantic/browser/portfolio/evidence tests pass and engineering CRITICAL/MAJOR findings are zero.
