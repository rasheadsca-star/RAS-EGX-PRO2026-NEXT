# Recommendation strategy review — first priorities

Reviewed repository: `41579bacbddc0b06d16b9b0a3e39757ac42962e7`.
Decision session: 2026-09-28. This review does not certify investment performance.

## P0: Restore the observed history between the certified baseline and the handoff

The post-close workflow checks out baseline `66b74d6f7586bd06201f6f7992ff9babf1104259`
and filters source history with `dateOf(r) === expected`, adding only the last bar.
The actual CPCI, EGTS and SNFC baseline histories end on 2026-09-17. Source histories
contain seven subsequent observations: September 20, 21, 22, 23, 24, 27 and 28.
The old overlay therefore omits six available observations in the decision workspace.
This can change returns, volatility, ranking and risk levels. The size and direction
of the effect require replay of the certified G11/G09 pipeline.

Proposed fix: append every observed, valid source bar after the certified tail and
through the finalized handoff date. Preserve earlier certified rows and original
source metadata; exclude future bars; reject invalid or duplicate appended bars.
No missing dates or synthetic prices are created. Missing bars absent from BOTH
sources still require a separate calendar/corporate-action audit.

Validation: four regression tests covering intervening history, preservation of the
baseline, future-data exclusion, absent current sessions, invalid bars and duplicates.
The workflow YAML and embedded shell syntax also pass validation.

## P1: Repair and align the evaluation policy before optimizing recommendations

Confirmed in `scripts/astra/astra-claude-retrospective-comparison.mjs`:

- `maxExit = min(last available bar, entry + maxHold - 1)` followed by `TIME_EXIT`
  treats incomplete follow-up as a completed holding period. A one-bar example with
  entry 10, last close 10.2 and a ten-session holding policy closes immediately and
  reports +1.4% after the assumed 0.6% round-trip cost. It should be explicitly open
  or censored until the exit rule is actually observable.
- A stop at 9 after entry at 10 is booked at 9 even if the next session opens at 8.
  The reproducer reports -10.6%; an opening-price execution assumption would be
  -20.6% before any additional slippage. Execution policy must be explicit.
- The frozen source basket specifies one holding session and morning confirmation;
  the neutral comparison uses three sessions for entry and ten for holding; native
  intelligence permits twenty-session entry expiry. These measure different policies.
  A neutral comparison is not proof of the live strategy's realized performance.
- The comparison's history reader drops validation/warning metadata, preventing
  later exclusion of questionable observations on that metadata alone.

The saved neutral replay shows 69 entered episodes across 27 signal dates,
average net return -0.36%, profit factor 0.87, under its 0.6% cost assumption.
Treat this as a diagnostic, not a validated live-performance estimate.

Native outcome accounting contains eight CLOSED records, but only four have known
entry prices and numeric returns; five additional outcomes have ambiguous intraday
paths. Excluding unknown returns is defensible, but coverage and denominators must
be prominent. Do not interpret the displayed win rate as covering every closed trade.

## P2: Resolve data provenance and validate out of sample

File-level price-conflict warnings remain on CPCI, EGTS and SNFC. EGTS also carries
a corporate-action review warning, while the latest individual bars do not carry
those warnings. This does not prove that the latest quotes are wrong; reconciliation
must distinguish historical metadata from unresolved current-session conflicts.

After history continuity and execution accounting are verified, compare the original
and candidate strategies chronologically out of sample, using the same universe,
cost assumptions and execution policy. Report drawdown, net expectancy, coverage,
liquidity limits and uncertainty. Do not tune target/stop multipliers to the three
current recommendations or to the already-observed test period.

## Release status

This branch contains the history-continuity proposal, a corrected research execution
module, regression tests, and a reproducible audit of the same preserved signals.
The live recommendation generator and its current trading parameters have not changed.
Before promotion: reconcile source warnings and apply a shared
corrected policy to both engines before replacing the live comparison.

## Measured execution audit

Run `node scripts/astra/research/audit-execution.cjs` from this checkout. The report
`EXECUTION_AUDIT_2026-09-29.json` records the input hashes, every candidate episode,
changed outcomes and assumptions. Observation cutoff is September 28; the 102
preserved signals span August 4 to September 13. No signals were regenerated.

