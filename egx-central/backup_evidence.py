#!/usr/bin/env python3
"""Fail-closed daily warehouse snapshots for a dedicated research-only git branch."""
import argparse,hashlib,json,os,sqlite3
from pathlib import Path
def snapshot(db,output,manifest):
    p=Path(db)
    conn=sqlite3.connect(f"file:{p.resolve()}?mode=ro",uri=True)
    try:
        if conn.execute("PRAGMA integrity_check").fetchone()[0]!="ok":raise ValueError("database corrupt")
        rows=conn.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
        bad=conn.execute("SELECT COUNT(*) FROM observations WHERE status <> 'QUARANTINED' OR status IS NULL").fetchone()[0]
        if bad:raise ValueError("unsafe observations")
        ids=[r[0] for r in conn.execute("SELECT evidence_id FROM observations ORDER BY evidence_id")]
    finally:conn.close()
    target=Path(output);target.parent.mkdir(parents=True,exist_ok=True)
    # SQLite online backup ensures database snapshot is transactionally consistent.
    src=sqlite3.connect(f"file:{p.resolve()}?mode=ro",uri=True)
    dst=sqlite3.connect(target)
    try:src.backup(dst)
    finally:src.close();dst.close()
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    obj={"schema":"egx-quarantine-git-backup-1","count":rows,"sha256":digest,
         "ids_sha256":hashlib.sha256("\n".join(ids).encode()).hexdigest(),
         "production_modified":False,"trading_eligible":False}
    Path(manifest).write_text(json.dumps(obj,indent=2)+"\n")
    return obj
if __name__=="__main__":
    a=argparse.ArgumentParser();a.add_argument("--db",required=True);a.add_argument("--output",required=True);a.add_argument("--manifest",required=True)
    v=a.parse_args();print(json.dumps(snapshot(v.db,v.output,v.manifest)))
