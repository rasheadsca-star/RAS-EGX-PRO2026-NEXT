# Consensus Execution Proximity V1 — Forward-Only Preregistration

Date frozen: 2026-08-28

## Purpose

Freeze a single execution-proximity hypothesis for **future/disjoint validation only**. This version must not be accepted or rejected using the June–August 60-session development sample that motivated it.

## Upstream pipeline — locked

- V16 Quality Gate V2 unchanged.
- SEPA-X qualification/ranking unchanged.
- Exact V16 ∩ SEPA intersection unchanged.
- GANN timing grade/score unchanged.
- Existing Regime Gate unchanged.
- Entry, trigger, stop and target levels unchanged.
- No fixed stock count.
- No V16/SEPA rank or percentile cutoff.
- No candidate additions.

## Frozen rule

After the existing GANN timing + Regime decision:

- Preserve existing `WAIT` / `BLOCK` decisions.
- For an otherwise active plan, if `abs(triggerDistancePct) > 5.0`, set the execution action to `WAIT` and size to `0` for that signal.
- Otherwise preserve the existing action and size.

There are **no other conditions** in V1.

The `5.0%` rule is frozen now. It must not be moved to 4%, 6%, a percentile, or a ticker-specific threshold after seeing future results. Any change requires a new preregistered version.

## Forward validation start

Only signal dates **on or after 2026-08-30** are eligible for this forward validation. Earlier dates are development/diagnostic data and are excluded from acceptance.

A signal is scored only after the same conservative 3-session outcome window is fully available. Same-candle stop + target remains stop-first. Round-trip cost remains 0.6%. No future leakage is allowed.

## Required invariants

For every forward signal date:

1. Baseline and challenger must start from the exact same V16 ∩ SEPA candidate keys.
2. Challenger candidate count must equal baseline candidate count.
3. V16 rank, SEPA rank, GANN timing grade/score, Regime state, entry, trigger, stop and targets must be byte-equivalent before the proximity overlay.
4. Challenger may only convert an active plan to WAIT; it can never add a stock or increase position size.
5. Missing/freshness-invalid observations are excluded identically from baseline and challenger; missing data is never treated as zero.

## Evaluation plan

- First checkpoint: **20 fully evaluable future sessions** — informational only, no promotion.
- Formal research acceptance checkpoint: **30 fully evaluable future sessions**.
- At 30 sessions also report First15 / Last15 to detect regime concentration.

Formal research acceptance requires all of the following on the same future candidate universe:

- Challenger PF >= `max(1.25, baseline PF)`.
- Challenger compound return > 0 and >= baseline compound return.
- Challenger max drawdown >= baseline max drawdown and >= -15%.
- First15 PF >= 1.00 and compound >= 0.
- Last15 PF >= 1.00 and compound >= 0.
- Candidate/invariant checks all pass.
- No look-ahead, no threshold changes, no post-hoc exclusions.

Passing the 30-session checkpoint makes the rule eligible for a separate promotion review; it does not automatically merge it into production.

## Development-sample note

A post-result decomposition on the old 60-session sample showed that this single guard would have produced PF 2.24, compound +47.781%, DD -10.356%, with First30 PF 1.22 / +0.311% and Last30 PF 2.59 / +47.322%. Those figures are recorded only as the reason this hypothesis was selected for forward testing and are **not** validation evidence.

## Production status

`main`, V16 production, SEPA-X production and the current GANN production path remain unchanged.