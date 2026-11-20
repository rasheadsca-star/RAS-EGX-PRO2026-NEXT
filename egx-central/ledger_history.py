#!/usr/bin/env python3
"""Append a tamper-evident manifest history to research-only Git snapshots."""
import argparse,datetime,hashlib,json
from pathlib import Path

def append(history,manifest,run):
    path=Path(history);new=json.loads(Path(manifest).read_text())
    if new.get("schema")!="egx-quarantine-git-backup-1" or new.get("trading_eligible") is not False:
        raise ValueError("invalid research manifest")
    lines=[json.loads(x) for x in path.read_text().splitlines() if x.strip()] if path.exists() else []
    for i,row in enumerate(lines):
        prior=lines[i-1].get("entry_sha256") if i else "GENESIS"
        if row.get("previous_entry_sha256")!=prior:raise ValueError("broken history chain")
        payload={k:v for k,v in row.items() if k!="entry_sha256"}
        if hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(",",":")).encode()).hexdigest()!=row.get("entry_sha256"):
            raise ValueError("history hash corrupted")
        if i and row.get("count",0)<lines[i-1].get("count",0):raise ValueError("historical count regression")
    if lines and new["count"]<lines[-1]["count"]:raise ValueError("ledger count regression")
    if lines and new["ids_sha256"]==lines[-1]["ids_sha256"] and new["count"]==lines[-1]["count"]:
        return {"changed":False,"count":new["count"],"entries":len(lines)}
    base={"schema":"egx-ledger-history-1","run":str(run),"recorded_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "count":new["count"],"ids_sha256":new["ids_sha256"],"file_sha256":new["sha256"],
        "previous_entry_sha256":lines[-1]["entry_sha256"] if lines else "GENESIS"}
    base["entry_sha256"]=hashlib.sha256(json.dumps(base,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    with path.open("a",encoding="utf-8") as file:file.write(json.dumps(base,sort_keys=True)+"\n")
    return {"changed":True,"count":new["count"],"entries":len(lines)+1}
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--history",required=True);p.add_argument("--manifest",required=True);p.add_argument("--run",required=True)
    a=p.parse_args();print(json.dumps(append(a.history,a.manifest,a.run)))
