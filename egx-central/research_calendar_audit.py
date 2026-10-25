#!/usr/bin/env python3
"""Research-only market date coverage; weekdays do not certify an EGX session."""
import argparse,collections,datetime,json,sqlite3
from pathlib import Path

def inspect(db,output):
    con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
    counts=collections.Counter()
    covered=collections.defaultdict(set)
    try:
        for symbol,session,status in con.execute("SELECT symbol,session,status FROM observations"):
            if status!="QUARANTINED":
                raise ValueError("Non-research evidence")
            try:
                date=datetime.date.fromisoformat(session)
            except (TypeError,ValueError):
                date=None
            if date is None:
                counts["INVALID_DATE"]+=1
            elif date.weekday() in (4,5):
                counts["WEEKEND_REVIEW"]+=1
            else:
                counts["WEEKDAY_UNVERIFIED"]+=1
                covered[symbol].add(session)
    finally:
        con.close()
    result={"schema":"egx-session-calendar-audit-1","counts":dict(counts),
        "unique_symbol_sessions":sum(len(v) for v in covered.values()),
        "symbols":len(covered),"certified_sessions":0,
        "trading_eligible":False,"production_modified":False}
    Path(output).write_text(json.dumps(result,indent=2)+"\n")
    return result

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--db",required=True)
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    print(json.dumps(inspect(args.db,args.output)))
