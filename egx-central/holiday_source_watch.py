#!/usr/bin/env python3
"""Fetch cited public holiday notices for freshness review, never silently certify a holiday."""
import argparse,datetime,hashlib,json,urllib.request
from pathlib import Path
SOURCES={
 "egypt_presidency_holidays_2026":"https://www.presidency.eg/EN/%D9%85%D8%B5%D8%B1/%D8%A7%D9%84%D8%B9%D8%B7%D9%84%D8%A7%D8%AA-%D8%A7%D9%84%D8%B1%D8%B3%D9%85%D9%8A%D8%A9/",
 "reported_egx_october_8_2026":"https://react.arabfinance.com/en/news/newdetails/egx-halts-trading-on-october-8-for-armed-forces-day"
}
def check(output):
 rows={}
 for name,url in SOURCES.items():
  result={"url":url,"retrieved":False,"status":"UNVERIFIED","sha256":None}
  try:
   req=urllib.request.Request(url,headers={"User-Agent":"EGX-Research-Holiday-Audit/1.0"})
   with urllib.request.urlopen(req,timeout=12) as response:
    data=response.read(1_000_000)
    result.update({"retrieved":True,"status":"SOURCE_RETRIEVED_REQUIRES_REVIEW",
                   "sha256":hashlib.sha256(data).hexdigest(),"http_status":response.status})
  except Exception as e:result["error_type"]=type(e).__name__
  rows[name]=result
 output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
 record={"schema":"egx-holiday-source-watch-1",
   "checked_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
   "sources":rows,"exchange_schedule_certified":False,"trading_eligible":False,
   "warning":"Fetched public pages are evidence of reachability only, NOT confirmation of exchange closure details."}
 output.write_text(json.dumps(record,indent=2)+"\n",encoding="utf-8")
 print(json.dumps({"retrieved":sum(x["retrieved"] for x in rows.values()),"total":len(rows),"trading_eligible":False}))
 return record
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--output",required=True)
 a=p.parse_args();check(a.output)
