#!/usr/bin/env python3
"""Research-only adjustment *proposals* for corporate actions, never rewrite raw bars."""
import argparse,csv,collections,datetime,json,math,sqlite3
from pathlib import Path

def proposals(dbfile,actionsfile,outdir):
    out=Path(outdir);out.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(dbfile)
    # Prefer current main bar, fallback to latest historical branch only for inspection.
    q="""SELECT symbol,session,branch,close FROM remote_price_candidates
         WHERE close>0 ORDER BY symbol,session,CASE WHEN branch='main' THEN 0 ELSE 1 END,branch"""
    # SQLite does not accept CASE after ORDER BY shorthand in all builds? expression supported.
    bars=collections.defaultdict(dict)
    for sym,day,branch,close in con.execute(q):
        bars[sym].setdefault(day,float(close))
    con.close()
    source=list(csv.DictReader(Path(actionsfile).open(encoding="utf-8-sig",newline="")))
    unique={}
    for r in source:
        key=(r["symbol"].strip().upper(),r["ex_date"].strip(),r["action_type"].strip().lower(),r["action_value"].strip())
        unique[key]=r
    counters=collections.Counter()
    with (out/"corporate_action_adjustment_proposals.csv").open("w",encoding="utf-8",newline="") as f:
        w=csv.writer(f)
        w.writerow(["symbol","ex_date","type","value","previous_close","previous_session","gap_calendar_days","hypothetical_factor","status"])
        for sym,day,kind,value in sorted(unique):
            seq=bars.get(sym,{})
            prev_dates=[d for d in seq if d<day]
            prev_day=max(prev_dates) if prev_dates else None
            prev=seq[prev_day] if prev_day else None
            gap=(datetime.date.fromisoformat(day)-datetime.date.fromisoformat(prev_day)).days if prev_day else None
            factor=None
            status="NOT_COMPUTABLE"
            try:
                if prev is None: status="MISSING_PRE_EX_DATE_CLOSE"
                elif gap>7: status="STALE_PRE_EVENT_CLOSE"
                elif kind=="dividend":
                    amount=float(value)
                    if not (math.isfinite(amount) and 0<=amount<prev): status="INVALID_DIVIDEND_TO_PRE_CLOSE"
                    else:factor=(prev-amount)/prev;status="HYPOTHETICAL_NOT_VERIFIED"
                elif kind=="split":
                    a,b=value.split(":")
                    ratio=float(a)/float(b)
                    if not math.isfinite(ratio) or ratio<=0:status="INVALID_SPLIT_RATIO"
                    else: factor=1/ratio;status="HYPOTHETICAL_NOT_VERIFIED"
                else:status="UNSUPPORTED_EVENT"
            except (ValueError,ZeroDivisionError):status="INVALID_EVENT_VALUE"
            counters[status]+=1
            w.writerow([sym,day,kind,value,prev if prev is not None else "",prev_day or "",gap if gap is not None else "",round(factor,12) if factor is not None else "",status])
    report={"schema":"egx-corporate-action-proposal-1","unique_actions":len(unique),"statuses":dict(counters),
      "adjustments_applied":0,"canonical_prices_changed":False,
      "maximum_pre_event_gap_days":7,"policy":"Factors are indicative; ex-date, split ratio, pre-event close and source adjustment history require independent verification"}
    (out/"corporate_action_adjustment_report.json").write_text(json.dumps(report,indent=2)+"\n")
    return report

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--actions",required=True);p.add_argument("--output",required=True);a=p.parse_args()
    print(json.dumps(proposals(a.db,a.actions,a.output)))
