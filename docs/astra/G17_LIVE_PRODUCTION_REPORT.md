# G17 Live Production Verification

- Status: **PASS**
- Provider: **GitHub Pages**
- Source HEAD: `6bcddfff78427ff6a9a51387f1e9367b20b0e91e`
- Workflow run: **35475612451**
- Production URL: https://rasheadsca-star.github.io/RAS-EGX-PRO2026-NEXT/astra-prod/
- Runtime URL: https://rasheadsca-star.github.io/RAS-EGX-PRO2026-NEXT/astra-prod/runtime/v18/index.html
- Chromium: **152.0.7977.82**
- Production root redirect: **PASS**
- Desktop live runtime: **PASS**
- Mobile live runtime: **PASS**
- Live runtime files byte-exact: **PASS**
- Persisted Decision Truth byte-exact: **PASS**
- External requests: **0**
- DecisionSnapshot ID: `G09-DS-5c4fe9389f6f72cd52d41ecd`
- Semantic decision hash: `5c4fe9389f6f72cd52d41ecdee61432c24b071301eb1f4b566d1776052fe8260`
- Fail-closed live resource outage scenario: **PASS**
- Legacy runtime dependencies: **0**
- Production cutover: **false**

## Acceptance boundary

G17 verifies the already deployed isolated Astra production path in a real Chromium browser. It does not change or exercise a legacy/public cutover. The live surface must render the certified persisted decision truth, remain same-origin only, match certified runtime/truth bytes, and fail closed when the primary decision resource is unavailable.
