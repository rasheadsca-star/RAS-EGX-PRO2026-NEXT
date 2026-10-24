#!/usr/bin/env python3
"""Read-only eligibility labels for provider raw/adjusted closes. No V4A promotion."""
import argparse,collections,csv,datetime,json,math,subprocess
from pathlib import Path
def classify(close,adjusted,warnings):
    if not isinstance(close,(int,float)) or not math.isfinite(close) or close<=0:return "BLOCK_INVALID_RAW_CLOSE"
    flags=warnings if isinstance(warnings,list) else []
    if any("reconstruct" in str(w).lower() for w in flags):return "BLOCK_RECONSTRUCTED_OHLC"
    if not isinstance(adjusted,(int,float)) or not math.isfinite(adjusted) or adjusted<=0:
        return "RAW_RESEARCH_ONLY_NO_ADJUSTED_PROOF"
    if abs(adjusted/close-1)>0.0001:return "RAW_RESEARCH_ONLY_PROVIDER_ADJUSTMENT_CONFLICT"
    return "RAW_RESEARCH_ONLY_MATCHING_ADJUSTED"
def build(outdir):
    out=Path(outdir);out.mkdir(parents=True,exist_ok=True)
    subprocess.run(["git","fetch","--no-tags","--depth=1","origin","main"],check=True,capture_output=True,timeout=90)
    sha=subprocess.run(["git","rev-parse","FETCH_HEAD"],check=True,capture_output=True,text=True).stdout.strip()
    names=subprocess.run(["git","ls-tree","--name-only",sha+":data/history"],check=True,capture_output=True,text=True).stdout.splitlines()
    counts=collections.Counter()
    with (out/"research_price_eligibility.csv").open("w",encoding="utf-8",newline="") as f:
        w=csv.writer(f);w.writerow(["symbol","session","raw_close","provider_adjusted_close","classification","v4a_eligible"])
        for name in names:
            if not name.endswith(".json"):continue
            data=json.loads(subprocess.run(["git","show",sha+":data/history/"+name],check=True,capture_output=True,timeout=30).stdout)
            sym=data.get("ticker") or name.removesuffix(".json")
            for row in data.get("sessions",[]):
                if not isinstance(row,dict):continue
                status=classify(row.get("close"),row.get("adjustedClose"),row.get("warnings"))
                counts[status]+=1
                w.writerow([sym,row.get("date"),row.get("close"),row.get("adjustedClose"),status,"false"])
    report={"schema":"egx-price-eligibility-1","source_commit":sha,"counts":dict(counts),
      "v4a_eligible_count":0,"promoted_count":0,"production_modified":False,
      "warning":"Matching adjustedClose proves neither independent price accuracy nor verified OHLC highs/lows, source identity, or corporate action validity"}
    (out/"research_price_eligibility_report.json").write_text(json.dumps(report,indent=2)+"\n")
    return report
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--output",required=True);a=p.parse_args()
    print(json.dumps(build(a.output)))
