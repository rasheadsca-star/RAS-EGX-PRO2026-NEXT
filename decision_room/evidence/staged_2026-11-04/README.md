# Staged central DB — result files (2026-11-04) — RESEARCH ONLY, NO_STRATEGY_APPROVED
The SQLite itself (~233 MB) is private and is NOT in this repo. These are the inspectable outputs derived from it.
- session_report.json — per session: imported/excluded, gaps, conflicts
- symbols_status.csv — per stock: gate result, first block reason, last trusted date
- ranking.csv / ranking.json — qualified stocks (1 ranked + 8 watchlist), paper levels non-executable
- charts.html — charts from the staged DB with last trusted date per stock
- match_proposals.csv / .md — proposed fuzzy name matches (NOT applied; owner approval required)
- stage_<date>.json, fill_holes.json, official_closes.json — staging/hole-fill reports
Tools: decision_room/tools/{stage_official,stage_chain,fill_holes,proposals_table,build_phase_outputs}.py; tests: decision_room/tests/test_stage_and_fill.py etc.
