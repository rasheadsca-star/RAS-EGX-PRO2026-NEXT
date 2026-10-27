#!/usr/bin/env python3
"""Fail-closed EGX vendor EOD-CSV intake. Research staging ONLY, never mutates history."""
import csv, hashlib, json, os, pathlib, re
from collections import Counter
from datetime import date
ROOT=pathlib.Path(os.getenv("GITHUB_WORKSPACE") or pathlib.Path.cwd()).resolve()
OUT=pathlib.Path(os.getenv("EGX_RECOVERY_OUT") or ROOT/"artifacts/history-recovery").resolve()
HEADERS=("ticker","isin","currency","date","open","high","low","close","volume",
         "source","source_url","source_session_date","final_eod","license_ref",
         "corporate_action_status","second_source","second_source_url",
         "second_session_date","second_close")
APPROVED_SOURCE_IDS={"EGX_OFFICIAL","EGID_LICENSED","ICE_LICENSED",
                     "DIRECTFN_LICENSED","MUBASHER_LICENSED","OTHER_LICENSED"}
def load(p,default=None):
    try:return json.loads(pathlib.Path(p).read_text(encoding="utf-8"))
    except (OSError,ValueError):return {} if default is None else default
def date_ok(s):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}",str(s or "")):return False
    try:return date.fromisoformat(s).isoformat()==s
    except ValueError:return False
def numeric(value):
    if value in (None,""):return None
    try:
        x=float(str(value).strip())
        return x if x==x and abs(x)<float("inf") else None
    except ValueError:return None
def missing_symbol_request(symbol_map,summary,expected):
    hist={x["ticker"]:x for x in summary.get("symbols",[]) if x.get("ticker")}
    rows=[]
    for t,e in sorted(symbol_map.items()):
        if e.get("active") is False:continue
        h=hist.get(t,{})
        n=int(h.get("availableSessions") or 0)
        latest=h.get("lastSession")
        reasons=[]
        if n==0:reasons.append("NO_HISTORY")
        elif n<60:reasons.append("UNDER_60_BARS")
        if latest!=expected:reasons.append("NO_TARGET_SESSION")
        if h.get("symbolVerified") is not True:reasons.append("UNVERIFIED_IDENTITY")
        if "HTTP 404" in str(h.get("lastUpdateError") or ""):reasons.append("YAHOO_404")
        if reasons:rows.append({"ticker":t,"company_name":e.get("companyNameEn") or e.get("companyNameAr") or "",
            "mapped_isin":e.get("isin") or "","currency":e.get("currency") or "EGP",
            "available_sessions":n,"last_session":latest or "","target_session":expected,
            "requested_min_history_sessions":max(0,120-n),
            "reasons":"|".join(reasons),
            "required_fields":"ticker,ISIN,currency,date,OHLCV,source+URL,final_EOD,corporate_actions,license"})
    return rows

def examine(row,mapped,cutoff):
    reasons=[];hold=[]
    ticker=str(row.get("ticker") or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9._-]{2,14}",ticker) or ticker not in mapped or mapped[ticker].get("active") is False:
        return "REJECTED",["UNKNOWN_OR_INACTIVE_TICKER"],[]
    dateval=str(row.get("date") or "").strip()
    if not date_ok(dateval) or dateval>cutoff:
        reasons.append("INVALID_OR_FUTURE_SESSION")
    source_date=str(row.get("source_session_date") or "").strip()
    if dateval!=source_date:reasons.append("SOURCE_DATE_MISMATCH")
    currency=str(row.get("currency") or "").upper()
    if currency!=str(mapped[ticker].get("currency") or "EGP").upper():reasons.append("MAPPED_TRADING_CURRENCY_MISMATCH")
    m_isin=str(mapped[ticker].get("isin") or "").upper()
    r_isin=str(row.get("isin") or "").upper()
    if not r_isin or not re.fullmatch(r"[A-Z0-9]{10,13}",r_isin):
        reasons.append("INVALID_OR_MISSING_ISIN")
    elif m_isin and r_isin!=m_isin:reasons.append("OFFICIAL_MAP_ISIN_CONFLICT")
    elif not m_isin:hold.append("ISIN_LISTING_CONFIRMATION_REQUIRED")
    vals={p:numeric(row.get(p)) for p in ("open","high","low","close","volume")}
    if any(vals[p] is None for p in vals) or any(vals[p] is not None and vals[p]<=0 for p in ("open","high","low","close")):
        reasons.append("MISSING_OR_NONPOSITIVE_OHLCV")
    else:
        if vals["high"]<max(vals["open"],vals["close"]) or vals["low"]>min(vals["open"],vals["close"]):
            reasons.append("IMPOSSIBLE_OHLC")
        if vals["volume"]<0 or not vals["volume"].is_integer():reasons.append("NONINTEGER_OR_NEGATIVE_VOLUME")
    src=str(row.get("source") or "").upper()
    if src not in APPROVED_SOURCE_IDS:hold.append("UNAPPROVED_PROVIDER_ID")
    if str(row.get("final_eod") or "").upper()!="YES":reasons.append("NOT_EXPLICITLY_FINAL_EOD")
    url=str(row.get("source_url") or "")
    if not url.startswith("https://"):reasons.append("MISSING_HTTPS_SOURCE_URL")
    license_ref=str(row.get("license_ref") or "").strip()
    if not license_ref:hold.append("LICENSE_OR_USAGE_RIGHTS_NOT_DOCUMENTED")
    if str(row.get("corporate_action_status") or "")!="CONFIRMED_NONE":
        hold.append("CORPORATE_ACTION_REVIEW_REQUIRED")
    ss=str(row.get("second_source") or "").strip()
    second_date=str(row.get("second_session_date") or "").strip()
    second_close=numeric(row.get("second_close"))
    second_url=str(row.get("second_source_url") or "")
    if (not ss or ss.upper()==src or second_date!=dateval or second_close is None or
        not second_url.startswith("https://")):
        hold.append("INDEPENDENT_SECOND_SOURCE_EXACT_SESSION_REQUIRED")
    elif vals["close"] and abs(vals["close"]-second_close)/vals["close"]>0.005:
        hold.append("SECOND_SOURCE_CLOSE_DISAGREEMENT_GT_0_5_PCT")
    if reasons:return "REJECTED",sorted(set(reasons)),sorted(set(hold))
    return ("REVIEW_READY" if not hold else "HOLD"),[],sorted(set(hold))

