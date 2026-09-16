# V20 Step 28 Native Current Regression Fix

## Evidence

The isolated Step 28 diagnostic run identified `native-current-regression.cjs` as the first failing subcommand after the native freshness rebuild. The generated regression evidence for session `2026-09-15` reported one failure only: `NATIVE_CURRENT_PUBLISHED_COUNT`.

Runtime evidence showed:

- eligible native research candidates: 28
- published native research candidates: 28
- policy maximum published research candidates: 30
- selection summary published count: 28
- explainability published count: 28

## Root cause

The regression interpreted `maximumPublishedResearchCandidates` as an exact required count. That incorrectly rejected a valid session with fewer eligible candidates than the configured maximum.

## Correction

`native-current-regression.cjs` now requires all of the following:

- the actual published count equals the selection summary published count;
- the actual published count does not exceed the policy maximum;
- the actual published count equals `min(eligibleCount, maximumPublishedResearchCandidates)`;
- the published list remains an exact prefix of the eligible ranking.

No execution, governance, risk, ranking, score, or eligibility guard was relaxed. The temporary Step 28 diagnostic workflow was removed after capturing the failure evidence so the integration-branch isolation contract remains unchanged.
