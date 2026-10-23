#!/usr/bin/env python3
"""Paper-only next-open breakout simulation. Assumptions are hypotheses, not fills."""
import argparse,collections,json,sqlite3,statistics
from pathlib import Path
FEE_BPS=20
HOLD=5
STOP_PCT=.05
def run(db,out):
 con=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
 bars=collections.defaultdict(lambda:collections.defaultdict(set))
 try:
  for sym,day,o,h,l,c,v,status in con.execute("SELECT symbol,session,open,high,low,close,volume,status FROM observations"):
   if status!="QUARANTINED":raise ValueError("Non-research row")
   if all(isinstance(x,(int,float)) and x>0 for x in (o,h,l,c,v)) and l<=min(o,c)<=max(o,c)<=h:
    bars[sym][day].add((o,h,l,c,v))
 finally:con.close()
 groups=collections.defaultdict(list);rejects=collections.Counter()
 for sym,days in sorted(bars.items()):
  series=[(day,*next(iter(values))) for day,values in sorted(days.items()) if len(values)==1]
  i=20
  while i+HOLD<len(series):
   hist=series[i-20:i];signal=series[i]
   if signal[4]<=max(b[2] for b in hist):
    i+=1;continue
   bucket="HIGH_VOLUME" if signal[5]>1.5*statistics.median(b[5] for b in hist) else "OTHER_VOLUME"
   entry=series[i+1][1];stop=entry*(1-STOP_PCT)
   exit_price=series[i+HOLD][4];reason="TIME"
   # Conservative if session opens below stop; intraday stop assumes execution at stop.
   for k in range(i+1,i+HOLD+1):
    bar=series[k]
    if bar[1]<=stop:
     exit_price=bar[1];reason="GAP_STOP";break
    if bar[3]<=stop:
     exit_price=stop;reason="STOP";break
   gross=(exit_price/entry-1)
   net=gross-2*FEE_BPS/10000
   groups[bucket].append({"symbol":sym,"session":signal[0],"net_return":net,"exit_reason":reason})
   i+=HOLD+1
 result={}
 for bucket in ("HIGH_VOLUME","OTHER_VOLUME"):
  rows=groups[bucket];n=len(rows);w=sum(r["net_return"]>0 for r in rows)
  result[bucket]={"trades":n,"net_winners":w,"win_rate":round(w/n,4) if n else None,
   "mean_net_return":round(statistics.mean(x["net_return"] for x in rows),5) if n else None,
   "stops":sum(x["exit_reason"]!="TIME" for x in rows)}
 payload={"schema":"egx-next-open-paper-exploration-1","parameters":{"round_trip_bps":2*FEE_BPS,
  "hold_sessions_after_signal":HOLD,"stop_loss_pct":STOP_PCT,"entry":"NEXT_SESSION_OPEN",
  "stop":"gap-at-open else assumed stop fill","exit":"fifth session close"},
  "groups":result,"independent_oos":False,"source_verified":False,"realistic_liquidity_verified":False,
  "trading_eligible":False,"production_modified":False,
  "warning":"This is an exploratory fixed assumption test using unverified raw prices. No actual execution, exchange holidays or corporate action corrections."}
 Path(out).write_text(json.dumps(payload,indent=2)+"\n");print(json.dumps(payload));return payload
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();run(a.db,a.output)
