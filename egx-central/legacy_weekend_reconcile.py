#!/usr/bin/env python3
"""Separate legacy archived weekend dates from newly fetched Yahoo session dates."""
import argparse,collections,datetime,json,sqlite3
from pathlib import Path

def check(feed,db,output):
    data=json.loads(Path(feed).read_text(encoding="utf-8"))
    fresh=set()
    for row in data.get("rows",[]):
        for attempt in row.get("attempts",[]):
            if attempt.get("source")=="yahoo_chart":
                for bar in attempt.get("candidate",[]):
                    fresh.add((str(row["symbol"]),str(bar["session"])))
    con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
    try:
        records=con.execute("SELECT symbol,session,status FROM observations").fetchall()
    finally:con.close()
    buckets=collections.Counter()
    examples=[]
    for sym,day,status in records:
        if status!="QUARANTINED":raise ValueError("Unsafe evidence status")
        try:d=datetime.date.fromisoformat(day)
        except (ValueError,TypeError):bucket="INVALID_DATE"
        else:
            kind="CURRENT_FEED" if (sym,day) in fresh else "ARCHIVED_ONLY"
            bucket=kind+("_WEEKEND" if d.weekday() in (4,5) else "_WEEKDAY")
        buckets[bucket]+=1
        if bucket.endswith("_WEEKEND") and len(examples)<20:
            examples.append({"symbol":sym,"session":day,"origin_bucket":bucket})
    result={"schema":"egx-legacy-weekend-reconciliation-1","counts":dict(buckets),
      "fresh_distinct_symbol_sessions":len(fresh),"archived_observation_rows":len(records),
      "examples":examples,"certified_sessions":0,"v4a_eligible":False,"production_modified":False}
    Path(output).write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result));return result
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for k in ("feed","db","output"):p.add_argument("--"+k,required=True)
    a=p.parse_args();check(a.feed,a.db,a.output)
