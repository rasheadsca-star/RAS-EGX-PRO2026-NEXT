#!/usr/bin/env python3
import argparse,collections,json
from pathlib import Path
def analyze(source,output):
 data=json.loads(Path(source).read_text())
 counts=collections.Counter()
 for row in data.get("rows",[]):
  for attempt in row.get("attempts",[]):
   if attempt.get("source")!="yahoo_chart":continue
   for item in attempt.get("candidate",[]):
    day=item.get("session","")
    counts[day]+=1
 result={"schema":"egx-date-concentration-1","date_counts":dict(sorted(counts.items())),"approved":0}
 Path(output).write_text(json.dumps(result,indent=2)+"\n")
 return result
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--source",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();print(json.dumps(analyze(a.source,a.output)))
