#!/usr/bin/env python3
"""Fail closed if append-only research evidence loses prior entries."""
import argparse,json,sqlite3,hashlib
from pathlib import Path
def ids(path):
    con=sqlite3.connect(f"file:{Path(path).resolve()}?mode=ro",uri=True)
    try:
        if con.execute("PRAGMA integrity_check").fetchone()[0]!="ok":raise ValueError("corrupt SQLite ledger")
        names={r[1] for r in con.execute("PRAGMA table_info(observations)")}
        if not {"evidence_id","status"}.issubset(names):raise ValueError("wrong ledger schema")
        if con.execute("SELECT COUNT(*) FROM observations WHERE status != 'QUARANTINED' OR status IS NULL").fetchone()[0]:
            raise ValueError("unsafe promotion found")
        return set(x[0] for x in con.execute("SELECT evidence_id FROM observations"))
    finally:con.close()
def audit(previous,current):
    old=ids(previous) if previous else set()
    new=ids(current)
    lost=old-new
    if lost:raise ValueError(f"ledger lost {len(lost)} historical observations")
    return {"schema":"egx-ledger-continuity-1","prior_count":len(old),"current_count":len(new),
      "new_since_prior":len(new-old),"lost_count":0,"production_modified":False,"approved_count":0,
      "current_set_sha256":hashlib.sha256("\\n".join(sorted(new)).encode()).hexdigest()}
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--previous");p.add_argument("--current",required=True);p.add_argument("--report",required=True);a=p.parse_args()
    result=audit(a.previous,a.current);Path(a.report).write_text(json.dumps(result,indent=2)+"\\n");print(json.dumps(result))
