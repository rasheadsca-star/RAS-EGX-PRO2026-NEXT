# EGX PRO — Astra Forensic Discovery Report (G01–G05)

Generated: 2026-09-15 (Africa/Cairo)  
Repository: `rasheadsca-star/RAS-EGX-PRO2026-NEXT`  
Discovery baseline HEAD when inspection started: `1ed10bc0e3c1d19659d12b7daebc4c06a6a41f61`

## Scope

This run performed discovery only. No application behavior, ranking, strategy logic, thresholds, data model, UI, or deployment behavior was rebuilt or redesigned.

## G01 — Repository and legacy discovery

**Result: GREEN**

### Repository shape

- Default branch: `main`.
- 148 branches were enumerated through the repository branch API.
- No Git tags were returned; release/version provenance therefore depends on branch names, commits, frozen data/contracts, backups and workflow artifacts.
- `main` is a historical/operational monorepo, not a clean single-engine tree. It contains or references V13, V14, V15, V16, Gann/SEPA and other lineages while substantial V17/V18/V19/V20/TFE/EGX ONE implementations live on diverged branches.
- Representative archived/legacy locations include `backups/v13-*`, `retired-workflows`, `scripts/quant`, `scripts/stable`, `scripts/research`, `gann-fusion-x`, `deploy/rc2-safe-shell`, branch-only `tfe-v20`, branch-only `data/v17`, `data/v19`, `data/v20`, `triple-engine`, and `egx-one/clean-room-v0`.

### Branches requiring preservation in later migration

The discovery explicitly inspected/listed active, release, validation, research, feature and backup lines. High-value branches include:

- `v18-global-strategy-ensemble-20260906`
- `v19-egx-chat-gpt`
- `research/egx-meta-engine-v1-20260829`
- `research/triple-engine-consensus-v1`
- `develop/v20-integrated-decision-platform`
- `release/rc2-frozen`
- `develop/sepax-isolated-v1`
- `develop/sepax-v2-isolated`
- `egx-one/clean-room-v0`
- `develop/v17-rebuild`
- Gann feature/research lines (`feature/gann-*`, `research/gann-current-backtest-20260828`)
- V16 frozen/release lines (`release/v16.9.2-*`, `release/MAIN-APP-v16.9.2-*`)
- V13/V14 backup lines and historical hardening backups.

Important divergence examples:

- `research/egx-meta-engine-v1-20260829` is substantially diverged from `main` and contains branch-only V17/V19/V20 artifacts and implementations.
- `v18-global-strategy-ensemble-20260906` carries the V18 ensemble, forward ledger, web build and performance league.
- `egx-one/clean-room-v0` is an intentionally isolated clean-room foundation with its own forward/research-history workflows.

## G02 — Engine registry

**Result: GREEN**

`docs/astra/ENGINE_REGISTRY.json` records **20 distinct engine implementations/families** after collapsing aliases and minor versions. It includes active, retired, experimental, historical-only and unrecoverable classifications.

Key findings:

1. `V16_9_EQUAL_WEIGHT_BASKET` is repeatedly identified by later V20 governance artifacts as the production champion/reference.
2. V17 is primarily a governance/data-truth/execution-gate spine related to V16.9, not independent alpha.
3. V18 is an evidence-routing/global-strategy ensemble. Its policy says it is not an automatic execution engine.
4. V19 V6 source is recoverable and explicitly `SHADOW_RESEARCH_ONLY`; its own code says the architecture was benchmark-informed and does not count as fresh independent evidence.
5. V20 Native V1 is a frozen full-market shadow model with explicit rules/weights/hashes and zero execution influence.
6. Gann Fusion X and SEPA-X are separate recoverable strategy/engine lines, with multiple Gann challenger branches and isolated SEPA source branches.
7. TFE V20 Fusion RC2 is recoverable from a frozen branch and is explicitly research/shadow only.
8. Triple-engine consensus and EGX Meta Engine are aggregators/research layers, not independent alpha sources.
9. EGX ONE is a clean-room foundation and must not be mistaken for a finished frozen production strategy.
10. `QUANT_EDGE` has a consumed runtime endpoint/output status but no original algorithm source recovered from the available repository branches/artifacts. It is therefore marked **`legacy-output-only`**; no missing logic is inferred.

## G03 — Strategy registry

**Result: GREEN**

`docs/astra/STRATEGY_REGISTRY.json` records **18 distinct strategy families/modules** after collapsing threshold variants and aliases.

Recoverable strategy families include:

- trend following / trend continuation;
- breakout;
- pullback;
- momentum;
- reversal family marker (original pre-V18 algorithm not proven);
- EMA/MACD trend continuation;
- V16.9 equal-weight portfolio basket;
- relative-strength high-proximity leadership;
- volatility contraction/VCP;
- V16 two-stage/top-gainer predictor family;
- V16 triple-barrier validation gate;
- V19 Top-10 probability + inverse-volatility 3-name basket/risk overlay;
- V20 Native multi-component evidence composite;
- Gann technical fusion;
- Gann regime router/gates;
- Gann entry/execution-quality family;
- SEPA QVUA `NEAR_FIRST_THEN_FORMING`;
- TFE evidence-aware hard-gate fusion.

