# V16.9 Loss Shield Stage-A Stack — One-Shot Research Contract

## Purpose

Test one already-frozen, signal-time-only downside mechanism as a possible residual Loss Shield after the frozen V16.9-RiskAlpha v0.1 result. This test must not retune RiskAlpha v0.1 and must not invent a new threshold after reading outcomes.

## Candidate mechanism

Reuse **V16_DOWNSIDE_FRAGILITY Stage A exactly as preregistered** in `V16_DOWNSIDE_FRAGILITY_EXPERT_CONTRACT.md`:

- last 20 observable overnight gaps through the signal date only;
- historical downside gap <= -1.0%;
- downside-gap frequency >= 15% (at least 3 of 20);
- historical 10th-percentile gap <= -1.5%;
- both conditions required for `FRAGILE_WATCH`.

No threshold may be changed for this test. No later bar, next open, intraday high/low, target/stop outcome, Meta decision, or future field may influence Stage A.

## Frozen comparison arms

Use the exact pinned 45-session V16.9 evidence lineage and the same 0.60% round-trip cost / equal-weight renormalization policy:

1. **A — V16.9 Champion:** untouched baseline.
2. **B — RiskAlpha Stage B only:** veto only `nextOpen < frozenEntryLow`; this is the already-frozen v0.1 execution guard.
3. **C — Stage-A Fragility only:** veto `FRAGILE_WATCH`; no Stage-B next-open guard.
4. **D — Combined:** veto if Stage A is `FRAGILE_WATCH` OR Stage B is `VETO_GAP_DOWN_RECOVERY_ENTRY`.

No removed member is replaced. Remaining members are equal-weight renormalized. If no members remain, session return is 0.

## Formal decision rule

The existing Stage-A one-shot acceptance rule from `V16_DOWNSIDE_FRAGILITY_EXPERT_CONTRACT.md` remains the **only formal pass/fail rule** for the signal-time candidate. This stacked A/B test adds descriptive incremental metrics versus RiskAlpha but does not create new post-hoc acceptance thresholds.

The stacked report must show, for all four arms:

- sessions;
- average and median net return;
- winning-session rate;
- Profit Factor;
- compounded return;
- Max Drawdown;
- worst/best session;
- members retained/removed;
- executable members;
- stop count/rate;
- conservative target count/rate.

It must also show the incremental deltas of **Combined vs RiskAlpha**, including average return, Profit Factor, Max Drawdown, stop rate, and target rate.

## Destructive-critic / validity gates

The test is invalid if any of the following occurs:

- Stage-A uses any bar later than signal date;
- Stage-B uses any field other than observed next open and frozen entryLow;
- RiskAlpha v0.1 thresholds or semantics are changed;
- Stage-A thresholds are changed;
- ATR-derived entry/stop/target geometry is repurposed as a predictive feature;
- a removed member is replaced after observing outcomes;
- the evidence window differs from the pinned 45-session lineage;
- fresh-forward ledger is rewritten;
- any positive production/scoring authority is granted from this retrospective test.

## Authority lock

- researchOnly = true
- Champion = V16.9
- scoringImpact = NONE
- alphaWeight = 0
- productionAuthority = false
- promotionEligible = false
- no retune after outcome
- PR #68 remains Draft/Open/Unmerged
- no `main` mutation
- no production deployment

Even if the Combined arm looks stronger retrospectively, it remains zero-weight shadow evidence until separately preregistered fresh forward evidence supports it.
