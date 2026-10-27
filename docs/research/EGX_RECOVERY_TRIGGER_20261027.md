# EGX recovery verification — 2026-10-27

This change deliberately triggers the pre-existing read-only history recovery workflow on the research branch.

- Pinned input branch: `research/independent-history-recovery-hub-20261027`
- Price-truth source snapshot: generatedAt 2026-10-27T05:06:56.020Z, expectedSession 2026-10-26
- Accepted rows: 204; rejected: 12; history files updated: 180; missing history files: 24
- The previously discussed 35 coverage gaps / 15 model-readiness gaps must be independently recomputed from a common pinned revision. Do not assume these counts equal the missing-history-file count.
- Evidence-only execution; any legacy OHLCV candidate requires security identity, session proof, corporate-action reconciliation and independent parity before promotion.
- No G09/G11 certification, production cutover, or executable paper orders are authorized by this marker.
- Workflow must upload `artifacts/history-recovery/` for investigation; failed or inconclusive results remain blocked.
