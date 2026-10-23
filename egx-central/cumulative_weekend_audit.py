#!/usr/bin/env python3
"""Flag weekend dates in cumulative research ledger, regardless of today's feed."""
import argparse,collections,datetime,json,sqlite3
from pathlib import Path

def audit(db,output):
    con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
    totals=collections.Counter();examples=[];pairs=set()
    try:
        for symbol,session,provider,status in con.execute("SELECT symbol,session,provider,status FROM observations"):
            if status!="QUARANTINED":raise ValueError("Non-quarantined data")
            try:day=datetime.date.fromisoformat(session)
            except (TypeError,ValueError):key="INVALID_DATE"
            else:key="WEEKEND" if day.weekday() in (4,5) else "WEEKDAY"
            totals[key]+=1
            if key=="WEEKEND":
                pairs.add((symbol,session))
                if len(examples)<20:examples.append({"symbol":symbol,"session":session,"provider":provider})
    finally:con.close()
    result={"schema":"egx-cumulative-weekend-audit-1","evidence_rows":sum(totals.values()),
      "weekend_rows":totals["WEEKEND"],"weekday_rows":totals["WEEKDAY"],
      "invalid_date_rows":totals["INVALID_DATE"],"distinct_weekend_symbol_sessions":len(pairs),
      "weekend_examples":examples,"official_calendar_verified":False,
      "trading_eligible":False,"production_modified":False}
    Path(output).write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result));return result
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--output",required=True)
    a=p.parse_args();audit(a.db,a.output)
