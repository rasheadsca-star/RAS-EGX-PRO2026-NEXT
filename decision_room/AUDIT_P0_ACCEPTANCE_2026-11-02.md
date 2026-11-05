# EGX PRO — Independent Audit P0 Action and Acceptance Plan (2026-11-02)

Status: RESEARCH ONLY — NO_STRATEGY_APPROVED.

## Review findings (reported by Claude; reproduce independently)
- 642,438 total rows = 424,159 RAW + 218,279 ADJUSTED. Only RAW is allowed for canonical price calculations.
- Official 2026-11-02 merge added 110 verified RAW records; reviewer independently reported 145 possible matches, and 115 unmatched due in part to multiline company names. Each match must be verified against canonical symbols before insertion.
- 91 stale instruments and only 8 passing gates among 243; never waive freshness to boost recommendations.
- AJWA research prices: entry 209.6285, stop 195.41, target1 230.95625, target2 245.17475, unrounded and nonexecutable.
- Claimed 70% hit rate rejected. Reviewer reports 37.7% T1-before-stop, -0.78% mean net return over 2017–2023; reproduce and preserve untouched holdout.
- Reviewer found official merge not atomic/idempotent and Vercel live status unverified.

## Facts independently checked
- .github/workflows/egx-official-eod.yml exists only in feature/paper-scenarios-review-20261102, NOT main.
- This workflow intentionally exits unsuccessfully after PDF staging because the verified symbol-to-ticker map and central DB handoff are absent.
- decision_room/ingest_daily.py handles separate S1 history and should not be mistaken for verified official PDF ingestion.
- Full deployment of recomputed plans and durable EOD persistence have NOT been demonstrated.

## P0 implementation sequence
1. Establish persisted authoritative SQLite baseline and immutable SHA-256 deltas, backup and restore. Check private repo status and storage limits before uploading DB.
2. Repair official multiline PDF rows, normalize canonical company identities, verify ticker/ISIN mappings, preserve explicit unmatched/rejected records and reconcile market totals.
3. Make official merge idempotent and atomic: staged SQLite backup, unique session+ticker key, full provenance, integrity/coverage gates, and safe swap.
4. Wire actual EOD job into DEFAULT BRANCH only after passing tests; on failure preserve prior release and issue explicit user alert requesting official PDF if inaccessible.
5. Regenerate all ranking and paper scenario prices from the same persisted RAW database on every successful session, with provenance and content hashes; no HTML/JSON patching.
6. Verify complete decision-room preview on Vercel with GET, source_session, snapshot SHA and browser tests. Never use Vercel READY alone as evidence.
7. Validate costs, ticks, liquidity, stop/target intrabar ambiguity and unseen holdout. Preserve NO_STRATEGY_APPROVED until evidence warrants approval.

## P0 acceptance gates
- [ ] Reconcile 110 vs 145 and account for every official PDF stock row.
- [ ] Demonstrate total/RAW/ADJUSTED row math and exclude adjusted history from unadjusted signal computations.
- [ ] Import identical report twice: no duplication, no changed canonical prices on second import.
- [ ] Fault injection: stale PDF, corrupt DB, storage errors and deployment failure leave previous verified release intact and notify owner.
- [ ] Complete HTML and JSON regenerate from identical dated SQLite, with matching manifest hash.
- [ ] Validate two successive official trading sessions end-to-end, with persistent DB and verified live preview.
- [ ] Independent and holdout performance tests pass before trading approval.

No production changes are authorized by this document.
