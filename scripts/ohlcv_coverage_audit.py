#!/usr/bin/env python3
"""Audit distinct EGX sessions per symbol from an explicitly mapped SQLite OHLCV table.

Fail closed: inspection never promotes data to trading-ready status.
"""
import argparse
import json
import sqlite3
from pathlib import Path

def quote(identifier):
    if not identifier or not identifier.replace("_", "").isalnum() or identifier[0].isdigit():
        raise ValueError("Unsafe SQL identifier")
    return '"' + identifier + '"'

def audit(db, table, symbol, session, open_col, high, low, close, volume):
    con = sqlite3.connect(f"file:{Path(db).resolve()}?mode=ro", uri=True)
    try:
        columns = {row[1] for row in con.execute(f"PRAGMA table_info({quote(table)})")}
        required = [symbol, session, open_col, high, low, close, volume]
        missing = [field for field in required if field not in columns]
        if missing:
            raise ValueError("Missing mapped columns: " + ", ".join(missing))
        cols = [quote(v) for v in required]
        sql = f"SELECT {','.join(cols)} FROM {quote(table)}"
        raw = con.execute(sql)
        tickers = {}
        duplicates = 0
        invalid = 0
        count = 0
        for ticker, day, o, h, l, c, v in raw:
            count += 1
            try:
                ticker = str(ticker).strip().upper()
                day = str(day)[:10]
                if not ticker or len(day) != 10 or day[4] != '-' or day[7] != '-':
                    raise ValueError("invalid identity")
                o, h, l, c, v = map(float, (o, h, l, c, v))
                if min(o, h, l, c) <= 0 or v < 0 or l > min(o, c) or h < max(o, c) or l > h:
                    raise ValueError("invalid price/volume")
            except (TypeError, ValueError):
                invalid += 1
                continue
            days = tickers.setdefault(ticker, set())
            if day in days:
                duplicates += 1
            days.add(day)
        result = []
        for ticker, days in sorted(tickers.items()):
            n = len(days)
            result.append({"ticker": ticker, "sessions": n, "first": min(days), "last": max(days),
                           "coverage": {str(k): n >= k for k in (20, 50, 100, 200)}})
        return {"schemaVersion": "egx-ohlcv-coverage-v1", "status": "AUDIT_ONLY",
                "recommendationsEnabled": False, "rawRows": count,
                "distinctTickers": len(tickers), "duplicateTickerSessions": duplicates,
                "invalidRows": invalid, "symbols": result}
    finally:
        con.close()

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True)
    p.add_argument("--table", required=True)
    p.add_argument("--symbol", default="ticker")
    p.add_argument("--session", default="session")
    p.add_argument("--open", dest="open_col", default="open")
    p.add_argument("--high", default="high")
    p.add_argument("--low", default="low")
    p.add_argument("--close", default="close")
    p.add_argument("--volume", default="volume")
    p.add_argument("--output", required=True)
    a = p.parse_args()
    report = audit(a.db, a.table, a.symbol, a.session, a.open_col, a.high, a.low, a.close, a.volume)
    out = Path(a.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k != "symbols"}, ensure_ascii=False))

if __name__ == "__main__":
    main()
