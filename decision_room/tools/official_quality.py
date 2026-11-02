#!/usr/bin/env python3
"""Fail-closed quality gate for staged EGX official bulletin; DOES NOT merge or publish."""
import argparse
import json
import math
from pathlib import Path

class QualityError(ValueError):
    pass

def inspect(data, min_rows=180):
    errors = []
    counts = {"total": 0, "egp": 0, "usd": 0, "invalid": 0, "duplicate": 0}
    items = data.get("items")
    if not isinstance(items, list):
        raise QualityError("ITEMS_NOT_LIST")
    counts["total"] = len(items)
    if len(items) < min_rows:
        errors.append("INSUFFICIENT_ROWS:%s<%s" % (len(items), min_rows))
    if data.get("rows") != len(items):
        errors.append("ROW_COUNT_MISMATCH")
    seen = set()
    for i, x in enumerate(items):
        if not isinstance(x, dict):
            errors.append("INVALID_RECORD:%d" % i)
            counts["invalid"] += 1
            continue
        currency = x.get("currency")
        if currency == "EGP":
            counts["egp"] += 1
        elif currency == "USD":
            counts["usd"] += 1
        else:
            errors.append("UNKNOWN_CURRENCY:%d" % i)
        name = x.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append("MISSING_NAME:%d" % i)
        # Do not deduplicate solely by rank; ranks restart in different tables.
        key = (currency, " ".join(name.casefold().split())) if isinstance(name, str) else None
        if key is not None:
            if key in seen:
                counts["duplicate"] += 1
                errors.append("DUPLICATE_NAME_CURRENCY:%d" % i)
            seen.add(key)
        vals = [x.get(k) for k in ("open", "high", "low", "close", "volume")]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in vals):
            counts["invalid"] += 1
            errors.append("NONFINITE_OHLCV:%d" % i)
            continue
        op, hi, lo, close, vol = vals
        if min(op, hi, lo, close) <= 0 or vol < 0 or hi < max(op, close) or lo > min(op, close):
            counts["invalid"] += 1
            errors.append("INVALID_OHLCV:%d" % i)
        if x.get("status") != "CANDIDATE":
            errors.append("QUARANTINED_ROW:%d" % i)
    if data.get("verified_for_trading") is not False:
        errors.append("TRADING_FLAG_NOT_FALSE")
    return {"ok": not errors, "session": data.get("session"), "counts": counts,
            "errors": errors, "verified_for_trading": False}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--min-rows", type=int, default=180)
    args = p.parse_args()
    try:
        report = inspect(json.loads(Path(args.input).read_text(encoding="utf-8")), args.min_rows)
    except (OSError, ValueError, TypeError) as exc:
        report = {"ok": False, "errors": ["INPUT_ERROR:" + str(exc)], "verified_for_trading": False}
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": report["ok"], "errors": report["errors"][:20], "counts": report.get("counts")}))
    if not report["ok"]:
        raise SystemExit(2)

if __name__ == "__main__":
    main()
