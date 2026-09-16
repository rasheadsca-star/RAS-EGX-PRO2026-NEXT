# V20 Integrated re-certification trigger — 2026-09-16

This documentation-only commit intentionally triggers the V20 Integrated Decision Platform workflow on the current integration-branch state after the Native current publication-count and Native shadow variable-candidate-count contract fixes.

No runtime logic, production behavior, certification guard, threshold, or whitelist is changed by this file.

Expected validation target:
- Integration branch isolation remains Green.
- Steps 1–27 remain Green.
- Step 28 is re-evaluated against the current Native policy contract (maximum 30 candidates; actual eligible/published count may be lower).
- If Step 28 passes, certification continues through Steps 29–36 without bypassing any guard.
