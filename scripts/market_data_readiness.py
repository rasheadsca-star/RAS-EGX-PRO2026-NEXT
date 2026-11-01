#!/usr/bin/env python3
"""Fail-closed audit of Astra G07 migration evidence; not a trading signal."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

MARKET_ID = "H01_MARKET_OHLCV_HISTORY"

def audit(report):
    totals = report.get("totals") or {}
    sources = report.get("sourceAccounting") or []
    market = next((s for s in sources if s.get("sourceId") == MARKET_ID), None)
    problems = []
    if report.get("status") != "GREEN":
        problems.append("migration_not_green")
    if not report.get("idempotency", {}).get("pass", False):
        problems.append("migration_not_idempotent")
    if not market:
        problems.append("market_ohlcv_source_missing")
        market = {}
    if not market.get("accounting", {}).get("equationCloses", False):
        problems.append("market_accounting_not_reconciled")
    if int(totals.get("unexplainedDataLoss", -1)) != 0:
        problems.append("unexplained_data_loss")
    imported = int(market.get("normalizedImported", 0))
    if imported == 0:
        problems.append("no_canonical_market_history")
    # A migration ledger alone cannot prove tradable prices, dates, freshness,
    # data vendor rights, adjusted candles, or true out-of-sample performance.
    return {
        "schemaVersion": "egx-market-readiness-audit-v1",
        "migrationEvidence": "PASS" if not problems else "FAIL",
        "tradingReadiness": "NOT_PROVEN",
        "recommendationsEnabled": False,
        "sourceReportStatus": report.get("status"),
        "sourceWorkflowRunId": report.get("workflowRunId"),
        "discoveredRecordsAllKinds": totals.get("discovered"),
        "canonicalRecordsAllKinds": totals.get("canonicalRecords"),
        "unresolvedRecordsAllKinds": totals.get("unresolved"),
        "marketHistory": {
            "sourceId": MARKET_ID,
            "discovered": market.get("physicalRecordsDiscovered"),
            "normalized": imported,
            "invalid": market.get("invalid"),
            "unresolved": market.get("unresolved")
        },
        "blockers": problems,
        "tradingPrerequisites": [
            "Verify distinct (ticker, session) OHLCV bars and chronology",
            "Verify licensed authoritative source, provenance and corporate actions",
            "Confirm latest completed EGX session and market holiday/calendar",
            "Run point-in-time backtests and frozen out-of-sample walk-forward",
            "Check current deployment consumes verified dataset, not stale snapshots"
        ]
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="docs/astra/MIGRATION_RECONCILIATION.json")
    parser.add_argument("--output", default="artifacts/market_data_readiness.json")
    parser.add_argument("--strict-migration", action="store_true")
    args = parser.parse_args()
    result = audit(json.loads(Path(args.input).read_text(encoding="utf-8")))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.strict_migration and result["migrationEvidence"] != "PASS":
        raise SystemExit(1)

if __name__ == "__main__":
    main()
