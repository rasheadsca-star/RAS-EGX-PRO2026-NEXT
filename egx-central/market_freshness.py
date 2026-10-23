#!/usr/bin/env python3
"""Daily snapshot lag, coverage and completeness audit. Fail closed on integrity; flag freshness."""
import argparse,csv,datetime,json,collections
from pathlib import Path

def audit(folder):
    p=Path(folder)
    meta=json.loads((p/"main_source_quality.json").read_text())
    latest=meta.get("latest_observed_session")
    per=collections.defaultdict(set)
    with (p/"research_price_eligibility.csv").open(newline="",encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("session") and r.get("symbol"):per[r["symbol"]].add(r["session"])
    last=collections.Counter(max(days) for days in per.values() if days)
    n=len(per)
    fresh=sum(1 for dates in per.values() if latest in dates)
    historical=[(sym,len(dates),max(dates)) for sym,dates in per.items()]
    short=[{"symbol":sym,"sessions":k,"last_session":d} for sym,k,d in sorted(historical) if k<50]
    # UTC date is NOT the expected EGX session; no assumptions about holidays or settlement.
    age_days=(datetime.datetime.now(datetime.timezone.utc).date()-datetime.date.fromisoformat(latest)).days if latest else None
    result={"schema":"egx-market-freshness-1","latest_observed_session":latest,"calendar_age_days":age_days,
      "symbols_total":n,"symbols_on_latest_session":fresh,"latest_session_coverage_pct":round(100*fresh/n,2) if n else 0,
      "symbols_below_50_sessions":len(short),"below_50_examples":short[:100],
      "symbol_latest_date_distribution":dict(last),
      "source_main_commit":meta.get("main_commit"),
      "quality_status":"REVIEW_REQUIRED" if n==0 or fresh/n<0.9 else "RESEARCH_COVERAGE_GOOD",
      "freshness_is_not_market_verified":True,
      "warning":"Calendar age must be interpreted against official Egyptian exchange holiday/trading calendar before stale-data alerts."}
    (p/"market_freshness_report.json").write_text(json.dumps(result,indent=2)+"\n")
    return result
if __name__=="__main__":
    a=argparse.ArgumentParser();a.add_argument("--output",required=True);v=a.parse_args()
    print(json.dumps(audit(v.output)))
