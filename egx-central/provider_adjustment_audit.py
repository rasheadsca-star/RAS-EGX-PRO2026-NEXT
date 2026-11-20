#!/usr/bin/env python3
"""Audit provider adjustedClose against raw close before any hypothetical adjustment."""
import argparse,collections,datetime,json,math,subprocess
from pathlib import Path

def audit(output):
    out=Path(output);out.mkdir(parents=True,exist_ok=True)
    subprocess.run(["git","fetch","--no-tags","--depth=1","origin","main"],check=True,capture_output=True,timeout=90)
    sha=subprocess.run(["git","rev-parse","FETCH_HEAD"],check=True,capture_output=True,text=True).stdout.strip()
    names=subprocess.run(["git","ls-tree","--name-only",sha+":data/history"],check=True,capture_output=True,text=True).stdout.splitlines()
    counts=collections.Counter();examples=[]
    for name in names:
        if not name.endswith(".json"):continue
        raw=subprocess.run(["git","show",sha+":data/history/"+name],capture_output=True,timeout=30,check=True).stdout
        doc=json.loads(raw)
        for row in doc.get("sessions",[]):
            if not isinstance(row,dict):continue
            close,adj=row.get("close"),row.get("adjustedClose")
            if not all(isinstance(v,(int,float)) and math.isfinite(v) and v>0 for v in (close,adj)):
                counts["MISSING_OR_INVALID_PAIR"]+=1;continue
            difference=abs(adj/close-1)
            if difference>0.0001:
                counts["PROVIDER_ALREADY_ADJUSTED_CANDIDATE"]+=1
                if len(examples)<100:examples.append({"symbol":doc.get("ticker"),"date":row.get("date"),"close":close,"adjustedClose":adj,"source":row.get("primarySource")})
            else:counts["SAME_ADJUSTED_AND_CLOSE"]+=1
    result={"schema":"egx-provider-adjustment-audit-1","main_commit":sha,
      "generated_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
      "counts":dict(counts),"examples":examples,"automatic_double_adjustment_allowed":False,
      "policy":"Provider adjustedClose differing from close is a warning, not proof of any particular corporate action or adjustment method"}
    (out/"provider_adjustment_audit.json").write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n")
    return result
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--output",required=True);a=p.parse_args()
    print(json.dumps(audit(a.output),ensure_ascii=False))
