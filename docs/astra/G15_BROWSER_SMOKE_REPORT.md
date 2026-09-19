# G15 Chromium Browser Smoke

- Status: **PASS**
- Source HEAD: `264440e2e56a524d047f6e8672c3223c1cda28ec`
- Workflow run: **35474338036**
- Chromium: **152.0.7977.82**
- Desktop viewport: **1440 × 1000**
- Mobile viewport: **390 × 844**
- External requests: **0**
- Uncaught page errors on happy paths: **0**
- DecisionSnapshot ID: `G09-DS-5c4fe9389f6f72cd52d41ecd`
- Semantic decision hash: `5c4fe9389f6f72cd52d41ecdee61432c24b071301eb1f4b566d1776052fe8260`
- Fail-closed resource outage scenario: **PASS**
- Legacy runtime dependencies: **0**
- Production cutover: **false**

## Browser acceptance boundary

The standalone Astra V18 local surface rendered persisted G11 decision truth in real Chromium on desktop and mobile, used same-origin resources only, redirected the former V18 live bootstrap to the local surface, and failed closed when the primary pipeline resource was unavailable.
