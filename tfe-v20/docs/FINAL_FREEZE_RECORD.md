# TFE V20 Fusion RC2 — Final Freeze Record

Freeze date: 2026-08-22

## Canonical production identity

- Engine: `TFE_V20_FUSION_RC2`
- Schema: `20.tfe.2`
- Production URL: `https://egx-tfe-v20-fusion-rc2.vercel.app/`
- Frozen runtime source commit: `66b2ac2bc63fe144d5d30d3d304350a6c0d04da9`
- Frozen production deployment: `dpl_G5yVECL2Tpp6joJYccMtij5ZA1os`
- Known-good rollback deployment: `dpl_Ghmfa5UyrRBk3Wf2fyrjBE5XxcZR`
- Release branch: `release/rc2-frozen`

## Independent review and acceptance

Claude independent review verdict before fixes: `APPROVE_WITH_FIXES`.

Required pre-freeze fixes completed:
1. Duplicate-ticker allocation defect F1 fixed by deduplicating recommendations before portfolio allocation and retaining the best rank.
2. Permanent deterministic 2000-trial cash/risk/max-weight property test added.
3. EXIT / REDUCE / REVIEW exclusion and malformed-plan exclusion regression tests added.

Additional safe hardening:
- User Stop at/above current price remains fail-closed EXIT with an explicit plausibility warning.
- Portfolio-level unpriced-holdings warning added so understated equity/P&L is not silently presented as complete.

## Final CI gate

- Validation PR: `#39` (validation only; do not merge trigger marker)
- GitHub Actions run: `32561281877`
- Runtime artifact ID: `9472840766`
- Runtime artifact ZIP digest: `sha256:d1df4b5d4f9e09f79615ab002ba6592b122eaef32549f4e18029c6c909b13fb8`
- Functional/destructive tests: `123/123 PASS`
- Red-team tests: `58/58 PASS`
- Failures: `0`

## Production acceptance after final deployment

- `/health`: HTTP 200; source commit exactly `66b2ac2bc63fe144d5d30d3d304350a6c0d04da9`.
- Policy/permissions unchanged: research only; execution, production allocation, automatic orders and automatic champion promotion all false.
- `/scan?limit=50`: unchanged across deployment on the same data snapshot: 185 scanned, 2 technical eligible, 2 publication eligible, 2 returned; rank 1 MICH, rank 2 AIFI.
- `/simulate?scope=market&symbols=220`: 185 symbols completed, 65 entered, T1 75.4%, stop 20.0%, positive 76.9%, avg net +1.29%, PF 2.41, Wilson lower 63.7%, errors 0.
- Session Monitor: HTTP 200, `scoringImpact=NONE`, `recommendationMutationAllowed=false`, `executionAllowed=false`.
- Production `portfolio-manager.js` contains F1 ticker deduplication, fail-closed Stop warning, and unpriced-holdings warning.
- Vercel runtime error clusters after deployment: none observed during acceptance window.

## Runtime integrity

`../stability/FINAL_FREEZE_SHA256SUMS.txt` contains SHA-256 hashes for all 24 production runtime files. The Vercel build fetched the exact runtime from the frozen source commit and refused the build unless all 24 hashes matched. Build acceptance marker:

`RC2_ARTIFACT_FETCHED_HASHED:24:COMMIT:66b2ac2bc63fe144d5d30d3d304350a6c0d04da9`

The existing `stability/frozen-runtime-contract.js` additionally pins critical Git blob SHAs and exact policy/permission invariants.

## Frozen analytical core

The following analytical behavior is frozen and must not be changed by ordinary maintenance:

- original scoreBars technical core
- SMA50/SMA200, RSI14, MACD, ATR penalty, volume confirmation
- hard-gate thresholds/order
- liquidity and support/resistance gates
- structural R/R and pullback-distance gates
- Wilson historical confidence
- evidence-aware Fusion weighting
- entry expiry and max hold
- 0.60% modeled round-trip cost
- STOP_FIRST same-bar rule
- no-lookahead / next-session-or-later entry timing
- publication reconciliation logic
- V20 Native provenance-only isolation
- V17 execution isolation
- research-only / execution-blocked permissions

## Change-control classes

### Class A — documentation only
May proceed without a new analytical acceptance cycle, but must not alter runtime hashes.

### Class B — presentation-only UI
Requires PR review and UI tests. Must preserve runtime analytical hashes and all execution locks.

### Class C — portfolio/ops decision-support logic
Requires full functional tests, relevant destructive/property tests, red-team suite, Preview acceptance and explicit production promotion. No Alpha feedback allowed.

### Class D — Alpha/policy/scoring/recommendation logic
Frozen. Any proposed change requires explicit owner approval, a new destructive independent review, full historical/forward baseline comparison, a new acceptance cycle, and a new freeze record. No silent edits.

### Class E — broker execution / automatic capital allocation
Prohibited in this frozen product. Requires a separate product/security approval process, not an incremental RC2 change.

## Deployment policy

Production is to remain pinned to `dpl_G5yVECL2Tpp6joJYccMtij5ZA1os` unless a deliberate new acceptance cycle is completed. Future work belongs on separate development/experimental branches. Do not manually replace the production alias from an unvalidated local build.

Rollback target: `dpl_Ghmfa5UyrRBk3Wf2fyrjBE5XxcZR`.

## Freeze status

`FROZEN_ACCEPTED_RUNTIME`

The runtime itself is commit `66b2ac2bc63fe144d5d30d3d304350a6c0d04da9`; this document and other freeze-control files are metadata only and are not part of the production runtime.
