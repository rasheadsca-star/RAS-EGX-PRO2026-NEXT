#!/usr/bin/env python3
"""Locked chronological holdout diagnostic for paper breakout research; not independent OOS."""
import argparse,collections,json,sqlite3,statistics
from pathlib import Path
FEE=.004;HOLD=5;STOP=.05
def assess(db,out):
 con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
 by=collections.defaultdict(lambda:collections.defaultdict(set))
 try:
  for symbol,day,o,h,l,c,v,status in con.execute("SELECT symbol,session,open,high,low,close,volume,status FROM observations"):
   if status!="QUARANTINED":raise ValueError("unsafe observation")
   if all(isinstance(x,(int,float)) and x>0 for x in (o,h,l,c,v)) and l<=min(o,c)<=max(o,c)<=h:
    by[symbol][day].add((o,h,l,c,v))
 finally:con.close()
 all_dates=sorted({d for sessions in by.values() for d in sessions})
 cutoff=all_dates[(len(all_dates)*7)//10] if all_dates else None
 events=[]
 for sym,days in sorted(by.items()):
  rows=[(d,*next(iter(v))) for d,v in sorted(days.items()) if len(v)==1]
  i=20
  while i+HOLD<len(rows):
   bar=rows[i];prior=rows[i-20:i]
   if bar[4]<=max(x[2] for x in prior):
    i+=1;continue
   name="HIGH_VOLUME" if bar[5]>1.5*statistics.median(x[5] for x in prior) else "OTHER_VOLUME"
   entry=rows[i+1][1];stop=entry*(1-STOP);exit_price=rows[i+HOLD][4]
   for j in range(i+1,i+HOLD+1):
    if rows[j][1]<=stop:exit_price=rows[j][1];break
    if rows[j][3]<=stop:exit_price=stop;break
   net=exit_price/entry-1-FEE
   events.append((bar[0],sym,name,net,rows[i+HOLD][0]))
   i+=HOLD+1
 outgroups={}
 for period in ("EARLY_70_PCT","LATE_30_PCT"):
  for group in ("HIGH_VOLUME","OTHER_VOLUME"):
   sub=[x for x in events if x[2]==group and ((x[0]<cutoff and x[4]<cutoff) if period=="EARLY_70_PCT" else x[0]>=cutoff)]
   returns=[x[3] for x in sorted(sub)]
   n=len(returns);equity=1.0;peak=1.0;dd=0.0
   for v in returns:
    equity*=1+v;peak=max(peak,equity);dd=min(dd,equity/peak-1)
   outgroups[period+"_"+group]={"trades":n,"winners":sum(v>0 for v in returns),
    "win_rate":round(sum(v>0 for v in returns)/n,4) if n else None,
    "mean_net_return":round(statistics.mean(returns),5) if n else None,
    "sequential_compounded_return":round(equity-1,5) if n else None,
    "sequential_max_drawdown":round(dd,5) if n else None}
 obj={"schema":"egx-chronological-research-holdout-1","cutoff":cutoff,"groups":outgroups,
  "rules_frozen":True,"holdout_independent_of_prior_analysis":False,
  "portfolio_metrics_valid":False,"provider_independent":False,"trading_eligible":False,
  "production_modified":False,"warning":"Late period is diagnostic only: dataset and rules already reviewed. Sequential compounding assumes serial capital deployment, not a multi-symbol portfolio."}
 Path(out).write_text(json.dumps(obj,indent=2)+"\n")
 print(json.dumps(obj));return obj
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();assess(a.db,a.output)
