#!/usr/bin/env python3
"""Identify candles on venue closures and candidate government holidays; research quarantine only."""
import argparse,collections,json,sqlite3
from pathlib import Path
from egx_holiday_review import classify
def inspect(db,out):
 con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
 counts=collections.Counter();examples=collections.defaultdict(list)
 try:
  for symbol,day,status in con.execute("SELECT symbol,session,status FROM observations"):
   if status!="QUARANTINED":raise ValueError("unsafe evidence")
   try:state=classify(day)["status"]
   except (ValueError,TypeError):state="INVALID_DATE"
   counts[state]+=1
   if state in ("EXCHANGE_CLOSED_CONFIRMED","POSSIBLE_HOLIDAY_REVIEW","INVALID_DATE") and len(examples[state])<15:
    examples[state].append({"symbol":symbol,"session":day})
 finally:con.close()
 report={"schema":"egx-candle-holiday-conflict-audit-1","counts":dict(counts),
   "examples":dict(examples),"confirmed_closure_conflicts":counts["EXCHANGE_CLOSED_CONFIRMED"],
   "pending_holiday_review":counts["POSSIBLE_HOLIDAY_REVIEW"],
   "holiday_calendar_complete":False,"trading_eligible":False,"production_modified":False,
   "warning":"Venue-specific closures require fresh corroboration; government dates are review candidates, not automatic exclusions."}
 Path(out).parent.mkdir(parents=True,exist_ok=True)
 Path(out).write_text(json.dumps(report,indent=2)+"\n")
 print(json.dumps({"counts":dict(counts),"trading_eligible":False}))
 return report
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();inspect(a.db,a.output)
