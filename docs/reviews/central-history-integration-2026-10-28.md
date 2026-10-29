# Central-history recovery — integration staging (2026-10-28)

**Status: REVIEW ONLY — NOT MERGED, NOT EXECUTION GRADE.**

The user supplied Claude's `central-history.patch`, `central-history.bundle`, and a four-page report. The patch applies in a clean local scratch repository and `node --test tests/history-central/central-history.test.cjs` passed **13/13** locally. This is a **staging PR**, not an assertion that the 473-file patch has been uploaded.

## Source report (requires independent reproduction on repository main)
- 311 scanned branches; 10,751 examined files; 230 tickers with retained records.
- 79,760 admitted research rows and 27,280 quarantined observations.
- 7,869 top-tier rows (978 cross-source, 6,891 dated-session evidence).
- **Zero** verified >=60-session continuous sequences ending on 2026-10-28.
- 55 SMA/ATR trades: 47.3% wins, +1.98% average vs a distinct 80-trade baseline 55.0% wins, +2.19% average. Not evidence of trading edge.
- OHLC gaps, independent provenance, corporate actions, licensing, and ISIN confirmation remain unresolved.

## Integration requirements before merging
1. Import attached patch on a branch **based on current main**, not by force-pushing Claude's bundle: bundle requires ancestor `6bdca2e5e7a8d67620e4839cc20a39388c510f37`.
2. Add the original 8 `scripts/history-central/**` files and one `tests/history-central/central-history.test.cjs` together with the warehouse manifest, census, feasibility and accepted/quarantine datasets. Check every file hash against the original patch and manifest.
3. Re-run `node --test tests/history-central/central-history.test.cjs` AND existing `node --test tests/independent/*.test.cjs`.
4. Repeat build in CI and compare totals, quarantine codes, and SHA256 manifest; identify any conflicts with later commits.
5. Run license / price-truth / stale bars / corporate actions / ISIN and contiguous-series eligibility checks **before** attaching any dataset to recommendation engines.
6. Keep this warehouse in research-only namespace and keep `executionReady=false`, `performanceCertified=false`, and order execution disabled.
7. Only then request independent code and data review. Do not merge until the actual original artifacts are committed, checked and approved.

### Artifact handling
The original large patch and bundle were supplied in the ChatGPT conversation; they are not embedded or uploaded by this staging commit. This document cannot substitute for the original recovery implementation.

### Important distinction
A valid OHLC structure is not necessarily fully verified historical provenance, licensed re-distributable data or a 60/140/200-session uninterrupted execution-grade series.


## 2026-10-29 corrected Claude integration package — VERIFIED IN LOCAL PATCH INSPECTION

The newer package `EGX_PRO_Central_History_Integration_Package.zip` contains:
- `central-history-on-main-ae99cb97.patch` and a matching Git bundle based on `ae99cb978c75a18fd944919e3f4a77a8731fe2ab`.
- **478 unique added paths** counted from the actual patch (230 verified ticker JSONs, 230 quarantine ticker JSONs, scripts, tests and summary files); the report's **466** count is inconsistent and must not be used as an integrity gate.
- Local patch application to a fresh scratch Git worktree succeeded; `node --test tests/history-central/central-history.test.cjs` passed **14/14**.
- The report declares 70 independent tests passing on the author's full checkout; these have **not** been rerun here because the scratch patch alone does not include the original independent engine code.
- JSON schemas inspected: `manifest.files`, `census.tickers` and `feasibility.segmentCounts` are present; both `executionReady` and `performanceCertified` are false.

**Corrected quantitative results (supersede the October 28 preliminary report):**
- 230 tickers, 79,760 admitted research bars, 27,280 quarantined observations.
- Historical contiguous >=60/>=140/>=200: **38 / 10 / 4** tickers (not 43 / 10 / 5).
- Current verified contiguous >=60 ending October 28: **zero**. Longest current streak: **14** sessions.
- Corrected policy study: 50 ATR/SMA trades across 27 tickers, **50.0% wins, +1.92% expectancy** versus baseline **56.2% wins, +1.97% expectancy**; not certified and not better than baseline.
- Critical market-wide observed-session gaps include August 27, October 8, October 22 and October 25; not to be bridged synthetically.

**Merge status:** The complete dataset remains **outside this GitHub PR**. Neither a successfully applied local patch nor this review note is the same as an uploaded integration. The current connector can write text files to GitHub but cannot directly transfer this local 11 MB patch as one atomic commit, and this execution container cannot resolve github.com for `git push`. Keep PR draft / unmerged and research-only.
