#!/usr/bin/env python3
import argparse,collections,datetime,json
from pathlib import Path
def analyze(source,output):
 data=json.loads(Path(source).read_text())
 counts=collections.Counter();weekday=collections.Counter();weekend_symbols=collections.Counter()
 for row in data.get("rows",[]):
  for attempt in row.get("attempts",[]):
   if attempt.get("source")!="yahoo_chart":continue
   for item in attempt.get("candidate",[]):
    day=item.get("session","")
    counts[day]+=1
    try:dt=datetime.date.fromisoformat(day)
    except (TypeError,ValueError):continue
    weekday[dt.strftime('%A')]+=1
    if dt.weekday()>=4:weekend_symbols[row.get('symbol','UNKNOWN')]+=1
 result={"schema":"egx-date-concentration-1","date_counts":dict(sorted(counts.items())),"weekday_counts":dict(weekday),"weekend_by_symbol":dict(weekend_symbols),"approved":0}
 Path(output).write_text(json.dumps(result,indent=2)+"\n")
 return result
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--source",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();print(json.dumps(analyze(a.source,a.output)))
