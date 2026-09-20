# Astra Development Baseline Audit

- Development branch: `develop/post-g20-20260920`
- Frozen production head: `c6e8b21205e5e7b7e92f9dbc6751cc7acd2caeae`
- Certified G22 baseline head: `66b74d6f7586bd06201f6f7992ff9babf1104259`
- Finalized session: **2026-09-20**
- Canonical data head: `6f33397d93cfb81e808e00eadcc923bfbac441e0`
- DecisionSnapshot: `G09-DS-018f3ecf434a0cc921814012`
- Semantic hash: `018f3ecf434a0cc921814012bed43ac6f416b3be4fd88b288abfe055c3dd9689`
- Active / canonical / decision-ready: **224 / 209 / 207**
- Source session evidence: **95%**
- CRITICAL: **0**
- Current unresolved: **GOUR**

## Material baseline finding

The frozen repository contains stale gate/work-state control files that still describe an older G11-blocked state while the immutable handoff, G22 manifest/session refresh and production Actions prove the later G22 production state.

This development program does **not** rewrite historical certification to hide that drift. It pins the development baseline to the immutable G22 artifacts and the handoff `canonicalDataHead`.

## Production isolation

No development commit may update `main` or `frozen/production-20260920-c6e8b21`. Production deployment is explicitly out of scope until separately authorized.
