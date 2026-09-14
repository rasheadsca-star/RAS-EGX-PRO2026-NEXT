# V17 Parallel Sequential Validation Contract

Status: **FROZEN PRE-OUTCOME RESEARCH CONTRACT**  
Authority: **RESEARCH / SHADOW ONLY**  
Production authority: **NONE**  
Automatic orders: **DISABLED**  
Automatic promotion: **DISABLED**

## Purpose

Avoid serial wait -> retune -> wait loops. Starting with the 2026-08-30 frozen signal cohort, the same future market evidence must evaluate one control and three pre-registered challenger arms in parallel. No arm may be invented, altered, or back-filled after seeing a cohort outcome.

## Frozen common rules

- V16 frozen signal geometry is immutable.
- Candidate order is frozen: `PRIMARY_1 -> PRIMARY_2 -> CONDITIONAL -> RESERVE_1 -> RESERVE_2`, then rank, then ticker.
- Entry opportunity exists on the **next trading session only**.
- Entry-zone fills use the frozen entry zone; no price chasing above `entryHigh` without a retrace.
- Stop/target geometry is never changed after signal capture.
- Same-bar stop + target ambiguity is resolved `STOP_FIRST`.
- Maximum holding period is 3 observed sessions.
- Third-session close is the time exit when no terminal stop/target occurred.
- Round-trip cost is 0.60% for every entered member.
- A slot used by an entered member is not reused inside the same cohort, even if the member terminates on its entry observation.
- Cash from unused slots earns 0% in the research portfolio.
- No outcome-driven retuning is permitted.

## Parallel arms

### V16_CONTROL

The frozen control represents the V16 selection/execution baseline for the two primary candidates.

- Candidates: `PRIMARY_1`, `PRIMARY_2` only.
- Maximum positions: 2.
- No substitution with conditional/reserve candidates.
- If the next session opens below `entryLow`, a later recovery into the frozen entry zone during that same next session is allowed for the control. This preserves the gap-down recovery behavior that RiskAlpha was designed to challenge.
- No gap-down veto overlay.

### V17_A

Current V17 execution-governor hypothesis.

- Candidates: all frozen V16 candidates in priority order.
- Maximum positions: 2.
- If `nextOpen < entryLow`, the member is permanently vetoed for the cohort (`GAP_DOWN_VETO`).
- Substitution is allowed: lower-priority candidates may consume unused slots.
- No same-observation slot reuse after an entry.

### V17_B

Primary-only V17 hypothesis.

- Candidates: `PRIMARY_1`, `PRIMARY_2` only.
- Maximum positions: 2.
- Same gap-down veto as V17_A.
- No substitution. A rejected/non-entered primary leaves cash idle.

### V17_C

Single-best-eligible V17 hypothesis.

- Candidates: all frozen V16 candidates in priority order.
- Maximum positions: 1.
- Same gap-down veto as V17_A.
- The first candidate that becomes eligible consumes the only slot; lower candidates remain shadow-only for that cohort.

## Cohort overlap

A new immutable cohort should be frozen for every eligible completed signal session without waiting for the previous cohort's 3-session lifecycle to finish. Cohorts may overlap in calendar time. Statistical inference is performed at the **cohort/session level**, not by pretending member observations are independent sessions.

## Paired evidence

For challenger arm `A` and control `C`, each completed cohort contributes:

`delta = netReturnPct(A) - netReturnPct(C)`

A paired win is `delta > 0`; a paired loss is `delta < 0`; exact ties are excluded from the Beta win/loss posterior but retained in return/risk summaries.

Posterior for paired superiority uses the frozen prior:

`p ~ Beta(1 + pairedWins, 1 + pairedLosses)`

and reports `P(p > 0.5 | evidence)`.

Member-level stops/targets are descriptive safety evidence and are aggregated within cohort before final decisions. They do not multiply the effective number of independent sessions.

## Frozen sequential boundaries

These boundaries are fixed before the first 2026-08-31 outcome.

- Minimum completed paired cohorts for any early stopping decision: **8**.
- Minimum decisive (non-tied) paired cohorts: **5**.
- Early positive research evidence: `P(p>0.5) >= 0.975`, mean paired delta > 0, and challenger stop rate <= control stop rate.
- Early futility: `P(p>0.5) <= 0.10` and mean paired delta <= 0.
- Formal research-challenger gate may be evaluated from **20 completed paired cohorts** with at least 10 decisive pairs.
- Formal gate requires all of:
  - `P(p>0.5) >= 0.99`;
  - mean paired delta > 0;
  - challenger maximum drawdown is no worse than control;
  - challenger stop rate is no worse than control;
  - challenger cumulative compounded return is greater than control.
- If formal gates are not met by 20 cohorts, evidence continues without retuning.
- Hard maximum evidence horizon: **40 completed paired cohorts**.
- At 40 cohorts, any challenger that has not passed the formal gate is classified `NO_MATERIAL_EDGE_UNDER_FROZEN_CONTRACT`; no indefinite extension is allowed.

The 0.99 formal superiority boundary is intentionally stringent because three challengers are being evaluated in parallel.

## Interpretation statuses

- `INSUFFICIENT_EVIDENCE`
- `CONTINUE_FROZEN_TEST`
- `EARLY_POSITIVE_RESEARCH_EVIDENCE`
- `EARLY_FUTILITY`
- `FORMAL_RESEARCH_CHALLENGER_PASS`
- `NO_MATERIAL_EDGE_UNDER_FROZEN_CONTRACT`

None of these statuses authorizes live orders, production promotion, main-branch mutation, or capital deployment.

## Anti-wait rule

Failure of one arm never resets the evidence clock for the other pre-registered arms. New variants created after observing outcomes start a new evidence lineage, but the original V17_A/B/C lineage continues unchanged to its stopping boundary. This prevents serial redesign from erasing previously accumulated forward evidence.
