#!/usr/bin/env python3
"""Read-only V16 source-feature exclusion audit. No acceptance-gate modification."""
import json, os, runpy, collections, argparse
from pathlib import Path

ROOT=Path(os.getenv("GITHUB_WORKSPACE") or ".").resolve()
src=runpy.run_path(str(ROOT/"scripts/research/v16-two-stage-predictor.py"),run_name="g11_v16_research_audit")
norm_hist=src["norm_hist"]
base_feature=src["base_feature"]
date=json.loads((ROOT/"data/stable/v15-price-truth.json").read_text())["expectedSession"]
raw=json.loads((ROOT/"data/symbol-map.json").read_text())
items=raw if isinstance(raw,list) else list(raw.values())
active=sorted({str(x.get("ticker") or "").upper().strip() for x in items if x.get("active") is not False and x.get("ticker")})
parser=argparse.ArgumentParser()
parser.add_argument('--universe-file',help='Exact certified G11 active ticker file, JSON {session,tickers}')
args=parser.parse_args()
if args.universe_file:
    universe=json.loads(Path(args.universe_file).read_text(encoding='utf-8'))
    if universe.get('session') != date: raise ValueError('CERTIFIED_UNIVERSE_SESSION_MISMATCH')
    selected=universe.get('tickers')
    if not isinstance(selected,list) or not selected or any(not isinstance(t,str) or not t.strip() for t in selected):
        raise ValueError('CERTIFIED_UNIVERSE_INVALID')
    active=sorted({t.upper().strip() for t in selected})

rows=[]
for ticker in active:
    p=ROOT/"data/history"/(ticker+".json")
    record={"ticker":ticker,"session":date,"reason":None,"validSessions":0,"lastDate":None,"currentBar":False,"baseFeature":False}
    if not p.exists():
        record["reason"]="HISTORY_FILE_MISSING";rows.append(record);continue
    try:
        h=norm_hist(p)
        bars=[x for x in h["rows"] if x["date"]<=date]
        record["validSessions"]=len(bars)
        record["lastDate"]=bars[-1]["date"] if bars else None
        record["currentBar"]=record["lastDate"]==date
        record["symbolSourceEligible"]=bool(h["ok"])
        if not h["ok"]:record["reason"]="SOURCE_HISTORY_NOT_ELIGIBLE"
        elif len(bars)<60:record["reason"]="LESS_THAN_60_BARS"
        elif not record["currentBar"]:record["reason"]="NO_CURRENT_SESSION_BAR"
        else:
            idx=len(bars)-1
            h["rows"]=bars
            feature=base_feature(h,idx)
            record["baseFeature"]=bool(feature and feature.get("date")==date)
            record["reason"]="FEATURE_OK" if record["baseFeature"] else "BASE_FEATURE_REJECTED"
            if not record["baseFeature"]:
                base=src
                close=bars[idx]["close"]
                atr=base["BASE"]["atr"](bars,idx)
                previous=bars[idx-1]["close"]
                atr_pct=100*atr/close if atr is not None and close>0 else None
                one_day_return=100*(close/previous-1) if previous>0 else None
                previous_volume_mean=base["BASE"]["sma"](bars,idx-1,20,"volume")
                record["atrPct"]=round(atr_pct,4) if atr_pct is not None else None
                record["oneDayReturnPct"]=round(one_day_return,4) if one_day_return is not None else None
                record["previousVolumeMean20"]=previous_volume_mean
                if previous_volume_mean is None or previous_volume_mean<=0:
                    record["rootCause"]="NON_POSITIVE_20_SESSION_BASELINE_VOLUME"
                elif atr_pct is None:
                    record["rootCause"]="ATR_NOT_COMPUTABLE"
                elif atr_pct<0.4:
                    record["rootCause"]="ATR_BELOW_V16_MINIMUM_0_4_PCT"
                elif atr_pct>14:
                    record["rootCause"]="ATR_ABOVE_V16_MAXIMUM_14_PCT"
                elif one_day_return is not None and abs(one_day_return)>30:
                    record["rootCause"]="DAILY_MOVE_ABOVE_V16_30_PCT"
                else:
                    record["rootCause"]="OTHER_FEATURE_REJECTION_REQUIRES_MANUAL_REVIEW"
    except Exception as e:
        record["reason"]="PARSE_OR_FEATURE_ERROR";record["diagnostic"]=str(e)[:160]
    rows.append(record)
counts=dict(sorted(collections.Counter(x["reason"] for x in rows).items()))
out={"schemaVersion":"egx-v16-feature-exclusion-audit-1","session":date,"universeBasis":"CERTIFIED_G11_ACTIVE_UNIVERSE" if args.universe_file else "SYMBOL_MAP_RAW_ACTIVE","active":len(active),"reasonCounts":counts,"v16FeatureEligible":counts.get("FEATURE_OK",0),"records":rows,"eligibleForExecution":False,"note":"Read-only V16 feature computation diagnostic; not a certified G11 G09 output"}
folder=ROOT/"artifacts/research";folder.mkdir(parents=True,exist_ok=True)
(folder/"v16-feature-exclusion-audit.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n")
print("V16_FEATURE_REJECTION_AUDIT",json.dumps({"active":out["active"],"featureEligible":out["v16FeatureEligible"],"reasons":counts}))
