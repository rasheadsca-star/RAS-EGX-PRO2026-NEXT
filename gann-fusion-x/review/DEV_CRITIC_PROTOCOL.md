# Developer ↔ Destroyer Review Protocol

This protocol is mandatory for GANN FUSION X research and production-candidate work.

## Roles

### Developer
- Implements the smallest evidence-backed correction.
- Preserves frozen upstream engines and research constraints.
- Never converts missing data into zero or synthetic certainty.
- Produces machine-readable before/after evidence.

### Destroyer Critic
- Assumes the implementation is wrong until evidence proves otherwise.
- Searches for data gaps, stale sessions, identity errors, hidden fallbacks, leakage, ranking contamination, unsafe defaults, inconsistent actions, missing provenance, and misleading UI states.
- Treats ACTIONABLE with missing critical data as a critical defect.
- Does not accept cosmetic fixes that merely hide a defect.

## Iteration
1. Developer produces implementation/evidence.
2. Destroyer runs independently and emits findings by severity: critical / major / minor.
3. Every critical or major finding must be fixed or explicitly proven to be a false positive with evidence.
4. Developer reruns all affected tests plus regression tests.
5. Destroyer runs again from a clean checkout.
6. Repeat until the exit gate is satisfied.

## Exit gate
A candidate may advance only when:
- critical findings = 0;
- major findings = 0;
- all required invariants/tests pass;
- no missing critical datum is silently treated as zero;
- stale/source-conflicted inputs are blocked or clearly quarantined;
- actionable recommendations have all critical decision inputs available and sufficiently verified;
- no production merge occurs solely because a backtest improved;
- the final destroyer pass produces no new evidence-backed critical/major finding under the current published rule set.

Minor findings may remain only if they are explicitly documented, non-decision-affecting, and accepted as technical debt; they cannot be hidden.

## Anti-overfitting rule
The Destroyer must reject any post-result threshold tuning on the same evaluation sample unless the change is explicitly classified as exploratory and validated on a disjoint/forward sample.

## Data-readiness rule
A stock with insufficient critical data is `DATA_INCOMPLETE`, not a weak investment candidate. Data incompleteness must not lower its investment score as if it were negative evidence; it must instead gate the decision or reduce confidence according to the documented policy.
