#!/usr/bin/env python3
"""Research-only volume, liquidity proxies, and price levels from unverified OHLCV."""
import argparse,collections,json,sqlite3,statistics
from pathlib import Path

def analyze(db,output):
 con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
 by=collections.defaultdict(lambda:collections.defaultdict(list))
 try:
  for sym,day,o,h,l,c,v,status in con.execute("SELECT symbol,session,open,high,low,close,volume,status FROM observations"):
   if status!="QUARANTINED":raise ValueError("Unsafe status")
   if all(isinstance(x,(int,float)) and x>0 for x in (o,h,l,c,v)) and h>=max(o,c,l) and l<=min(o,c,h):
    by[sym][day].append((o,h,l,c,v))
 finally:con.close()
 results=[]
 for sym,dates in sorted(by.items()):
  rows=[]
  for day,versions in sorted(dates.items()):
   if len(set(versions))!=1:continue
   rows.append((day,*versions[0]))
  if len(rows)<21:continue
  latest=rows[-1];prior=rows[-21:-1]
  median_volume=statistics.median(r[5] for r in prior)
  median_turnover=statistics.median(r[4]*r[5] for r in prior)
  high20=max(r[2] for r in prior);low20=min(r[3] for r in prior)
  volume_ratio=latest[5]/median_volume if median_volume else None
  turnover_ratio=(latest[4]*latest[5])/median_turnover if median_turnover else None
  results.append({"symbol":sym,"session":latest[0],"samples":len(rows),
   "latest_close":latest[4],"volume_vs_prior20_median":round(volume_ratio,3) if volume_ratio else None,
   "turnover_proxy_vs_prior20_median":round(turnover_ratio,3) if turnover_ratio else None,
   "prior20_high_resistance_proxy":high20,"prior20_low_support_proxy":low20,
   "breakout_above_prior20_high":latest[4]>high20,
   "note":"Turnover proxy is close times volume, not Mubasher traded value or order-flow direction."})
 report={"schema":"egx-research-mubasher-style-signals-1","rows":results,
  "instruments":len(results),"certified_signals":0,"trade_recommendations":[],
  "production_modified":False,"v4a_eligible":False,
  "warning":"Independent calculations only; NOT sourced from Mubasher tools, no directional liquidity inference."}
 Path(output).write_text(json.dumps(report,indent=2)+"\n")
 print(json.dumps({"instruments":len(results),"certified_signals":0}))
 return report
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();analyze(a.db,a.output)
