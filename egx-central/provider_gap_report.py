#!/usr/bin/env python3
"""Identify research symbols lacking multi-provider candle evidence."""
import argparse,collections,json,sqlite3
from pathlib import Path
def inspect(db,output):
 con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
 pairs=collections.defaultdict(set);by_symbol=collections.defaultdict(set)
 try:
  for sym,day,provider,status in con.execute("SELECT symbol,session,provider,status FROM observations"):
   if status!="QUARANTINED":raise ValueError("Unsafe evidence")
   pairs[(sym,day)].add(provider)
   by_symbol[sym].add((day,provider))
 finally:con.close()
 confirmed=sum(len(providers)>1 for providers in pairs.values())
 report={"schema":"egx-provider-gap-1","total_symbol_sessions":len(pairs),
   "multiple_labeled_provider_sessions":confirmed,
   "symbols":[{"symbol":sym,"distinct_sessions":len({day for day,p in rows}),
     "provider_labels":sorted({p for day,p in rows}),
     "sessions_needing_independent_verification":sum(len(pairs[(sym,day)])==1 for day,p in rows)}
    for sym,rows in sorted(by_symbol.items())],
   "independence_proven":False,"eligible_for_trading":False,"production_modified":False}
 Path(output).write_text(json.dumps(report,indent=2)+"\n")
 print(json.dumps({"sessions":len(pairs),"multi_provider":confirmed,"symbols":len(by_symbol)}))
 return report
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();inspect(a.db,a.output)
