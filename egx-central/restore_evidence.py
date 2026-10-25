#!/usr/bin/env python3
"""Validate and safely restore the previous append-only research ledger."""
import argparse,os,shutil,sqlite3,tempfile
from pathlib import Path
NEEDED={"evidence_id","observed_utc","symbol","session","provider","source_url","response_sha256","open","high","low","close","volume","status","source_main_commit"}
def verify(src):
    con=sqlite3.connect(f"file:{Path(src).resolve()}?mode=ro",uri=True)
    try:
        if con.execute("PRAGMA integrity_check").fetchone()[0]!="ok":raise ValueError("SQLite integrity check failed")
        cols={x[1] for x in con.execute("PRAGMA table_info(observations)")}
        if not NEEDED.issubset(cols):raise ValueError("missing observation columns")
        if con.execute("SELECT COUNT(*) FROM observations WHERE status!='QUARANTINED' OR status IS NULL").fetchone()[0]:
            raise ValueError("unapproved rows found")
        return con.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
    finally:con.close()
def restore(src,dst):
    count=verify(src)
    dst=Path(dst);dst.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=dst.parent,suffix=".sqlite",delete=False) as t:temp=Path(t.name)
    try:
        original=sqlite3.connect(f"file:{Path(src).resolve()}?mode=ro",uri=True)
        copy=sqlite3.connect(temp)
        try:original.backup(copy)
        finally:copy.close();original.close()
        if verify(temp)!=count:raise ValueError("backup lost observations")
        os.replace(temp,dst)
    finally:temp.unlink(missing_ok=True)
    return count
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--source",required=True);p.add_argument("--dest",required=True)
    a=p.parse_args();print({"restored_rows":restore(a.source,a.dest),"status":"QUARANTINE_ONLY"})
