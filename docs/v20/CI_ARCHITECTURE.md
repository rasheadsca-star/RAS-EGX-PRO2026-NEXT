# V20 CI Architecture

V20 uses one authoritative main validation workflow plus the isolated market-regime refresh workflow.

Full-market technical analysis and shadow S/R remediation remain V20-only builders/regressions under `scripts/v20` and are intentionally not separate persistent workflows. This avoids race conditions, conflicting evidence commits, and isolation false positives. Their evidence must be consumed and validated by the authoritative V20 release contract before any release claim is accepted.

Branch isolation remains strict: V16, V17, V19, and `main` are not modified by V20 validation.
