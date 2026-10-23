#!/usr/bin/env python3
"""Audit Yahoo EGX feed identity and timestamp mapping before research ingestion."""
import argparse,collections,datetime,json
from pathlib import Path
def inspect(source,output):
 data=json.loads(Path(source).read_text())
 counts=collections.Counter();examples=[]
 for stock in data.get("rows",[]):
  expected=str(stock.get("symbol","")).upper()+".CA"
  for attempt in stock.get("attempts",[]):
   if attempt.get("source")!="yahoo_chart":continue
   meta=attempt.get("yahoo_meta") or {}
   observed=str(meta.get("symbol") or "").upper()
   currency=str(meta.get("currency") or "").upper()
   zone=meta.get("exchangeTimezoneName")
   for bar in attempt.get("candidate",[]):
    try:
     d=datetime.date.fromisoformat(bar["session"])
     utc=datetime.date.fromisoformat(bar["utc_session"])
     t=datetime.datetime.fromtimestamp(bar["raw_timestamp"],datetime.timezone.utc).date()
    except (ValueError,TypeError,KeyError,OverflowError):
     state="MISSING_TIMESTAMP_PROOF"
    else:
     if observed!=expected:state="SYMBOL_IDENTITY_REVIEW"
     elif currency!="EGP":state="CURRENCY_REVIEW"
     elif zone not in ("Africa/Cairo","Egypt"):state="TIMEZONE_REVIEW"
     elif utc!=t:state="UTC_TIMESTAMP_MISMATCH"
     elif d.weekday() in (4,5):state="CAIRO_WEEKEND_REVIEW"
     else:state="METADATA_CONSISTENT_UNVERIFIED"
    counts[state]+=1
    if state!="METADATA_CONSISTENT_UNVERIFIED" and len(examples)<30:
     examples.append({"symbol":stock.get("symbol"),"session":bar.get("session"),"state":state,"currency":currency,"timezone":zone})
 report={"schema":"egx-yahoo-identity-time-audit-1","counts":dict(counts),"examples":examples,
  "certified_sessions":0,"v4a_eligible":False,"production_modified":False,
  "warning":"Yahoo metadata and timestamp consistency do not prove an official EGX session or trading entitlement."}
 Path(output).write_text(json.dumps(report,indent=2)+"\n")
 print(json.dumps(report));return report
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--source",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();inspect(a.source,a.output)
