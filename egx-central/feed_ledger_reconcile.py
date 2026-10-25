#!/usr/bin/env python3
"""Compare Yahoo feed sessions with saved quarantine records, without certifying prices."""
import argparse,collections,json,sqlite3
from pathlib import Path
def compare(feed,db,out):
 data=json.loads(Path(feed).read_text())
 expected=set()
 for row in data.get("rows",[]):
  for attempt in row.get("attempts",[]):
   if attempt.get("source")=="yahoo_chart":
    for bar in attempt.get("candidate",[]):
     expected.add((row.get("symbol"),bar.get("session")))
 con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
 try:
  saved={(s,d) for s,d in con.execute("SELECT symbol,session FROM observations WHERE status='QUARANTINED'")}
 finally:con.close()
 missing=expected-saved
 result={"schema":"egx-feed-ledger-session-reconcile-1","feed_pairs":len(expected),
 "saved_pairs":len(saved),"missing_feed_pairs":len(missing),
 "examples":sorted([{"symbol":s,"session":d} for s,d in missing],key=lambda x:(x["symbol"],x["session"]))[:15],
 "certified_sessions":0,"production_modified":False}
 Path(out).write_text(json.dumps(result,indent=2)+"\n")
 print(json.dumps(result))
 return result
if __name__=="__main__":
 p=argparse.ArgumentParser()
 for x in ("feed","db","output"):p.add_argument("--"+x,required=True)
 a=p.parse_args();compare(a.feed,a.db,a.output)
