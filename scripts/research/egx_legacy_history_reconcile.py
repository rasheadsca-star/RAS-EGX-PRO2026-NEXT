#!/usr/bin/env python3
"""Fail-closed inventory and reconciliation of historical EGX JSON OHLCV stores.

No automatic promotion to production. Preserve conflicts for manual source review.
"""
import argparse
import csv
import hashlib
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

def collect(paths):
    rows = defaultdict(list)
    issues = []
    sources = []
    for folder in paths:
        folder = Path(folder)
        if not folder.is_dir():
            sources.append({"path": str(folder), "available": False})
            continue
        docs = list(folder.glob("*.json"))
        sources.append({"path": str(folder), "available": True, "documents": len(docs)})
        for p in docs:
            try:
                obj = json.loads(p.read_text(encoding="utf-8"))
                sessions = obj.get("sessions")
                if not isinstance(sessions, list):
                    continue
                ticker = str(obj.get("ticker", p.stem)).strip().upper()
                if ticker != p.stem.upper():
                    issues.append({"ticker": ticker, "date": "", "reason": "FILENAME_TICKER_MISMATCH", "source": str(p)})
                    continue
                for s in sessions:
                    day = str(s.get("date", ""))
                    try:
                        date.fromisoformat(day)
                        o,h,l,c,v = (float(s[k]) for k in ("open","high","low","close","volume"))
                        if not (l > 0 and v >= 0 and l <= min(o,c) and h >= max(o,c)):
                            raise ValueError("OHLCV bounds")
                    except (KeyError, TypeError, ValueError, OverflowError):
                        issues.append({"ticker": ticker, "date": day, "reason": "INVALID_CANDLE", "source": str(p)})
                        continue
                    item = {"ticker": ticker, "date": day, "open": o, "high": h, "low": l, "close": c, "volume": v,
                            "source": str(p), "source_type": s.get("primarySource",obj.get("primarySource","unknown")),
                            "official_verified": s.get("officialVerified") is True}
                    rows[ticker,day].append(item)
            except (OSError, json.JSONDecodeError) as exc:
                issues.append({"ticker":p.stem, "date":"", "reason":"UNREADABLE_JSON", "source":str(p), "detail":str(exc)})
    canonical = []
    for (ticker, day), candidates in sorted(rows.items()):
        variants = {tuple(row[k] for k in ("open","high","low","close","volume")) for row in candidates}
        if len(variants) > 1:
            issues.append({"ticker":ticker, "date":day, "reason":"CONFLICTING_SOURCES", "source":";".join(c["source"] for c in candidates)})
            continue
        chosen = candidates[0].copy()
        chosen["supporting_sources"] = len(candidates)
        chosen["eligible_for_recommendations"] = False
        canonical.append(chosen)
    by_ticker = defaultdict(list)
    for r in canonical:
        by_ticker[r["ticker"]].append(r["date"])
    coverage = [{"ticker":t, "sessions":len(v), "first":min(v), "last":max(v),
                 "20":len(v)>=20, "50":len(v)>=50, "100":len(v)>=100, "200":len(v)>=200}
                for t,v in sorted(by_ticker.items())]
    return {"sources":sources, "rows":canonical, "coverage":coverage, "issues":issues,
            "summary":{"distinct_symbol_sessions":len(canonical),"symbols":len(coverage),
                       "conflicts":sum(x["reason"]=="CONFLICTING_SOURCES" for x in issues),
                       "invalid_or_unreadable":sum(x["reason"]!="CONFLICTING_SOURCES" for x in issues),
                       "coverage_200":sum(x["200"] for x in coverage),
                       "recommendations_enabled":False}}

def write_csv(path, rows, columns):
    with Path(path).open("w",newline="",encoding="utf-8-sig") as f:
        w=csv.DictWriter(f,fieldnames=columns,extrasaction="ignore")
        w.writeheader();w.writerows(rows)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--history",action="append",required=True,help="Repeat for each legacy history directory")
    p.add_argument("--output",required=True)
    args=p.parse_args()
    result=collect(args.history)
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    (out/"summary.json").write_text(json.dumps({"summary":result["summary"],"sources":result["sources"]},indent=2),encoding="utf-8")
    write_csv(out/"coverage.csv",result["coverage"],["ticker","sessions","first","last","20","50","100","200"])
    write_csv(out/"issues.csv",result["issues"],["ticker","date","reason","source","detail"])
    write_csv(out/"canonical_research_only.csv",result["rows"],["ticker","date","open","high","low","close","volume","source","source_type","official_verified","supporting_sources","eligible_for_recommendations"])
    print(json.dumps(result["summary"],indent=2))
if __name__=="__main__":
    main()
