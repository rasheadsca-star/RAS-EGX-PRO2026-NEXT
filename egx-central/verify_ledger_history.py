#!/usr/bin/env python3
"""Validate that a research backup manifest is the last member of its hash-chained history."""
import argparse,hashlib,json
from pathlib import Path
def check(history,manifest):
    rows=[json.loads(x) for x in Path(history).read_text().splitlines() if x.strip()]
    if not rows:raise ValueError("missing history records")
    previous="GENESIS"
    for row in rows:
        if row.get("previous_entry_sha256")!=previous:raise ValueError("history chain broken")
        body={k:v for k,v in row.items() if k!="entry_sha256"}
        digest=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(",",":")).encode()).hexdigest()
        if digest!=row.get("entry_sha256"):raise ValueError("history entry tampered")
        previous=digest
    state=json.loads(Path(manifest).read_text())
    latest=rows[-1]
    for key,history_key in (("count","count"),("sha256","file_sha256"),("ids_sha256","ids_sha256")):
        if state.get(key)!=latest.get(history_key):raise ValueError("last history entry does not match manifest")
    if state.get("trading_eligible") is not False or state.get("production_modified") is not False:
        raise ValueError("unsafe manifest")
    return {"valid":True,"entries":len(rows),"current_count":state["count"],"last_run":latest.get("run")}
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--history",required=True);p.add_argument("--manifest",required=True)
    a=p.parse_args();print(json.dumps(check(a.history,a.manifest)))
