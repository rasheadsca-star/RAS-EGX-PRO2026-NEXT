#!/usr/bin/env python3
"""Validate a proposed EGX ticker/ISIN crosswalk WITHOUT approving identities.

Offline input: UTF-8 CSV with ticker,isin,name,source_url,effective_from.
Source URLs are metadata only: no document download/authentication happens
here. A checksum-valid ISIN is NOT sufficient evidence for ticker mapping.
"""
import argparse,csv,datetime,json,pathlib,re,urllib.parse
FIELDS={"ticker","isin","name","source_url","effective_from"}
ISIN_PATTERN=re.compile(r"^EG[A-Z0-9]{9}[0-9]$")
TICKER_PATTERN=re.compile(r"^[A-Z0-9.]{2,20}$")
class RegistryError(ValueError):pass

def isin_valid(code):
    if not isinstance(code,str) or not ISIN_PATTERN.fullmatch(code):return False
    digits="".join(str(int(ch,36)) for ch in code)
    total=0
    for i,ch in enumerate(reversed(digits)):
        n=int(ch)
        if i%2:
            n*=2
            n=(n//10)+(n%10) if n>9 else n
        total+=n
    return total%10==0

def check(rows,as_of):
    cutoff=datetime.date.fromisoformat(as_of)
    findings=[];seen_ticker={};seen_isin={}
    valid=[]
    for i,row in enumerate(rows,2):
        reasons=[]
        ticker=(row.get("ticker") or "").strip().upper()
        isin=(row.get("isin") or "").strip().upper()
        name=(row.get("name") or "").strip()
        source=(row.get("source_url") or "").strip()
        date=(row.get("effective_from") or "").strip()
        if not TICKER_PATTERN.fullmatch(ticker):reasons.append("INVALID_TICKER")
        if not isin_valid(isin):reasons.append("INVALID_EG_ISIN_OR_CHECKDIGIT")
        if not name:reasons.append("EMPTY_COMPANY_NAME")
        url=urllib.parse.urlsplit(source)
        if url.scheme!="https" or url.username or url.password or (
          not (url.hostname=="egx.com.eg" or (url.hostname or "").endswith(".egx.com.eg"))):
            reasons.append("SOURCE_NOT_OFFICIAL_EGX_DOMAIN")
        try:
            d=datetime.date.fromisoformat(date)
            if d>cutoff:reasons.append("EFFECTIVE_DATE_AFTER_ASOF")
        except ValueError:reasons.append("INVALID_EFFECTIVE_DATE")
        if ticker in seen_ticker and seen_ticker[ticker]!=isin:
            reasons.append("TICKER_WITH_MULTIPLE_ISINS")
        if isin in seen_isin and seen_isin[isin]!=ticker:
            reasons.append("ISIN_WITH_MULTIPLE_TICKERS")
        seen_ticker.setdefault(ticker,isin)
        seen_isin.setdefault(isin,ticker)
        entry={"line":i,"ticker":ticker,"isin":isin,"name":name,
               "source_url":source,"effective_from":date,"reasons":reasons,
               "format_status":"PASS" if not reasons else "REJECT"}
        findings.append(entry)
        if not reasons:valid.append(entry)
    return {"status":"FORMAT_CHECK_ONLY_NOT_APPROVED",
            "reference_date":as_of,"submitted_rows":len(findings),
            "format_pass":len(valid),"format_rejected":len(findings)-len(valid),
            "source_authenticated":False,"identity_approved":False,
            "may_mark_alias_verified":False,
            "items":findings}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--csv",required=True);p.add_argument("--as-of",required=True)
    p.add_argument("--out",required=True)
    a=p.parse_args();datetime.date.fromisoformat(a.as_of)
    with pathlib.Path(a.csv).open(newline="",encoding="utf-8-sig") as f:
        rows=csv.DictReader(f)
        if not rows.fieldnames or not FIELDS.issubset(rows.fieldnames):
            raise RegistryError("REQUIRED_CSV_COLUMNS_MISSING")
        report=check(list(rows),a.as_of)
    target=pathlib.Path(a.out);target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="items"},ensure_ascii=False))
    if report["format_rejected"]:raise SystemExit(2)
if __name__=="__main__":main()
