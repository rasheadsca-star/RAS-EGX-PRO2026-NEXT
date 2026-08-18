# V20 Session Refresh Audit — 2026-08-18

Purpose: force a certified V20 V17-centric refresh after the authoritative V17 runtime advanced to session 2026-08-18 while persisted V20 Native/Decision Board artifacts remained on 2026-08-16.

Observed before refresh:
- V17 authoritative runtime (`develop/v17-rebuild/data/v17/current.json`): session 2026-08-18.
- V20 Native persisted artifact (`data/v20/native-current.json`): session 2026-08-16.
- The Decision Board therefore continued to display the older agreement/session date.

Required behavior:
- Rebuild V20 Native from the latest read-only V17 runtime inputs.
- Rebuild V17 eligibility and the canonical final decision contract.
- Preserve fail-closed execution governance if current-session production eligibility is not satisfied.
- Persist only the certified V20 artifacts allowed by the V17-centric certification workflow.

This file is an audit/refresh trigger only; it does not change scoring, execution policy, or MAIN APP logic.