The registry explicitly avoids inventing a QUANT EDGE strategy or an unproven original reversal algorithm.

## G04 — Historical-store map

**Result: GREEN**

`docs/astra/HISTORICAL_STORES.json` maps **19 historical store groups**. These cover:

- raw/per-symbol OHLCV history and source/backfill lineage;
- Quant feature stores, paper recommendations, ledgers, backtests and walk-forward outputs;
- V13 evidence archives;
- V14 stable decisions/forward sessions;
- V15 practical decisions;
- V16 MAIN APP decisions/signal ledger/audits;
- V17 ledger/track-record/review artifacts;
- V19 versioned challenger/replay/holdout artifacts;
- V20 native signal archives, forward resolution, performance registry and retrospective walk-forward;
- V18 immutable forward ledger/performance league;
- Gann/SEPA forward shadow and benchmarks;
- TFE RC2 forward/simulation/decision evidence;
- EGX ONE research warehouse/forward evidence;
- generic legacy recommendation/outcome/accuracy/ranking/certification artifacts.

### Migration risk

The same logical recommendation can exist in multiple snapshots, summary files, ledgers and branch copies. G07 must use source/version/session/ticker identities plus checksums and reconciliation counts. "Latest filename wins" is unsafe. Development, reused holdout, retrospective, validation and true forward evidence must remain separate.

## G05 — Runtime-dependency map

**Result: GREEN**

`docs/astra/RUNTIME_DEPENDENCIES.json` records **8 actionable legacy engine/runtime/build dependencies**.

### Current production/runtime path proven from repository

`main:.github/workflows/static.yml` deploys the whole tracked `main` tree to GitHub Pages and additionally checks out `develop/sepax-isolated-v1` at build time to build `/sepax`.

The repository documentation points users to `https://rasheadsca-star.github.io/RAS-EGX0.1/`.

This is separate from historical/alternate runtime surfaces such as V18 live loader and RC2 safe shell.

### Legacy dependencies found

- V18 live shell → GitHub Raw branch document.
- V18 live shell → jsDelivr fallback for the same branch document.
- MAIN APP consensus → V19 V6 GitHub Raw/jsDelivr JSON.
- MAIN APP consensus → V20 Native GitHub Pages JSON.
- MAIN APP consensus → external QUANT EDGE Vercel API.
- Gann integration → external SEPA-X stable Vercel API.
- RC2 safe shell → TFE RC2 Vercel origins/proxy.
- Current Pages build → cross-branch checkout/build of isolated SEPA-X.
- Additionally, RC2 technical tooling fetches a pinned raw repository asset; it is recorded under the TFE family rather than double-counted as another algorithm.

External market/evidence sources (Mubasher, official EGX and historical public adapters) are mapped separately from legacy engines because the final system may still require authoritative market data even after legacy-engine cutover.

## Duplicate / competing implementations

Material overlaps that must be resolved by provenance, not deletion during discovery:

- V13.4 vs V13.5 adaptive strategy stack.
- V14/V15/V16 lineage versus later V17/V18/V19/V20 views.
- V16.9 champion versus V19 and V20 shadow/challenger representations.
- V18 ensemble versus Triple-engine and Meta-engine aggregation approaches.
- Gann Fusion X V1 plus V2–V5 challenger/regime/meta-router branches.
- SEPA-X v1/v2 isolated branches plus external stable runtime snapshot/API.
- TFE source branch/frozen RC2/safe-shell deployment variants.
- EGX ONE clean-room architecture versus the legacy monorepo path.

## Material blockers / findings

There is **no hard blocker to G01–G05** from the sources available in this run.

Material findings that constrain later gates:

1. The repository has no tags; commit/branch/path provenance is mandatory.
2. Multiple important implementations are branch-only and diverged from `main`.
3. The current Pages deployment has a cross-branch SEPA build dependency.
4. V18 live is not standalone; it remotely loads its shell from a legacy branch using Raw/jsDelivr.
5. MAIN APP consensus still contains remote V19/V20/QUANT EDGE dependencies.
6. QUANT EDGE original algorithm was not recovered and is `legacy-output-only`.
7. Historical stores overlap heavily; migration must reconcile rather than overwrite.
8. Research/holdout/forward evidence is not interchangeable; several artifacts explicitly prohibit treating reused benchmark evidence as fresh validation.

## Gate result

| Gate | Status | Evidence artifact |
|---|---|---|
| G01 Repository and legacy discovery | GREEN | this report + branch/tag inspection |
| G02 Engine registry | GREEN | `docs/astra/ENGINE_REGISTRY.json` |
| G03 Strategy registry | GREEN | `docs/astra/STRATEGY_REGISTRY.json` |
| G04 Historical stores mapped | GREEN | `docs/astra/HISTORICAL_STORES.json` |
| G05 Runtime dependency map | GREEN | `docs/astra/RUNTIME_DEPENDENCIES.json` |

## Exact next action

Run **Prompt 02 — Target Architecture + Migration Contract** using these discovery manifests as authoritative evidence: design the target standalone architecture and canonical schemas, complete G06, and prepare G07 without broad UI work or changing production behavior yet.
