# Staged DB after owner-approved name links (2026-11-05) — RESEARCH ONLY, NO_STRATEGY_APPROVED, qualifiedTradeCount=0
Authority: EGX_PRO_Claude_Execution_Approval_2026-11-05.docx. Staging copy only; production DB untouched; PR not merged; the SQLite is private and NOT in this repo.
Rebuild (deterministic): `tools/build_staged.py --approvals config/approved_name_links_2026-11-05.json …` ; ROLLBACK = rebuild without `--approvals` (reproduces the baseline table-for-table, verified).
- approved_name_links_2026-11-05.json — the 10 NAME_LINK_ONLY approvals (not a price-series/ISIN/eligibility approval)
- approved_matches_applied.csv — per approval×session: source name, pdf page/rank, ticker, implied vs ticker previous close, diff, status, action, baseline tier
- approved_matches_bar_changes.csv / _summary.json — every canonical bar that differs from the baseline (audit: 0 outside the 10 tickers)
- status_changes.csv/json, before/ , after/ — qualified lists and per-stock changes
- hold_cases.csv, all_proposals_decisions.csv, hold_investigation.csv — everything not applied (MTIE, PHAR, ADIB, AMOC, CIEB, CLHO, EDFM, rest)
- gaps_*_by_session.csv / _holes.csv — last 51 sessions by evidence tier, holes and reasons (no estimation)
- dependence_before/after.json — SINGLE_PROVIDER / CORROBORATED / OFFICIAL shares: whole DB, last 250 sessions, MA20/MA50 windows of qualified stocks
- wf_before.json / wf_after.json — frozen-rule Walk-Forward/OOS with costs (identical)
- conflicts_last51.csv, corporate_events.csv, corp_action_factors_RAW_vs_ADJUSTED.csv, open_field_definition_issues.csv, superseded_archive.csv
- verify_input.json / verify_output.json — sha256, integrity_check, legacy archive count, duplicate checks; SHA256SUMS.txt
