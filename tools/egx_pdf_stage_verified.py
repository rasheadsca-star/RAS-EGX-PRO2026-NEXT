#!/usr/bin/env python3
"""Fail-closed preparation of a manually reviewed EGX PDF import.
Never writes the canonical market snapshot or central SQLite.
Usage: python tools/egx_pdf_stage_verified.py <PDF> <reviewed-CSV> <output.json>
CSV fields: session,rank,pdf_page,ticker,open,high,low,close,volume,validation
"""
import csv,datetime,hashlib,json,math,pathlib,sys
from egx_official_pdf_crosscheck import audit

def stage(pdf,csvpath,out):
    pdf=pathlib.Path(pdf); csvpath=pathlib.Path(csvpath); out=pathlib.Path(out)
    with csvpath.open(encoding="utf-8-sig",newline="") as f:
        data=list(csv.DictReader(f))
    if not data or len(data)<1: raise ValueError("empty reviewed data")
    if any("verifiedAgainstPdf" in row and row["verifiedAgainstPdf"].lower()!="true" for row in data):
        raise ValueError("unverified reviewed row")
    a=audit(str(pdf),str(csvpath))
    if a["pdf_value_mismatched"]:raise ValueError("some PDF values do not match reviewed CSV")
    if a["numeric_ohlc_review"]:raise ValueError("reviewed file contains OHLC exceptions")
    if len(data)!=a["total_rows"]:raise ValueError("audit row mismatch")
    seen=set();outrows=[]
    for r in data:
        ticker=(r.get("ticker") or "").strip().upper()
        if not 2<=len(ticker)<=12 or not ticker.isalnum():raise ValueError("invalid ticker")
        if ticker in seen:raise ValueError("duplicate ticker")
        seen.add(ticker)
        v={k:float(r[k]) for k in ("open","high","low","close","volume")}
        if any(not math.isfinite(x) for x in v.values()):raise ValueError("nonfinite")
        if min(v[k] for k in ("open","high","low","close"))<=0 or v["volume"]<0:raise ValueError("nonpositive price/negative volume")
        if v["high"]<max(v["open"],v["close"]) or v["low"]>min(v["open"],v["close"]):raise ValueError("OHLC invalid")
        if v["volume"]!=int(v["volume"]):raise ValueError("fractional volume")
        outrows.append(dict(ticker=ticker,session=a["session"],**v,sourcePage=int(r["pdf_page"]),sourceRank=int(r["rank"]),pdfMatched=True))
    result={
      "schemaVersion":"egx-pdf-reviewed-staging-v1",
      "sessionDate":a["session"],"sourcePdfSha256":a["source_pdf_sha256"],
      "reviewedCsvSha256":hashlib.sha256(csvpath.read_bytes()).hexdigest(),
      "rowsVerified":len(outrows),"quality":"PDF_CROSSCHECK_PASS_PENDING_IDENTITY_REVIEW",
      "centralDbUpdated":False,"executionGrade":False,
      "rows":outrows
    }
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return result

if __name__=="__main__":
    if len(sys.argv)!=4:sys.exit("Usage: python tools/egx_pdf_stage_verified.py report.pdf reviewed.csv output.json")
    try:
        r=stage(*sys.argv[1:])
        print(json.dumps({k:r[k] for k in ("sessionDate","rowsVerified","quality","centralDbUpdated")},ensure_ascii=False))
    except Exception as e:
        print(type(e).__name__+": "+str(e),file=sys.stderr)
        sys.exit(2)
