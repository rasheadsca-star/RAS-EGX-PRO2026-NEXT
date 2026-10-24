#!/usr/bin/env python3
"""Compare zero-cost external candidates to MAIN archive, never certify by agreement alone."""
import argparse,collections,csv,json,math,sqlite3
from pathlib import Path

def reconcile(db_path,fallback_file,outdir):
    out=Path(outdir);out.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(db_path)
    reference={}
    for sym,session,branch,high,low,close,volume in con.execute(
        "SELECT symbol,session,branch,high,low,close,volume FROM remote_price_candidates WHERE branch='main'"):
        reference[(str(sym).upper(),session)]=(high,low,close,volume)
    con.close()
    data=json.loads(Path(fallback_file).read_text())
    counts=collections.Counter()
    with (out/"free_source_reconciliation.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.writer(f)
        w.writerow(["symbol","session","provider","status","close_gap_percent","main_close","candidate_close","source_url"])
        for item in data.get("rows",[]):
            sym=str(item.get("symbol","")).upper()
            for attempt in item.get("attempts",[]):
                provider=attempt.get("source")
                for bar in attempt.get("candidate",[]):
                    session=bar.get("session")
                    if not session:continue
                    match=reference.get((sym,session))
                    close=bar.get("close")
                    if match is None:status="UNMATCHED_SESSION_QUARANTINE";gap=""
                    elif not isinstance(close,(int,float)) or not math.isfinite(close) or close<=0:
                        status="INVALID_CANDIDATE";gap=""
                    else:
                        gap=100*abs(close/match[2]-1)
                        status="MATCH_RESEARCH_ONLY" if gap<=1 else "CONFLICT_RESEARCH_ONLY"
                    counts[status]+=1
                    w.writerow([sym,session,provider,status,round(gap,5) if isinstance(gap,float) else "",match[2] if match else "",close,attempt.get("url")])
    result={"schema":"egx-free-feed-reconciliation-1","counts":dict(counts),
            "approved_rows":0,"production_written":False,"v4a_eligible":False,
            "warning":"Source overlap and numeric agreement do not establish independent EGX settlement or session-level proof."}
    (out/"free_source_reconciliation_report.json").write_text(json.dumps(result,indent=2)+"\n")
    return result
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--fallback",required=True);p.add_argument("--output",required=True);a=p.parse_args()
    print(json.dumps(reconcile(a.db,a.fallback,a.output)))
