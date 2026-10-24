#!/usr/bin/env python3
"""Fixed exploratory breakout rule; non-overlapping events and Wilson uncertainty."""
import argparse,collections,json,math,sqlite3,statistics
from pathlib import Path
def bounds(w,n):
 if not n:return [None,None]
 z=1.96;p=w/n;d=1+z*z/n
 center=(p+z*z/(2*n))/d
 radius=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
 return [round(center-radius,4),round(center+radius,4)]
def analyze(db,out):
 con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
 raw=collections.defaultdict(lambda:collections.defaultdict(set))
 try:
  for sym,day,o,h,l,c,v,status in con.execute("SELECT symbol,session,open,high,low,close,volume,status FROM observations"):
   if status!="QUARANTINED":raise ValueError("Unsafe evidence")
   if all(isinstance(x,(int,float)) and x>0 for x in (o,h,l,c,v)) and h>=max(o,c,l) and l<=min(o,c,h):
    raw[sym][day].add((o,h,l,c,v))
 finally:con.close()
 score=collections.Counter();symbols=collections.Counter()
 for sym,days in sorted(raw.items()):
  bars=[(day,*next(iter(rows))) for day,rows in sorted(days.items()) if len(rows)==1]
  last_exit=-1
  for i in range(20,len(bars)-5):
   if i<=last_exit:continue
   history=bars[i-20:i];bar=bars[i]
   if bar[4]<=max(x[2] for x in history):continue
   key="HIGH_VOLUME" if bar[5]>1.5*statistics.median(x[5] for x in history) else "OTHER_VOLUME"
   score[key+"_total"]+=1
   score[key+"_positive"]+=int(bars[i+5][4]>bar[4])
   symbols[sym]+=1
   last_exit=i+5
 results={}
 for key in ("HIGH_VOLUME","OTHER_VOLUME"):
  n=score[key+"_total"];w=score[key+"_positive"]
  results[key]={"nonoverlap_events":n,"positive_5bars":w,
   "rate":round(w/n,4) if n else None,"wilson95":bounds(w,n)}
 obj={"schema":"egx-fixed-nonoverlap-exploration-1","rule":"prior20 close breakout; volume > 1.5x prior20 median; five bars; no overlapping within ticker",
 "groups":results,"symbols_with_events":len(symbols),"certified_edge":False,
 "out_of_sample":False,"trading_eligible":False,"production_modified":False,
 "warning":"Fixed exploratory rule assessed on previously reviewed research history; neither independent OOS nor executable returns."}
 Path(out).write_text(json.dumps(obj,indent=2)+"\n");print(json.dumps(obj));return obj
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();analyze(a.db,a.output)
