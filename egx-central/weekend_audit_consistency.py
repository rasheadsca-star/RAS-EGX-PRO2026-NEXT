#!/usr/bin/env python3
"""Fail closed when calendar auditors disagree on research-ledger weekend evidence."""
import argparse,json
from pathlib import Path
def check(calendar_file,cumulative_file,output):
 a=json.loads(Path(calendar_file).read_text())
 b=json.loads(Path(cumulative_file).read_text())
 weekend=a.get("counts",{}).get("WEEKEND_REVIEW",0)
 actual=b.get("weekend_rows")
 rows=sum(a.get("counts",{}).values())
 reasons=[]
 if actual is None or weekend!=actual:reasons.append("WEEKEND_COUNT_MISMATCH")
 if rows!=b.get("evidence_rows"):reasons.append("EVIDENCE_COUNT_MISMATCH")
 if a.get("trading_eligible") is not False or b.get("trading_eligible") is not False:reasons.append("UNSAFE_PROMOTION")
 result={"schema":"egx-weekend-audit-consistency-1","calendar_weekend_rows":weekend,
 "cumulative_weekend_rows":actual,"calendar_rows":rows,"cumulative_rows":b.get("evidence_rows"),
 "consistent":not reasons,"reasons":reasons,"trading_eligible":False,"production_modified":False}
 Path(output).write_text(json.dumps(result,indent=2)+"\n")
 if reasons:raise ValueError("Inconsistent research calendar audits: "+", ".join(reasons))
 print(json.dumps(result));return result
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--calendar",required=True);p.add_argument("--cumulative",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();check(a.calendar,a.cumulative,a.output)
