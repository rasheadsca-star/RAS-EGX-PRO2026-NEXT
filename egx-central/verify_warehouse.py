#!/usr/bin/env python3
"""Assert warehouse artifacts agree and cannot silently become trading inputs."""
import argparse,csv,json,pathlib,sqlite3,sys

REQUIRED=("consensus_report.json","promotion_gate_report.json","main_source_quality.json",
          "corporate_action_source_status.json","research_adjusted_close_report.json",
          "research_price_eligibility_report.json","research_price_eligibility.csv")
def verify(folder):
    p=pathlib.Path(folder)
    missing=[x for x in REQUIRED if not (p/x).is_file()]
    if missing:return {"ok":False,"errors":["missing files: "+",".join(missing)]}
    docs={n:json.loads((p/n).read_text(encoding="utf-8")) for n in REQUIRED if n.endswith(".json")}
    errors=[]
    gate=docs["promotion_gate_report.json"]
    elig=docs["research_price_eligibility_report.json"]
    adj=docs["research_adjusted_close_report.json"]
    corp=docs["corporate_action_source_status.json"]
    if gate.get("promoted_count")!=0 or gate.get("qualifies_for_v4a") is not False:
        errors.append("unsafe promotion gate")
    if elig.get("v4a_eligible_count")!=0 or elig.get("promoted_count")!=0:
        errors.append("unexpected V4A approvals")
    if adj.get("production_modified") is not False or adj.get("v4a_eligible") is not False:
        errors.append("research adjustment permission error")
    if corp.get("usable") is not True or corp.get("events",0)<1:
        errors.append("corporate action source unavailable")
    counts=elig.get("counts",{})
    total=sum(counts.values())
    with (p/"research_price_eligibility.csv").open(newline="",encoding="utf-8") as f:
        r=csv.DictReader(f);count=0
        for item in r:
            count+=1
            if item["v4a_eligible"].lower()!="false":
                errors.append("row illegally marked V4A eligible");break
    if count!=total:errors.append(f"eligibility report/CSV mismatch {count}!={total}")
    if count==0:errors.append("no price rows")
    result={"ok":not errors,"errors":errors,"rows_checked":count,
            "source_main_commit":elig.get("source_commit"),"production_modified":False}
    (p/"warehouse_integrity.json").write_text(json.dumps(result,indent=2)+"\n")
    return result
if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--output",required=True);args=parser.parse_args()
    x=verify(args.output);print(json.dumps(x));sys.exit(0 if x["ok"] else 1)
