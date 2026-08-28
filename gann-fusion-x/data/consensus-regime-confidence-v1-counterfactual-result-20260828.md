# Consensus Regime Confidence V1 — Counterfactual Result

Date: 2026-08-28

## Status

**FAIL — do not promote.**

This is a same-sample exploratory counterfactual against the locked 60-session / 447-candidate Attribution V1 ledger. It is not an independent validation and cannot authorize a production change.

The preregistered overlay was applied without changing candidate keys, V16/SEPA ranks, GANN timing grade/score, or entry/trigger/stop/target levels.

## Integrity

- Evaluation sessions: **60**
- Candidate rows before: **447**
- Candidate rows after: **447**
- Unique date/ticker keys: **447**
- Candidate additions: **0**
- Size increases: **0**
- Changed exposure rows: **57**

Overlay attribution:

- Preserve baseline: **298** rows
- Baseline already inactive: **92** rows
- `GANN timing score < 50` -> WAIT: **37** rows
- `abs(triggerDistancePct) > 5%` -> WAIT after the low-timing rule: **20** rows
- High-volatility RISK_ON Grade A/C size cap: **0 incremental changes** because the existing Regime Gate had already reduced those applicable rows to the same-or-lower exposure.

## Locked baseline vs preregistered challenger

| Window | Baseline PF | Challenger PF | Baseline Compound | Challenger Compound | Baseline DD | Challenger DD | Baseline Exposure | Challenger Exposure |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Full60 | 2.07 | **2.30** | +41.911% | **+47.088%** | -10.356% | **-11.157%** | 62.4% | **52.2%** |
| First30 | 1.09 | **1.21** | -0.770% | **+0.243%** | -4.904% | **-3.996%** | 34.5% | **27.1%** |
| Last30 | 2.42 | **2.70** | +43.013% | **+46.732%** | -10.356% | **-11.157%** | 83.8% | **71.5%** |

The overlay repaired the First30 sign and improved PF/compound, but it failed its preregistered `Full60 max drawdown no worse than -10.356%` criterion. Therefore **forwardShadowEligible = FAIL** and no parameter is changed to rescue the result.

## Post-result component decomposition — diagnostic only

This decomposition is explicitly post-result and cannot be used as a same-sample acceptance test.

### Low GANN timing guard only (`score < 50` -> WAIT)

- Full60: PF **2.30**, compound **+47.390%**, DD **-11.157%**
- First30: PF **1.22**, compound **+0.319%**, DD **-3.996%**
- Last30: PF **2.69**, compound **+46.921%**, DD **-11.157%**

This component is responsible for the drawdown degradation that caused the combined preregistered policy to fail.

### Extreme trigger-distance guard only (`abs(distance) > 5%` -> WAIT)

- Full60: PF **2.24**, compound **+47.781%**, DD **-10.356%**
- First30: PF **1.22**, compound **+0.311%**, DD **-3.931%**
- Last30: PF **2.59**, compound **+47.322%**, DD **-10.356%**

This is the cleanest structural component in the same-sample diagnostic, but it is **not validated** because it was isolated after examining the completed sample.

### High-volatility A/C cap only

No incremental change occurred because the current Regime Gate already had the relevant exposures capped at `<= 0.50`.

## Decision

1. Regime Confidence V1 remains **FAILED** and research-only.
2. Do not merge or promote it.
3. Do not tune the `<50` threshold or any other parameter on these same 60 sessions.
4. The extreme trigger-distance guard is eligible only to be **frozen as a new forward-only hypothesis** and tested on future/disjoint sessions.
5. Production/main remains untouched.
