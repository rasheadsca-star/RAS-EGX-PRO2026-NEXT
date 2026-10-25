#!/usr/bin/env python3
"""Conservative, research-only OHLCV promotion gate. No production mutations."""
import argparse,collections,csv,datetime,json,math,sqlite3
from pathlib import Path

def assess(db_path,out_dir):
    out=Path(out_dir);out.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(db_path)
    rows=con.execute("SELECT symbol,session,branch,high,low,close,volume FROM remote_price_candidates ORDER BY symbol,session,branch").fetchall()
    grouped=collections.defaultdict(list)
    for sym,day,branch,h,l,c,v in rows:
        grouped[(sym,day)].append((branch,h,l,c,v))
    counts=collections.Counter()
    with (out/"promotion_gate.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.writer(f)
        w.writerow(("symbol","session","copies","status","reason"))
        for (sym,day),bars in sorted(grouped.items()):
            numbers=[n for _,h,l,c,v in bars for n in (h,l,c,v)]
            if any(not math.isfinite(n) or n<=0 for n in numbers):
                status,reason="REJECTED","INVALID_OR_NONFINITE_PRICE_VOLUME"
            elif any(h<max(l,c) or l>c for _,h,l,c,v in bars):
                status,reason="REJECTED","IMPOSSIBLE_OHLC"
            elif max(c for _,_,_,c,_ in bars)>min(c for _,_,_,c,_ in bars)*1.03:
                status,reason="REJECTED","CROSS_BRANCH_PRICE_CONFLICT"
            else:
                # Agreement between copies of one original feed is never independent source proof.
                status,reason="QUARANTINED","INDEPENDENT_SOURCE_AND_CORPORATE_ACTION_PROOF_REQUIRED"
            counts[status]+=1
            w.writerow((sym,day,len(bars),status,reason))
    report={"schema":"egx-promotion-gate-1","generated_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
       "reviewed_stock_sessions":len(grouped),"statuses":dict(counts),
       "promoted_count":0,"production_data_modified":False,
       "qualifies_for_v4a":False,"reason":"No independent session-level market-source and corporate-action validation available in this archive-only pipeline"}
    (out/"promotion_gate_report.json").write_text(json.dumps(report,indent=2)+"\n")
    con.close()
    return report

if __name__=="__main__":
    a=argparse.ArgumentParser();a.add_argument("--db",required=True);a.add_argument("--output",required=True);v=a.parse_args()
    print(json.dumps(assess(v.db,v.output)))
