#!/usr/bin/env python3
"""Exploratory chronological signal outcomes, not a trading backtest or validated edge."""
import argparse,collections,json,sqlite3,statistics
from pathlib import Path

def evaluate(db,out):
 con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
 by=collections.defaultdict(lambda:collections.defaultdict(set))
 try:
  for sym,day,o,h,l,c,v,status in con.execute("SELECT symbol,session,open,high,low,close,volume,status FROM observations"):
   if status!="QUARANTINED":raise ValueError("unsafe status")
   if all(isinstance(x,(float,int)) and x>0 for x in (o,h,l,c,v)) and h>=max(o,l,c) and l<=min(o,h,c):
    by[sym][day].add((o,h,l,c,v))
 finally:con.close()
 totals=collections.Counter();examples=[]
 for sym,sessions in sorted(by.items()):
  bars=[(d,*next(iter(values))) for d,values in sorted(sessions.items()) if len(values)==1]
  for i in range(20,len(bars)-5):
   history=bars[i-20:i];today=bars[i];future=bars[i+5]
   breakout=today[4]>max(x[2] for x in history)
   high_volume=today[5]>1.5*statistics.median(x[5] for x in history)
   if not breakout:continue
   signal="BREAKOUT_HIGH_VOLUME" if high_volume else "BREAKOUT_OTHER_VOLUME"
   totals[signal+"_signals"]+=1
   # Close-to-close five-session sign ignores costs and intraday execution.
   if future[4]>today[4]:totals[signal+"_positive_5bar"]+=1
   if len(examples)<12:examples.append({"symbol":sym,"session":today[0],"bucket":signal})
 result={"schema":"egx-exploratory-chronological-signals-1","counts":dict(totals),
  "examples":examples,"future_window_sessions":5,
  "historical_performance_verified":False,"out_of_sample_validated":False,
  "trade_recommendations":[],"v4a_eligible":False,"production_modified":False,
  "warning":"Research-only close-to-close directional comparison; no costs, corporate-action assurance or independent OOS evaluation."}
 Path(out).write_text(json.dumps(result,indent=2)+"\n")
 print(json.dumps(result));return result
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();evaluate(a.db,a.output)
