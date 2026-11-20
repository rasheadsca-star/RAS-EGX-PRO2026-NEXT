#!/usr/bin/env python3
"""Generate indicative backwards-adjusted close series; research only, never execution."""
import argparse,csv,json,math,sqlite3,collections,datetime
from pathlib import Path

def generate(db_path,proposals_path,out_dir):
    out=Path(out_dir);out.mkdir(parents=True,exist_ok=True)
    events=collections.defaultdict(list)
    with Path(proposals_path).open(newline="",encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["status"]!="HYPOTHETICAL_NOT_VERIFIED":continue
            try:
                fac=float(r["hypothetical_factor"])
                if not math.isfinite(fac) or fac<=0 or fac>1:continue
                events[r["symbol"]].append((r["ex_date"],fac,r["type"]))
            except ValueError:continue
    db=sqlite3.connect(db_path)
    rows=db.execute("""SELECT symbol,session,branch,close FROM remote_price_candidates
       WHERE close>0 ORDER BY symbol,session,CASE WHEN branch='main' THEN 0 ELSE 1 END,branch""").fetchall()
    db.close()
    chosen={}
    for sym,day,branch,close in rows:
        chosen.setdefault((sym,day),(branch,float(close)))
    statuses=collections.Counter()
    with (out/"research_adjusted_close.csv").open("w",newline="",encoding="utf-8") as f:
        writer=csv.writer(f)
        writer.writerow(("symbol","session","source_branch","raw_close","indicative_adjusted_close","factor","status"))
        for (sym,day),(branch,close) in sorted(chosen.items()):
            factor=1.0
            for event_day,ratio,kind in events.get(sym,[]):
                # Do not adjust an event-day close or future bars.
                if day<event_day:factor*=ratio
            adj=close*factor
            if not math.isfinite(adj) or adj<=0:raise ValueError("invalid adjusted close")
            status="RESEARCH_HYPOTHETICAL_NOT_FOR_V4A" if factor!=1 else "RAW_UNCHANGED"
            statuses[status]+=1
            writer.writerow((sym,day,branch,close,round(adj,8),round(factor,12),status))
    report={"schema":"egx-research-adjusted-close-1","stock_days":len(chosen),
        "events_with_hypothetical_factor":sum(map(len,events.values())),"statuses":dict(statuses),
        "production_modified":False,"v4a_eligible":False,
        "warning":"Not source-certified. Possible provider-adjusted baseline and action chronology can lead to double adjustment. Not usable for live or paper V4A signals."}
    (out/"research_adjusted_close_report.json").write_text(json.dumps(report,indent=2)+"\n")
    return report
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--proposals",required=True);p.add_argument("--output",required=True);a=p.parse_args()
    print(json.dumps(generate(a.db,a.proposals,a.output)))