def intake(root=ROOT,out=OUT,source_file=None,cutoff=None):
    mapped=load(root/"data/symbol-map.json")
    summary=load(root/"data/history-summary.json")
    truth=load(root/"data/stable/v15-price-truth.json")
    expected=cutoff or truth.get("expectedSession")
    if not date_ok(expected):raise ValueError("Expected session is not a valid YYYY-MM-DD")
    requests=missing_symbol_request(mapped,summary,expected)
    out.mkdir(parents=True,exist_ok=True)
    with (out/"licensed-provider-gap-request.csv").open("w",encoding="utf-8-sig",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=("ticker","company_name","mapped_isin","currency","available_sessions",
                "last_session","target_session","requested_min_history_sessions","reasons","required_fields"))
        writer.writeheader();writer.writerows(requests)
    with (out/"licensed-provider-upload-template.csv").open("w",encoding="utf-8-sig",newline="") as f:
        csv.DictWriter(f,fieldnames=HEADERS).writeheader()
    result={"schemaVersion":"egx-vendor-ohlcv-review-intake-1","targetSession":expected,
        "reviewOnly":True,"automaticallyPromoted":0,"sourceFile":str(source_file) if source_file else None,
        "requestCount":len(requests),"received":0,"reviewReady":0,"hold":0,"rejected":0,
        "records":[],"disclaimer":"Not live feed, not approved import, no history mutation."}
    if source_file:
        with pathlib.Path(source_file).open(encoding="utf-8-sig",newline="") as f:
            reader=csv.DictReader(f)
            if not set(HEADERS).issubset(set(reader.fieldnames or [])):
                raise ValueError("Missing required intake columns: "+",".join(sorted(set(HEADERS)-set(reader.fieldnames or []))))
            seen=set()
            for row in reader:
                result["received"]+=1
                k=(str(row.get("ticker") or "").upper(),row.get("date"))
                status,reasons,holds=examine(row,mapped,expected)
                if k in seen:status="REJECTED";reasons.append("DUPLICATE_SYMBOL_SESSION_IN_VENDOR_FILE")
                seen.add(k)
                result[{"REVIEW_READY":"reviewReady","HOLD":"hold","REJECTED":"rejected"}[status]]+=1
                fp=hashlib.sha256(json.dumps({k:row.get(k) for k in HEADERS},sort_keys=True).encode()).hexdigest()
                result["records"].append({"ticker":k[0],"date":k[1],"status":status,"rejectReasons":reasons,"holdReasons":holds,
                    "recordSha256":fp,"provider":row.get("source"),"sourceUrl":row.get("source_url"),"promotionApproved":False})
    (out/"licensed-vendor-intake-review.json").write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n")
    print("EGX_LICENSED_INTAKE",json.dumps({k:result[k] for k in ("targetSession","requestCount","received","reviewReady","hold","rejected","automaticallyPromoted")}))
    return result

if __name__=="__main__":
    input_csv=os.getenv("EGX_VENDOR_CSV") or None
    intake(source_file=input_csv)
