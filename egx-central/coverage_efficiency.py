#!/usr/bin/env python3
"""Measure actual historical coverage, repeated snapshots and changed prices in research ledger."""
import argparse,collections,json,sqlite3
from pathlib import Path

def report(db,output):
    con=sqlite3.connect(f"file:{Path(db).resolve()}?mode=ro",uri=True)
    grouped=collections.defaultdict(list);symbols=set();sources=set();n=0
    try:
        for sym,day,source,o,h,l,c,v,status in con.execute(
            "SELECT symbol,session,provider,open,high,low,close,volume,status FROM observations"):
            if status!="QUARANTINED":raise ValueError("Non-research observation detected")
            n+=1;symbols.add(sym);sources.add(source)
            grouped[(sym,day,source)].append((o,h,l,c,v))
    finally:con.close()
    sessions={(sym,day) for sym,day,source in grouped}
    exact_repeat=0;revisions=0;multi={}
    for (sym,day,source),values in grouped.items():
        exact_repeat+=len(values)-len(set(values))
        if len(set(values))>1:revisions+=1
        multi.setdefault((sym,day),set()).add(source)
    joint=sum(len(providers)>1 for providers in multi.values())
    out={"schema":"egx-coverage-efficiency-1","evidence_rows":n,
         "distinct_symbols":len(symbols),"distinct_symbol_sessions":len(sessions),
         "distinct_symbol_session_providers":len(grouped),
         "exact_ohlcv_repeats":exact_repeat,"revised_provider_sessions":revisions,
         "multiple_provider_sessions":joint,"evidence_per_distinct_session":round(n/len(sessions),2) if sessions else 0,
         "unique_providers":sorted(str(s) for s in sources),
         "v4a_eligible_count":0,"production_modified":False,
         "warning":"Observation volume is not new session coverage; provider labels do not establish independent originating data."}
    Path(output).write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps(out));return out
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--report",required=True)
    a=p.parse_args();report(a.db,a.report)