| Metric | Legacy replay | Corrected research replay |
|---|---:|---:|
| Closed episodes included in return statistics | 69 | 65 |
| Average net return per included episode | -0.36% | -0.4950% |
| Profit factor | 0.87 | 0.8245 |
| Ambiguous entry/target ordering excluded | 0 | 3 |
| Overlapping signals suppressed | 24 | 25 |

MICH August 4, NCCW September 9 and MPCO September 10 were previously booked as
target profits. Their entries occur below the opening price, so a daily high above
the target could precede entry. The audit classifies them as ambiguous and makes
no return claim. NCCW September 13 is then suppressed because the prior episode's
state is unresolved. Blocking through the observation cutoff is deliberately
conservative; it is not a reconstruction of actual holdings.

The adverse-gap and truncated-follow-up fixes pass targeted regression tests but
do not change any other outcome in this particular sample. The two legacy time
exits have sufficient follow-up here. Do not attribute this sample's performance
change to gaps or premature exits. Reduced coverage is not evidence of a better
strategy; the resulting average remains negative under the stated cost assumption.

Validation: 12 targeted tests pass. Actual CPCI history grows from 130 certified
rows to 137 (rather than 131); EGTS and SNFC grow from 134 to 141 (rather than 135).
The helper restores the six intervening observations as well as the current bar.
This verifies the merge, not the downstream certified decision engine.

## Controlled certified-engine replay completed

The complete post-close build was subsequently run in isolated worktrees using
certified baseline `66b74d6f7586bd06201f6f7992ff9babf1104259` and immutable handoff
`37bb15f57a24e3a13f50bff7388a17510500be4b`. All 186 eligible history overlays passed.
G11/G09, native intelligence rebuilding and the workflow's publication consistency
assertions passed locally. No deployment or merge to main was performed.

A control run then removed only the intervening appended bars while holding all
other prepared inputs fixed. It reproduced the published snapshot exactly:
`G09-DS-d2d748f91751b6a15333519f`, selecting CPCI, EGTS, SNFC. Restoring those bars
produced `G09-DS-d669478bbe1cfe76e1e4b063`, selecting ADRI, SDTI, SNFC. This isolates
the history overlay as the cause of this selection change; strategy parameters
were identical. The evidence summary is in `HISTORY_CONTINUITY_REPLAY_2026-09-29.json`.

Complete-history coverage was 206/224 current canonical securities (91.96%) and
205/224 decision-ready securities (91.52%), with source evidence coverage 96.8%.
There were no CRITICAL findings, but two documented HIGH coverage findings remain.
The guard result was PASS_WITH_DOCUMENTED_COVERAGE_GAPS, not a clean all-market
data certificate. This result validates the correction's effect; it does not
establish that the newly selected stocks will be profitable.

## Source-policy alignment and evidence gate

`scripts/astra/research/source-policy-audit.cjs` now screens the preserved signals
against the pinned one-session policy without reclassifying historical strategy
versions. Eight additional regression tests cover opening cancellation, missing
market sessions, publication ordering, reconstructed prices and unproven execution.
All 20 focused tests pass. Run the script to reproduce
`SOURCE_POLICY_AUDIT_2026-09-29.json`.

The 102 saved recommendations are not a homogeneous policy sample: 27 record five
holding sessions and 75 record one. The 27 remain a separate policy cohort rather
than being retroactively rewritten as one-session recommendations. Of the 75:

- 16 fail the source's opening-price cancellation rules, even if prices later
  return to the entry zone.
- 13 require session-data review: 10 have unresolved/reconstructed evidence and
  three lack a unique bar for the next date in the stored market calendar.
- 46 need intraday evidence of morning liquidity, entry timing and the one-session
  exit. A daily range touch is not sufficient confirmation.

No episode in this audit is certified as an actual execution. The certified net
return is null, not zero. This describes missing evidence, not proof that no trades
occurred. Opening cancellation states are model decisions, not broker orders.

The source research basket's original walk-forward metric uses next-close versus
signal-close returns minus 0.60%; it does not implement the published opening and
morning-liquidity conditions. Its published one-session label alone therefore does
not establish a tradable backtest. Certified G09 leaves unfilled weight in cash,
even though the older source's Arabic prose suggests redistribution. The certified
KEEP_CASH rule takes precedence for a future execution-policy implementation.

Next validation requires time-stamped publication and intraday liquidity/fill
evidence, a defined measurable morning-liquidity rule, and explicit one-session
exit semantics. Then freeze the policy and evaluate a chronological holdout not
used in these diagnostics. No new holdout result or live-policy change is claimed.
