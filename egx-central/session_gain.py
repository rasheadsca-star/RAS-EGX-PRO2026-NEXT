#!/usr/bin/env python3
"""Count genuinely new symbol-session coverage between two quarantined evidence ledgers."""
import argparse,collections,json,sqlite3
from pathlib import Path

def read(path):
    if not path or not Path(path).exists():return set(),set(),set()
    con=sqlite3.connect(f"file:{Path(path).resolve()}?mode=ro",uri=True)
    try:
        if con.execute("PRAGMA integrity_check").fetchone()[0]!="ok":raise ValueError("corrupt evidence ledger")
        rows=con.execute("SELECT evidence_id,symbol,session,provider,status FROM observations").fetchall()
        if any(x[4]!="QUARANTINED" for x in rows):raise ValueError("unsafe status")
        return {x[0] for x in rows},{(x[1],x[2]) for x in rows},{(x[1],x[2],x[3]) for x in rows}
    finally:con.close()

def calculate(previous,current,report):
    oldids,olddays,oldfeeds=read(previous)
    newids,newdays,newfeeds=read(current)
    if not oldids.issubset(newids):raise ValueError("lost historical evidence")
    added=sorted(newdays-olddays)
    result={"schema":"egx-new-session-gain-1","previous_evidence":len(oldids),
        "current_evidence":len(newids),"new_evidence":len(newids-oldids),
        "previous_symbol_sessions":len(olddays),"current_symbol_sessions":len(newdays),
        "new_symbol_sessions":len(added),"new_symbol_session_providers":len(newfeeds-oldfeeds),
        "added_session_examples":[{"symbol":s,"session":d} for s,d in added[:30]],
        "certified_new_sessions":0,"v4a_eligible":False,"production_modified":False}
    Path(report).write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result));return result
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--previous");p.add_argument("--current",required=True);p.add_argument("--report",required=True)
    a=p.parse_args();calculate(a.previous,a.current,a.report)
