#!/usr/bin/env python3
"""Triage unapproved external candles, with immutable evidence and no promotion."""
import argparse,collections,csv,datetime,json,math,sqlite3
from pathlib import Path

def triage(db, fallback, out):
    root=Path(out);root.mkdir(parents=True,exist_ok=True)
    conn=sqlite3.connect(f"file:{Path(db).resolve()}?mode=ro",uri=True)
    archive=collections.defaultdict(dict)
    for symbol,day,close in conn.execute("SELECT symbol,session,close FROM remote_price_candidates WHERE branch='main'"):
        if isinstance(close,(int,float)) and math.isfinite(close) and close>0:
            archive[str(symbol).upper()][str(day)]=close
    conn.close()
    feed=json.loads(Path(fallback).read_text(encoding="utf-8"))
    counts=collections.Counter();items=[]
    for stock in feed.get("rows",[]):
        symbol=str(stock.get("symbol","")).upper()
        for src in stock.get("attempts",[]):
            for bar in src.get("candidate",[]):
                day=str(bar.get("session",""));p=bar.get("close")
                try: date=datetime.date.fromisoformat(day)
                except ValueError:date=None
                if not date or date.weekday() in (4,5):
                    reason="INVALID_OR_WEEKEND_SESSION"
                elif date>datetime.datetime.now(datetime.timezone.utc).date():
                    reason="FUTURE_SESSION"
                elif not isinstance(p,(float,int)) or isinstance(p,bool) or not math.isfinite(p) or p<=0:
                    reason="INVALID_CLOSE"
                elif day not in archive[symbol]:
                    days=archive[symbol]
                    first=min(days) if days else None;last=max(days) if days else None
                    reason=("OUTSIDE_MAIN_HISTORY" if not days or day<first or day>last
                            else "INTERNAL_HISTORY_GAP")
                else:
                    previous=archive[symbol][day]
                    reason="CLOSE_CONFLICT_GT_1PCT" if abs(p/previous-1)>0.01 else "CLOSE_MATCH_UNVERIFIED"
                counts[reason]+=1
                items.append({"symbol":symbol,"session":day,"provider":src.get("source"),
                              "reason":reason,"source_url":src.get("url"),
                              "source_response_sha256":src.get("body_sha256"),
                              "candidate_close":p,"main_close":archive[symbol].get(day),
                              "production_eligible":False})
    payload={"schema":"egx-reconciliation-triage-1","counts":dict(counts),"rows":items,
             "promoted_count":0,"v4a_eligible_count":0,"production_modified":False,
             "warning":"Historical gaps and close equality are not proof of a trading session or an independent quote."}
    (root/"free_feed_triage.json").write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"counts":dict(counts),"total":len(items),"promoted_count":0}))
    return payload
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--fallback",required=True);p.add_argument("--output",required=True)
    a=p.parse_args();triage(a.db,a.fallback,a.output)
