#!/usr/bin/env python3
"""Verify the persisted research ledger against its separately versioned manifest."""
import argparse,hashlib,json,sqlite3
from pathlib import Path
def check(database,manifest):
    db=Path(database)
    m=json.loads(Path(manifest).read_text(encoding="utf-8"))
    if m.get("schema")!="egx-quarantine-git-backup-1" or m.get("production_modified") is not False or m.get("trading_eligible") is not False:
        raise ValueError("invalid or unsafe evidence manifest")
    if hashlib.sha256(db.read_bytes()).hexdigest()!=m.get("sha256"):
        raise ValueError("ledger file SHA256 mismatch")
    con=sqlite3.connect(f"file:{db.resolve()}?mode=ro",uri=True)
    try:
        if con.execute("PRAGMA integrity_check").fetchone()[0]!="ok":raise ValueError("SQLite corruption")
        rows=con.execute("SELECT evidence_id,status FROM observations ORDER BY evidence_id").fetchall()
    finally:con.close()
    if any(status!="QUARANTINED" for _,status in rows):raise ValueError("unsafe evidence row")
    digest=hashlib.sha256("\n".join(i for i,_ in rows).encode()).hexdigest()
    if len(rows)!=m.get("count") or digest!=m.get("ids_sha256"):
        raise ValueError("ledger manifest logical mismatch")
    return {"ok":True,"count":len(rows),"quarantine_only":True}
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--manifest",required=True)
    a=p.parse_args();print(json.dumps(check(a.db,a.manifest)))
