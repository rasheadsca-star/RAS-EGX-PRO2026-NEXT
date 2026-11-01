#!/usr/bin/env python3
"""Idempotent daily job: staged build -> validate -> atomic swap -> journal -> job_health.json.
Fails loudly (exit 2) and leaves the previously published files untouched on any error.
usage: run_daily.py --db central.sqlite --out public/ [--journal journal/decision_journal.jsonl]
NOTE: this job reads a central SQLite. Importing a new EGX session into that DB (licensed/verified sources) is a separate step."""
import argparse,json,os,sys,pathlib,tempfile,datetime,traceback,shutil
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from egx_decision import snapshot,render,journal
def atomic_write(path,text):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix=".tmp_");
    with os.fdopen(fd,"w",encoding="utf-8") as f:f.write(text)
    os.chmod(tmp,0o644);os.replace(tmp,path)
def main(argv=None):
    a=argparse.ArgumentParser();a.add_argument("--db",required=True);a.add_argument("--out",required=True);a.add_argument("--journal",default=None);a.add_argument("--now")
    x=a.parse_args(argv);out=pathlib.Path(x.out);now=datetime.datetime.fromisoformat(x.now) if x.now else datetime.datetime.now(datetime.timezone.utc)
    health=dict(job="egx-decision-daily",started_utc=now.isoformat(),status="FAILED",error=None)
    try:
        snap=snapshot.build(x.db,now=now)
        html=render.page(snap)
        if x.journal:health["journal"]=journal.append(x.journal,snap["source_session"],snapshot.decision_facts(snap))
        atomic_write(out/"decision_snapshot.json",json.dumps(snap,ensure_ascii=False,indent=1))
        atomic_write(out/"index.html",html)
        health.update(status="OK",source_session=snap["source_session"],content_sha256=snap["content_sha256"],ranked=len(snap["ranked"]),watchlist=len(snap["watchlist"]),blocked=len(snap["blocked"]),market_state=snap["market"].get("state"))
        rc=0
    except Exception as e:
        health.update(status="FAILED",error=f"{type(e).__name__}: {e}");rc=2
        sys.stderr.write(traceback.format_exc())
    atomic_write(out/"job_health.json",json.dumps(health,ensure_ascii=False,indent=1))
    print(json.dumps(health,ensure_ascii=False));return rc
if __name__=="__main__":sys.exit(main())
