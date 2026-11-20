#!/usr/bin/env python3
"""Diagnose Yahoo candle timestamp alignment without certifying exchange sessions."""
import argparse,collections,datetime,json
from pathlib import Path
from zoneinfo import ZoneInfo

def diagnose(input_path, output_path):
    payload=json.loads(Path(input_path).read_text(encoding="utf-8"))
    classes=collections.Counter()
    per_symbol=collections.defaultdict(collections.Counter)
    examples=[]
    for stock in payload.get("rows",[]):
        symbol=str(stock.get("symbol",""))
        for source in stock.get("attempts",[]):
            if source.get("source")!="yahoo_chart":
                continue
            metadata=source.get("yahoo_meta") or {}
            for bar in source.get("candidate",[]):
                try:
                    timestamp=bar["raw_timestamp"]
                    if isinstance(timestamp,bool) or not isinstance(timestamp,(int,float)):
                        raise ValueError("timestamp type")
                    utc=datetime.datetime.fromtimestamp(timestamp,datetime.timezone.utc)
                    cairo=utc.astimezone(ZoneInfo("Africa/Cairo"))
                    supplied=datetime.date.fromisoformat(bar["session"])
                    utc_supplied=datetime.date.fromisoformat(bar["utc_session"])
                except (KeyError,TypeError,ValueError,OverflowError):
                    category="INVALID_TIMESTAMP"
                else:
                    if cairo.date()!=supplied or utc.date()!=utc_supplied:
                        category="TIMESTAMP_DATE_MISMATCH"
                    elif cairo.date().weekday() in (4,5):
                        category="CAIRO_WEEKEND_TIMESTAMP"
                    elif metadata.get("exchangeTimezoneName") not in ("Africa/Cairo","Egypt"):
                        category="PROVIDER_TIMEZONE_REVIEW"
                    else:
                        category="WEEKDAY_UNVERIFIED"
                    if len(examples)<24 and category!="WEEKDAY_UNVERIFIED":
                        examples.append({"symbol":symbol,"reported_session":bar.get("session"),
                            "utc_timestamp":utc.isoformat(),"cairo_timestamp":cairo.isoformat(),
                            "classification":category,"provider_currency":metadata.get("currency")})
                classes[category]+=1
                per_symbol[symbol][category]+=1
    report={"schema":"egx-timestamp-diagnostics-1","counts":dict(classes),
        "symbols":{sym:dict(counts) for sym,counts in sorted(per_symbol.items())},
        "examples":examples,"certified_sessions":0,"v4a_eligible":False,
        "production_modified":False,
        "warning":"The Cairo weekday is not an official exchange-session calendar."}
    Path(output_path).write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"counts":dict(classes),"certified_sessions":0}))
    return report

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--source",required=True)
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    diagnose(args.source,args.output)
