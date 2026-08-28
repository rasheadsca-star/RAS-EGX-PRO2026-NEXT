# Consensus Attribution V1 — Trusted Evidence (2026-08-28)

## Scope

Post-run diagnostic only. This evidence does **not** change V16 selection, SEPA qualification, GANN timing, Regime sizing, entry/stop/target levels, or production behavior. Realized outcomes are used only to explain the already-completed 60-session V16 Quality Gate V2 sample and must not be converted directly into a tuned production threshold on this same sample.

## Trusted run

- Workflow: `Consensus Attribution V1`
- Run: `33182796063`
- Job: `98888015097`
- Branch: `research/consensus-attribution-v1-20260828`
- Head: `685eb9e81c30abb080b5cdaf257fd88fe075e74a`
- Conclusion: **SUCCESS**
- Artifact: `consensus-attribution-v1`
- Artifact ID: `9690427651`
- Artifact SHA256: `31e63dd32a24f483379a30038e796f400dfbab44121511b4dfe58a1de1c9af87`

All workflow integrity steps passed, including the explicit check that the attribution runner changed no locked financial output.

## Integrity

- Evaluation sessions: **60** (`2026-06-01` through `2026-08-24`)
- Locked consensus candidates: **447**
- Duplicate date/ticker rows: **0**
- Missing required attribution fields: **0**

Locked V16 Quality Gate V2 baseline:

| Window | PF | Compound | Max DD |
|---|---:|---:|---:|
| Full 60 | **2.07** | **+41.911%** | **-10.356%** |
| First 30 | **1.09** | **-0.770%** | **-4.904%** |
| Last 30 | **2.42** | **+43.013%** | **-10.356%** |

The production-acceptance failure therefore remains first-half stability, not the full-period result.

## Attribution findings

### 1. The first-half weakness is strongly regime-dependent

`RISK_ON` itself was not sufficient evidence of a healthy execution regime in the first half:

- First30 `RISK_ON`: 60 fills, PF **0.98**, compound **-1.756%**.
- Last30 `RISK_ON`: 169 fills, PF **2.46**, compound **+43.382%**.

The early period contained many `RISK_ON` sessions with elevated volatility and lower regime scores. This indicates that the current binary `RISK_ON` label is too coarse for attribution purposes; it mixes fragile/transitional and mature risk-on conditions.

### 2. Grade A / breakout confirmation was not universally safe

- First30 Grade A: 19 fills, PF **0.62**, compound **-4.978%**.
- Last30 Grade A: 47 fills, PF **3.06**, compound **+61.967%**.
- First30 breakout `CONFIRMED`: 26 fills, PF **0.55**, compound **-5.008%**.
- Last30 breakout `CONFIRMED`: 73 fills, PF **2.88**, compound **+72.605%**.

This is evidence of a regime interaction, not evidence that Grade A or breakout confirmation should be globally disabled.

### 3. Volume confirmation is the most directionally stable execution feature in this sample

- First30 volume confirmed: 43 fills, PF **1.45**, compound **+0.388%**.
- Last30 volume confirmed: 132 fills, PF **2.71**, compound **+66.974%**.
- First30 no volume confirmation: 23 fills, PF **0.45**, compound **-4.685%**.
- Last30 no volume confirmation: 38 fills, PF **1.22**, compound **+4.991%**.

This supports treating volume as a meaningful execution-confidence feature, while still requiring independent validation before changing the live policy.

### 4. Very low GANN timing readiness and very large trigger distance are persistent risk flags

GANN timing score `<50` was weak in both halves:

- First30: 4 fills, PF **0.10**, compound **-7.538%**.
- Last30: 11 fills, PF **0.59**, compound **-9.338%**.

Absolute trigger-distance band `>5%` was also weak in both halves:

- First30: 4 fills, PF **0.11**, compound **-3.707%**.
- Last30: 6 fills, PF **0.38**, compound **-11.275%**.

These samples are small, so they are structural hypothesis generators rather than production thresholds.

### 5. V16/SEPA relative ranks are not stable enough to justify a new rank cutoff

Examples of sign reversal:

- V16 25–50% relative-rank band: First30 PF **0.27** vs Last30 PF **3.42**.
- SEPA 10–25% relative-rank band: First30 PF **0.14** vs Last30 PF **3.07**.

Therefore the attribution does **not** support introducing a fixed rank/percentile cutoff. The no-fixed-count architecture remains intact.

## Structural diagnosis

The evidence points to an **execution/regime-confidence problem more than a V16/SEPA intersection problem**. The main failure mode is that the current `RISK_ON` state can admit immediate/confirmed entries during fragile or high-volatility market phases, where the same Grade A / breakout behavior later becomes highly productive once the market regime matures.

The cleanest next research hypothesis is therefore a **Regime Confidence Overlay**, not another stock-count or ranking filter. It should preserve the exact 447-candidate universe and only adjust execution exposure/readiness. Candidate additions and V16/SEPA rank cutoffs remain prohibited.

## Guardrail for the next challenger

Any next challenger derived from this report is exploratory on this 60-session sample. It must be specified before its backtest and cannot be promoted merely for repairing First30. Production remains unchanged until a disjoint/future validation window exists and the original acceptance criteria are passed without look-ahead or threshold tuning.
