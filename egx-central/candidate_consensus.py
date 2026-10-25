#!/usr/bin/env python3
"""Research-only canonical candidate export; never turns quarantine into approved prices."""
import argparse,csv,json,sqlite3,collections,datetime,math
from pathlib import Path
def build(db_path,outdir):
    out=Path(outdir);out.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(db_path)
    rows=con.execute("""SELECT symbol,session,branch,close,high,low,volume FROM remote_price_candidates
                         ORDER BY symbol,session,branch""").fetchall()
    groups=collections.defaultdict(list)
    for sym,day,branch,close,high,low,vol in rows:
        groups[(sym,day)].append((branch,close,high,low,vol))
    summary=collections.Counter()
    with (out/"candidate_consensus.csv").open("w",newline="",encoding="utf8") as f:
        writer=csv.writer(f)
        writer.writerow(("symbol","session","copies","branches","close_span_percent","status"))
        for (sym,day),vals in sorted(groups.items()):
            closes=[v[1] for v in vals]
            span=100*(max(closes)/min(closes)-1) if min(closes)>0 else float("inf")
            # Branch copies are not independent sources: agreement cannot validate OHLCV.
            status="CROSS_BRANCH_CONFLICT" if span>3 else "UNVERIFIED_BRANCH_AGREEMENT"
            summary[status]+=1
            writer.writerow((sym,day,len(vals),len({v[0] for v in vals}),round(span,5),status))
    latest=max((day for (_,day) in groups),default=None)
    earliest=min((day for (_,day) in groups),default=None)
    latest_symbols=len({sym for (sym,day) in groups if day==latest})
    con.close()
    report={"schema":"egx-research-candidate-consensus-1","generated_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
      "unique_symbol_sessions":len(groups),"earliest_session":earliest,"latest_observed_session":latest,"symbols_on_latest_session":latest_symbols,"status_counts":dict(summary),
      "certified_ohlcv_count":0,"production_ready":False,
      "warning":"Historical branch overlap is NOT independent source confirmation. No paper or live strategy may consume this export as canonical prices."}
    (out/"consensus_report.json").write_text(json.dumps(report,indent=2)+"\n")
    return report
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--output",required=True);a=p.parse_args()
    print(json.dumps(build(a.db,a.output)))
