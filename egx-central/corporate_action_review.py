#!/usr/bin/env python3
"""Explain source splices by nearby corporate action metadata; never certify prices."""
import argparse,csv,datetime,json,sqlite3,collections
from pathlib import Path
def read_actions(source):
    if not source:return []
    p=Path(source)
    if not p.exists():return []
    if p.suffix.lower() in (".sqlite",".db"):
        con=sqlite3.connect(p)
        try: rows=con.execute("SELECT symbol,ex_date,action_type,action_value FROM corporate_actions").fetchall()
        finally:con.close()
        return [dict(symbol=s,ex_date=d,action_type=t,action_value=v) for s,d,t,v in rows]
    with p.open(encoding="utf-8-sig",newline="") as f:
        return [dict(symbol=r.get("symbol") or r.get("ticker"),ex_date=r.get("ex_date") or r.get("date"),
                     action_type=r.get("action_type") or r.get("type"),action_value=r.get("action_value") or r.get("value")) for r in csv.DictReader(f)]
def reconcile(quality_path,output,action_source=None):
    out=Path(output);out.mkdir(parents=True,exist_ok=True)
    report=json.loads(Path(quality_path).read_text(encoding="utf-8"))
    events=read_actions(action_source)
    by_symbol=collections.defaultdict(list)
    for event in events:
        try:
            date=datetime.date.fromisoformat(str(event["ex_date"])[:10])
            by_symbol[str(event["symbol"]).upper()].append((date,event))
        except (ValueError,TypeError):continue
    cases=report.get("splice_examples",[])
    counts=collections.Counter()
    with (out/"source_splice_corporate_action_review.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.writer(f);w.writerow(["symbol","session","jump_percent","event_date","event_type","event_value","decision"])
        for row in cases:
            day=datetime.date.fromisoformat(row["session"])
            possible=[(abs((day-d).days),e) for d,e in by_symbol.get(str(row["symbol"]).upper(),[]) if abs((day-d).days)<=5]
            nearest=min(possible,key=lambda x:x[0])[1] if possible else None
            decision="POTENTIAL_ACTION_MATCH_NOT_VERIFIED" if nearest else "UNEXPLAINED_OR_NO_ACTION_SOURCE"
            counts[decision]+=1
            w.writerow([row["symbol"],row["session"],row["jump_percent"],nearest["ex_date"] if nearest else "",nearest["action_type"] if nearest else "",nearest["action_value"] if nearest else "",decision])
    result={"source":"main_source_quality.json","action_source":str(action_source) if action_source else None,
      "action_events_loaded":len(events),"splices_in_supplied_report":len(cases),
      "reported_splice_total":report.get("counts",{}).get("source_splice_over_3pct",0),
      "review_counts":dict(counts),"certified_count":0,"automatic_promotion_allowed":False,
      "warning":"Nearby corporate actions do not demonstrate that reported OHLCV was correctly adjusted. Splice examples may be truncated."}
    (out/"corporate_action_review.json").write_text(json.dumps(result,indent=2)+"\n")
    return result
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--quality",required=True);p.add_argument("--output",required=True);p.add_argument("--actions");a=p.parse_args()
    print(json.dumps(reconcile(a.quality,a.output,a.actions)))
