"""Research-only full-universe technical scanner over V8 canonical RAW bars.

Never produces executable orders. Missing/stale/uncertain history is visible, not
silently treated as a passed signal. All inputs are truncated at `asof`.
The descriptors are NOT strategies and have NOT been performance-tested.
"""
import argparse
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd


OBSERVED_BARS = 60
MIN_ADV20_EGP = 5_000_000
MIN_REL_VOLUME = 1.3
MIN_TREND_R2 = 0.40
MIN_ANNUAL_LOG_SLOPE = 0.05
NEAR_LOWER_BAND = 0.03
MIN_BOUNCE_FROM_RECENT_LOW = 0.01


def _valid(v):
    return v is not None and math.isfinite(float(v))


def _regression(prices):
    y = np.log(np.asarray(prices, dtype=float))
    x = np.arange(len(y), dtype=float)
    slope = float(np.polyfit(x, y, 1)[0])
    fitted = float(y.mean()) + slope * (x - x.mean())
    residual = y - fitted
    sst = float(np.square(y - y.mean()).sum())
    r2 = 1 - float(np.square(residual).sum()) / sst if sst > 0 else 0.0
    deviation = float(np.std(residual, ddof=2))
    return slope, r2, float(np.exp(fitted[-1] - 1.5 * deviation)), float(np.exp(fitted[-1])), float(np.exp(fitted[-1] + 1.5 * deviation))


