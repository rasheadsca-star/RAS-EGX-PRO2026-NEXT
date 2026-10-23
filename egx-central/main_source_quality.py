#!/usr/bin/env python3
"""Read-only quality assessment of latest OHLCV main feed; no automatic approvals."""
import argparse,datetime,hashlib,json,subprocess,collections,math
from pathlib import Path

def audit(output):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    subprocess.run(["git","fetch","--no-tags","--depth=1","origin","main"],check=True,timeout=90,capture_output=True)
    sha=subprocess.run(["git","rev-parse","FETCH_HEAD"],check=True,capture_output=True,text=True).stdout.strip()
    names=subprocess.run(["git","ls-tree","--name-only",sha+":data/history"],check=True,capture_output=True,text=True).stdout.splitlines()
    counts=collections.Counter();dates=collections.Counter();examples=[]
    for name in names:
        if not name.endswith(".json"):continue
        try:
            blob=subprocess.run(["git","show",sha+":data/history/"+name],check=True,capture_output=True,timeout=20).stdout
            doc=json.loads(blob)
            for row in doc.get("sessions",[]):
                if not isinstance(row,dict):continue
                day=row.get("date");src=row.get("primarySource") or row.get("source")
                ev=row.get("sourceSessionEvidence")
                flags=row.get("warnings") or []
                nums=[row.get(k) for k in ("high","low","close","volume")]
                if any(not isinstance(n,(int,float)) or not math.isfinite(n) for n in nums):counts["invalid_numeric"]+=1;continue
                h,l,c,v=nums
                if min(h,l,c,v)<=0 or h<max(l,c) or l>c:counts["invalid_ohlcv"]+=1;continue
                counts["valid_structural"]+=1
                if day:dates[day]+=1
                if ev and str(ev).strip():counts["explicit_session_evidence"]+=1
                else:counts["missing_session_evidence"]+=1
                if any("reconstruct" in str(w).lower() for w in flags):counts["reconstructed_ohlc"]+=1
                if src:counts["source:"+str(src)]+=1
        except Exception as e:
            counts["file_errors"]+=1
            if len(examples)<10:examples.append({"file":name,"error":str(e)[:100]})
    latest=max(dates) if dates else None
    report={"schema":"egx-main-source-quality-1","main_commit":sha,"generated_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
      "source_files":len([n for n in names if n.endswith(".json")]),"latest_observed_session":latest,
      "symbols_on_latest_session":dates.get(latest,0),"counts":dict(counts),"sample_errors":examples,
      "automatic_promotion_allowed":False,
      "note":"Evidence strings and structural validity are not proof of independent market accuracy. Do not bypass corporate action checks."}
    (output/"main_source_quality.json").write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n")
    return report
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--output",required=True);a=p.parse_args()
    print(json.dumps(audit(a.output),ensure_ascii=False))
