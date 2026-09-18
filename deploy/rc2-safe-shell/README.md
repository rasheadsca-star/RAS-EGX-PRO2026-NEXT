# EGX TFE V20 — Astra Local Compatibility Surface

This package no longer proxies the frozen RC2 Vercel deployment.

During G12 it provides a local-only compatibility boundary:
- `/api/index?route=health` — internal TFE health.
- `/api/index?route=history&ticker=COMI&limit=260` — local repository OHLCV history.
- `POST /api/index?route=evaluate` — internal `TFE_EVIDENCE_AWARE_HARD_GATE_FUSION` execution.
- `/technical-analysis-tools.js` — exact vendored technical visualization asset from the pinned source blob.

No production cutover is performed by this package. Missing/invalid local input fails closed and there is no legacy network fallback.
