#!/usr/bin/env python3
"""Compare complete candles by symbol+session across independently named feeds, research only."""
import argparse,collections,json,math,sqlite3
from pathlib import Path

FIELDS=("open","high","low","close","volume")
def compare(db, output, price_tol=0.01, volume_tol=0.05):
    conn=sqlite3.connect(f"file:{Path(db).resolve()}?mode=ro",uri=True)
    grouped=collections.defaultdict(lambda:collections.defaultdict(list))
    try:
        for sym,day,provider,o,h,l,c,v,status in conn.execute(
            "SELECT symbol,session,provider,open,high,low,close,volume,status FROM observations"):
            if status!="QUARANTINED":raise ValueError("Non-quarantined evidence found")
            values=(o,h,l,c,v)
            if not all(isinstance(x,(float,int)) and math.isfinite(x) and x>0 for x in values):continue
            if h<max(o,c,l) or l>min(o,h,c):continue
            grouped[(sym,day)][provider].append(values)
    finally:conn.close()
    result=collections.Counter();examples=[]
    for (sym,day),providers in sorted(grouped.items()):
        if len(providers)<2:continue
        # Never compare stale and revised observations as if both were current.
        if any(len(set(rows))!=1 for rows in providers.values()):
            state="SOURCE_REVISION_REVIEW"
        else:
            values=[rows[0] for rows in providers.values()]
            ratios=[max(row[i] for row in values)/min(row[i] for row in values)-1 for i in range(5)]
            state="FULL_OHLCV_AGREEMENT_UNVERIFIED" if all(x<=(volume_tol if i==4 else price_tol) for i,x in enumerate(ratios)) else "FULL_OHLCV_CONFLICT"
        result[state]+=1
        if len(examples)<30:examples.append({"symbol":sym,"session":day,"providers":sorted(providers),"assessment":state})
    report={"schema":"egx-full-candle-compare-1","counts":dict(result),"examined_multi_provider_sessions":sum(result.values()),
        "examples":examples,"price_tolerance":price_tol,"volume_tolerance":volume_tol,
        "approved_count":0,"v4a_eligible":False,"production_modified":False,
        "warning":"Agreement between feeds, even on all fields, is not evidence of independent originating exchanges."}
    Path(output).write_text(json.dumps(report,indent=2)+"\n")
    return report
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--report",required=True)
    x=p.parse_args();print(json.dumps(compare(x.db,x.report)))
