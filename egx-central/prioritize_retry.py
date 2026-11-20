#!/usr/bin/env python3
"""Rank stale-stock retry candidates by missing research coverage, without claiming certified prices."""
import argparse,collections,json,sqlite3
from pathlib import Path

def prioritize(candidates,db,out):
    obj=json.loads(Path(candidates).read_text(encoding="utf-8"))
    if obj.get("read_only") is not True:raise ValueError("Expected read-only retry plan")
    records=collections.defaultdict(set)
    if Path(db).exists():
        con=sqlite3.connect(f"file:{Path(db).resolve()}?mode=ro",uri=True)
        try:
            for sym,session,status in con.execute("SELECT symbol,session,status FROM observations"):
                if status!="QUARANTINED":raise ValueError("Unsafe ledger status")
                records[str(sym).upper()].add(str(session))
        finally:con.close()
    ordered=[]
    for item in obj.get("candidates",[]):
        symbol=str(item.get("symbol","")).upper()
        previous=records[symbol]
        priority=(100 if item.get("missing_latest_observation") else 0)+(60 if item.get("short_history") else 0)
        # Previously unobserved candidates are prioritised, but not certified.
        priority+=min(50,max(0,50-len(previous)))
        ordered.append(dict(item, symbol=symbol,ledger_distinct_sessions=len(previous),
                            priority_score=priority,reason="EXPAND_MISSING_SESSION_COVERAGE_RESEARCH_ONLY"))
    ordered.sort(key=lambda x:(-x["priority_score"],x["ledger_distinct_sessions"],x["symbol"]))
    result=dict(obj,candidates=ordered,candidate_count=len(ordered),
                schema="egx-coverage-prioritized-retry-1",read_only=True,
                automatic_promotion=False,
                warning="Priority is for research collection, not verified market coverage.")
    Path(out).write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"candidates":len(ordered),"first_five":[x["symbol"] for x in ordered[:5]]}))
    return result
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--candidates",required=True);p.add_argument("--ledger",required=True);p.add_argument("--output",required=True)
    a=p.parse_args();prioritize(a.candidates,a.ledger,a.output)
