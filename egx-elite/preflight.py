#!/usr/bin/env python3
"""Read-only EGX ELITE readiness report. Standard library only."""
import datetime as dt
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
REQ = [
 "research_v4/frozen_v4a_rule.json",
 "tools/daily_scan.py",
 "data/yahoo5y/corporate_actions.csv",
]
def read(path):
 try: return json.loads((ROOT/path).read_text(encoding="utf-8"))
 except (OSError, ValueError): return None

def report():
 price=read("data/stable/v15-price-truth.json") or {}
 app=read("astra-prod/app/data.json") or {}
 handoff=read("data/ops/g22-main-app-handoff.json") or {}
 sources=read("data/stable/v16-market-second-source-evidence.json") or {}
 missing=[p for p in REQ if not (ROOT/p).is_file()]
 return {
  "schema":"egx-elite-preflight-v1",
  "checked_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
  "paper_only":True,
  "recommendations_validated":False,
  "state":"BLOCKED_MISSING_INPUTS" if missing else "INPUTS_PRESENT_UNVERIFIED",
  "missing_required_files":missing,
  "price_session":price.get("expectedSession"),
  "price_accepted_rows":price.get("acceptedRows"),
  "production_floor":200,
  "handoff_session":handoff.get("sessionDate"),
  "decision_snapshot_session":(app.get("sourceDecision") or {}).get("session"),
  "second_source_session":sources.get("expectedSession"),
  "source_session_matched":sources.get("expectedSession")==price.get("expectedSession"),
  "handoff_decision_matched":handoff.get("sessionDate")==(app.get("sourceDecision") or {}).get("session"),
  "warning":"No signals, target weights or performance may be inferred from this report."
 }
if __name__=="__main__":
 output=ROOT/"egx-elite"/"preflight.json"
 output.parent.mkdir(exist_ok=True)
 output.write_text(json.dumps(report(),ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print(json.dumps(report(),ensure_ascii=False,indent=2))
