"""Read-only fetch of official EGX Daily Report PDF. Never publish on download alone."""
import argparse
from datetime import datetime, timezone
import hashlib, json, os, re, sys
from pathlib import Path
import urllib.request
import fitz

DEFAULT_URL = "https://www.egx.com.eg/en/get_pdf.aspx?Lang=ENG&ID=1022"
DATE_RE=re.compile(r"Trading\s+Date\s*:\s*(\d{2})/(\d{2})/(20\d{2})",re.I)

def fetch(url,output, expected_after=None):
    req=urllib.request.Request(url, headers={
        "User-Agent":"EGX-PRO-Research/1.0 (+official bulletin verification)",
        "Accept":"application/pdf"
    })
    with urllib.request.urlopen(req,timeout=45) as resp:
        if resp.status!=200: raise ValueError("HTTP_STATUS_"+str(resp.status))
        data=resp.read(31*1024*1024)
    if not data.startswith(b"%PDF-"):raise ValueError("OFFICIAL_ENDPOINT_DID_NOT_RETURN_PDF")
    if len(data)<20_000 or len(data)>30*1024*1024:raise ValueError("PDF_SIZE_UNEXPECTED")
    pdf=fitz.open(stream=data,filetype="pdf")
    if not 15<=len(pdf)<=120:raise ValueError("PAGE_COUNT_INVALID")
    head=" ".join(pdf[i].get_text() for i in range(min(4,len(pdf))))
    dates={f"{y}-{m}-{d}" for d,m,y in DATE_RE.findall(head)}
    if len(dates)!=1:raise ValueError("AMBIGUOUS_TRADING_DATE")
    day=next(iter(dates))
    if expected_after and day<=expected_after:raise ValueError("NO_NEW_SESSION_"+day)
    if not any("Main Market Stocks Indicators sorted by Value Traded" in page.get_text() for page in pdf):
        raise ValueError("MAIN_MARKET_TABLE_NOT_FOUND")
    path=Path(output);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(data)
    meta={"source":url,"retrievedUTC":datetime.now(timezone.utc).isoformat(),"session":day,
       "sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data),"pages":len(pdf),
       "state":"PDF_DOWNLOADED_STAGING_ONLY","published":False,"certified":False}
    Path(str(path)+".json").write_text(json.dumps(meta,indent=2),encoding="utf-8")
    return meta

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--url",default=os.getenv("EGX_OFFICIAL_REPORT_URL",DEFAULT_URL))
    p.add_argument("--output",default="ingest-staging/egx-latest.pdf")
    p.add_argument("--after")
    args=p.parse_args()
    try:
        print(json.dumps(fetch(args.url,args.output,args.after)))
    except Exception as e:
        print(json.dumps({"state":"FETCH_FAILED","reason":str(e),"requiresManualPDF":True}),file=sys.stderr)
        sys.exit(2)
