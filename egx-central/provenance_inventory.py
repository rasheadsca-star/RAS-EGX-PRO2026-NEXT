#!/usr/bin/env python3
"""Conservative provenance inventory for public research prices. Never certifies trading eligibility."""
import argparse,collections,json
from pathlib import Path

def audit(source,output):
    payload=json.loads(Path(source).read_text(encoding="utf-8"))
    counts=collections.Counter();symbols={}
    for stock in payload.get("rows",[]):
        name=str(stock.get("symbol","")).upper()
        for feed in stock.get("attempts",[]):
            candles=feed.get("candidate") or []
            if not candles:continue
            meta=feed.get("yahoo_meta") or {}
            if feed.get("source")!="yahoo_chart":
                reason="NO_INDEPENDENT_MARKET_IDENTITY"
            elif str(meta.get("symbol") or "").upper()!=name+".CA":
                reason="SYMBOL_MISMATCH_OR_MISSING"
            elif not meta.get("exchangeName"):
                reason="MISSING_EXCHANGE"
            elif not meta.get("currency"):
                reason="MISSING_CURRENCY"
            elif not meta.get("exchangeTimezoneName"):
                reason="MISSING_TIMEZONE"
            else:
                reason="METADATA_PRESENT_NOT_INDEPENDENTLY_VERIFIED"
            counts[reason]+=len(candles)
            symbols[name]={"reason":reason,"observations":len(candles),
                "provider_symbol":meta.get("symbol"),"exchange":meta.get("exchangeName"),
                "currency":meta.get("currency"),"timezone":meta.get("exchangeTimezoneName")}
    result={"schema":"egx-provenance-inventory-1","counts":dict(counts),
        "symbols":symbols,"certified_ohlcv":0,"v4a_eligible":False,"production_modified":False,
        "warning":"Provider metadata alone cannot establish issuer identity, independent close matches or corporate actions."}
    Path(output).write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"counts":dict(counts),"certified_ohlcv":0}));return result

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--source",required=True);p.add_argument("--output",required=True)
    a=p.parse_args();audit(a.source,a.output)