def scan(data, session, quality=None):
    """Return exactly one descriptive row per ticker in `data`.

    session is a trusted EGX session date from the caller. quality is the
    independent fail-closed gate result; scanner NEVER changes that decision.
    """
    cutoff = pd.Timestamp(session)
    bars = data["bars"].copy()
    bars["date"] = pd.to_datetime(bars["date"])
    bars = bars[bars["date"] <= cutoff]\n    if "price_basis" in bars.columns:\n        bars = bars[bars["price_basis"] == "RAW"]  # ingest.load already returns RAW only
    identity = data["ident"].set_index("ticker") if len(data.get("ident", [])) else pd.DataFrame()
    gate = {}
    if quality is not None:
        gate = {str(r["ticker"]): r for _, r in quality.iterrows()}
    result = []
    groups = {str(t): g for t, g in bars.groupby("ticker", sort=False)}
    known = set(groups)
    if len(identity):
        known |= set(identity.index.astype(str))
    for ticker in sorted(known):
        g = groups.get(ticker, bars.iloc[:0]).sort_values("date").drop_duplicates("date", keep="last")
        g = g[g["date"] <= cutoff]
        name = ""
        if len(identity) and ticker in identity.index:
            rec = identity.loc[ticker]
            for col in ("name_ar", "name_en"):
                if isinstance(rec.get(col), str) and rec[col].strip():
                    name = rec[col].strip()
                    break
        base = dict(ticker=ticker, name=name, session=str(cutoff.date()), classification="INSUFFICIENT_DATA",
                    research_only=True, executable=False, has_valid_setup=False, entry=None, stop=None,
                    target1=None, target2=None, reasons=[], last_date=None, bars_count=len(g),
                    quality_passed=bool(gate.get(ticker, {}).get("passed", False)),
                    quality_reasons=list(gate.get(ticker, {}).get("reasons", [])))
        if g.empty:
            base["reasons"].append("NO_HISTORY")
            result.append(base)
            continue
        base["last_date"] = str(g["date"].iloc[-1].date())\n        if "calendar" in data:\n            market_days = pd.DatetimeIndex(data["calendar"])\n            expected = market_days[(market_days <= cutoff)][-OBSERVED_BARS:]\n            observed = set(g["date"].iloc[-OBSERVED_BARS:])\n            base["missing_calendar_sessions_60"] = int(sum(dt not in observed for dt in expected))\n        else:\n            base["missing_calendar_sessions_60"] = None
        if g["date"].iloc[-1] != cutoff:
            base["classification"] = "STALE"
            base["reasons"].append("LAST_SESSION_MISSING")
            result.append(base)
            continue
        good = (g["close"].notna() & (g["close"] > 0) & g["high"].notna() &
                g["low"].notna() & (g["high"] >= g["low"]) &
                (g["high"] >= g["close"]) & (g["low"] <= g["close"]) &
                g["volume"].notna() & (g["volume"] >= 0))
        if len(g) < OBSERVED_BARS or not good.iloc[-OBSERVED_BARS:].all():
            base["reasons"].append("MISSING_OR_INVALID_60_BARS")
            result.append(base)
            continue
        w = g.iloc[-OBSERVED_BARS:]
        values = w["close"].to_numpy(dtype=float)
        volume = w["volume"].to_numpy(dtype=float)
        slope, r2, lower, center, upper = _regression(values)
        ma20 = float(values[-20:].mean())
        ma50 = float(values[-50:].mean())
        adv20 = float((w["close"] * w["volume"]).iloc[-20:].mean())
        prev_volume = float(volume[-21:-1].mean())
        relative_volume = float(volume[-1] / prev_volume) if prev_volume > 0 else None
        recent_low = float(w["low"].iloc[-3:].min())
        price = float(values[-1])
        near_support = recent_low <= lower * (1 + NEAR_LOWER_BAND) and recent_low >= lower * (1 - NEAR_LOWER_BAND)
        bounce = bool(price > float(values[-2]) and price >= recent_low * (1 + MIN_BOUNCE_FROM_RECENT_LOW))
        uptrend = bool(slope * 252 > MIN_ANNUAL_LOG_SLOPE and r2 >= MIN_TREND_R2 and price > ma50)
        vol_confirmed = relative_volume is not None and relative_volume >= MIN_REL_VOLUME
        liquid = adv20 >= MIN_ADV20_EGP
        base.update(close=price, ma20=ma20, ma50=ma50, channel_lower=lower,
                    channel_center=center, channel_upper=upper, channel_r2=r2,
                    channel_annual_log_slope=slope * 252, observed_advance_days=len(w),
                    support_proxy=lower, recent_low3=recent_low, relative_volume=relative_volume,
                    adv20_egp=adv20, uptrend=uptrend, near_support=bool(near_support),
                    bounced=bool(bounce), volume_confirmed=bool(vol_confirmed), liquid=bool(liquid),
                    source_tier=str(g["evidence_tier"].iloc[-1]) if "evidence_tier" in g else "UNKNOWN")
        # A ticker may be visually interesting while officially blocked: no trading eligibility.
        if not uptrend:
            base["reasons"].append("NO_CONFIRMED_ASCENDING_CHANNEL")
        if not near_support:
            base["reasons"].append("NOT_NEAR_LOWER_CHANNEL")
        if not bounce:
            base["reasons"].append("NO_RECENT_BOUNCE")
        if not vol_confirmed:
            base["reasons"].append("VOLUME_NOT_CONFIRMED")
        if not liquid:
            base["reasons"].append("LOW_LIQUIDITY")
        if not base["quality_passed"]:
            base["reasons"].append("QUALITY_GATE_BLOCKED")
        if uptrend and near_support and bounce and vol_confirmed and liquid:
            base["classification"] = "ASCENDING_CHANNEL_BOUNCE_RESEARCH"
            base["has_valid_setup"] = bool(base["quality_passed"] and not base["missing_calendar_sessions_60"])
        elif uptrend and near_support:
            base["classification"] = "ASCENDING_PULLBACK_WATCH"
        elif uptrend:
            base["classification"] = "ASCENDING_CHANNEL_WATCH"
        elif bounce and vol_confirmed and liquid:
            base["classification"] = "REBOUND_WITHOUT_UPTREND"
        else:
            base["classification"] = "OTHER"
        # Channel support is a statistical proxy, NOT an independently validated strong support.
        result.append(base)
    return result


def report(data, session, quality=None):
    rows = scan(data, session, quality)
    classes = {}
    for r in rows:
        key = r["classification"]
        classes[key] = classes.get(key, 0) + 1
    return dict(schema="egx-market-scanner-research-v1", source_session=str(pd.Timestamp(session).date()),
                research_only=True, verdict="NO_STRATEGY_APPROVED",
                qualifiedTradeCount=0, rows=rows,
                counts=dict(total=len(rows), classified=classes,
                            quality_passed=sum(r["quality_passed"] for r in rows)),
                note="Exploratory visual scanner, not a validated strategy. Missing bars and source conflicts remain blocked; no entry/stop/targets.")


def cli(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True)
    p.add_argument("--asof", required=True)
    p.add_argument("--out", required=True)
    args = p.parse_args(argv)
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from egx_decision.ingest import load
    from egx_decision.quality import evaluate
    data = load(args.db, pd.Timestamp(args.asof))
    quality, _, session = evaluate(data, pd.Timestamp(args.asof))
    obj = report(data, session, quality)
    Path(args.out).write_text(json.dumps(obj, ensure_ascii=False, allow_nan=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(cli())
