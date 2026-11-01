#!/usr/bin/env python3
"""Idempotent daily job. Reads a central SQLite, builds the decision snapshot, publishes it failure-safely (see publish.py), writes job_health.json LAST.
Exit 2 on any failure; the previously published release stays live. usage: run_daily.py --db central.sqlite --out public/ [--journal j.jsonl]"""
import argparse,json,os,sys,pathlib,tempfile,datetime,traceback
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from egx_decision import snapshot,publish
def atomic_write(path,text):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix=".tmp_")
    with os.fdopen(fd,"w",encoding="utf-8") as f:f.write(text);f.flush();os.fsync(f.fileno())
    os.chmod(tmp,0o644);os.replace(tmp,path)
def main(argv=None):
    a=argparse.ArgumentParser();a.add_argument("--db",required=True);a.add_argument("--out",required=True);a.add_argument("--journal",default=None);a.add_argument("--now")
    x=a.parse_args(argv);out=pathlib.Path(x.out);now=datetime.datetime.fromisoformat(x.now) if x.now else datetime.datetime.now(datetime.timezone.utc)
    health=dict(job="egx-decision-daily",started_utc=now.isoformat(),status="FAILED",phase="build",error=None,serving=None)
    try:
        snap=snapshot.build(x.db,now=now);health["phase"]="publish"
        info=publish.publish(out,snap,x.journal)
        health.update(status="OK",phase="done",journal=info["journal"],release=info["release"],swapped=info["swapped"],source_session=snap["source_session"],
            content_sha256=snap["content_sha256"],ranked=len(snap["ranked"]),watchlist=len(snap["watchlist"]),blocked=len(snap["blocked"]),market_state=snap["market"].get("state"))
        rc=0
    except BaseException as e:
        health.update(status="FAILED",error=f"{type(e).__name__}: {e}");rc=2
        sys.stderr.write(traceback.format_exc())
    try:health["serving"]=publish.current_release(out)
    except Exception:pass
    atomic_write(out/"job_health.json",json.dumps(health,ensure_ascii=False,indent=1))
    print(json.dumps(health,ensure_ascii=False));return rc
if __name__=="__main__":sys.exit(main())
