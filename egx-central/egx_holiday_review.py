#!/usr/bin/env python3
"""Conservative EGX closure review: official exchange announcements override public-holiday candidates."""
import argparse,datetime,json
from pathlib import Path

# Sources are explicitly attributable. Government holiday dates are not automatically EGX closures.
GOV="https://www.presidency.eg/EN/%D9%85%D8%B5%D8%B1/%D8%A7%D9%84%D8%B9%D8%B7%D9%84%D8%A7%D8%AA-%D8%A7%D9%84%D8%B1%D8%B3%D9%85%D9%8A%D8%A9/"
EGX_OCT="https://react.arabfinance.com/en/news/newdetails/egx-halts-trading-on-october-8-for-armed-forces-day"
# Government candidates for 2026. Do not certify these as EGX holidays without venue-specific announcement.
GOV_DATES={
 "2026-01-07":"Coptic Christmas","2026-01-29":"Police Day",
 **{f"2026-03-{d:02d}":"Eid al-Fitr" for d in range(19,24)},
 "2026-04-13":"Sham El-Nessim","2026-04-25":"Sinai Liberation Day",
 "2026-05-07":"Labour Day",
 **{f"2026-05-{d:02d}":"Eid al-Adha period" for d in range(26,32)},
 "2026-06-18":"Hijri New Year","2026-07-02":"June 30 celebration",
 "2026-07-23":"July 23 Revolution","2026-08-27":"Prophet Birthday",
 "2026-10-06":"Armed Forces Day original date"}
VENUE_CLOSURES={"2026-10-08":{"reason":"Armed Forces Day observed","source":EGX_OCT,"evidence":"Exchange closure announcement reported 2026-10-05"}}
def classify(day):
 d=datetime.date.fromisoformat(day)
 if d.weekday() in (4,5):return {"status":"WEEKEND","source":"Egyptian Exchange Sun-Thu weekly schedule"}
 if day in VENUE_CLOSURES:return {"status":"EXCHANGE_CLOSED_CONFIRMED",**VENUE_CLOSURES[day]}
 if day in GOV_DATES:return {"status":"POSSIBLE_HOLIDAY_REVIEW","reason":GOV_DATES[day],"source":GOV}
 return {"status":"UNVERIFIED_POTENTIAL_SESSION","source":None}
def report(start,end,output):
 lo=datetime.date.fromisoformat(start);hi=datetime.date.fromisoformat(end)
 if hi<lo or (hi-lo).days>370:raise ValueError("Invalid review range")
 rows=[]
 for i in range((hi-lo).days+1):
  day=(lo+datetime.timedelta(days=i)).isoformat()
  rows.append({"date":day,**classify(day)})
 out={"schema":"egx-calendar-review-1","checked_at":"STATIC_SNAPSHOT_REQUIRES_FRESH_SOURCE_CHECK",
 "rows":rows,"official_exchange_calendar_complete":False,"trading_eligible":False,
 "warning":"Only explicitly confirmed venue closures may be treated as exchange holidays; candidates need fresh official confirmation."}
 Path(output).parent.mkdir(parents=True,exist_ok=True)
 Path(output).write_text(json.dumps(out,indent=2)+"\n",encoding="utf-8")
 print(json.dumps({"dates":len(rows),"confirmed_closures":sum(x["status"]=="EXCHANGE_CLOSED_CONFIRMED" for x in rows),
 "needs_review":sum(x["status"]=="POSSIBLE_HOLIDAY_REVIEW" for x in rows)}))
 return out
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--start",required=True);p.add_argument("--end",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();report(a.start,a.end,a.output)
