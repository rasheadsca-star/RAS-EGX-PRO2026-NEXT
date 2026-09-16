# V20 Step 28 Revalidation — 2026-09-16

Purpose: trigger an Integrated certification run on the current integration-branch HEAD after the Native candidate-cardinality contract fixes were already present in source.

Validated source contracts before trigger:
- Native publication policy is a maximum of 30 candidates, not an exact-count requirement.
- `archive-native-shadow.cjs` validates the published candidate count against the current Native publication summary/cap instead of requiring exactly 30.
- `native-shadow-forward-regression.cjs` validates archive and resolved-member cardinality against each source archive candidate set instead of a fixed 30.
- No runtime guard is disabled by this revalidation trigger.

This file is certification evidence only and intentionally contains no runtime logic.
