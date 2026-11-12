#!/usr/bin/env python3
"""Official EGX report availability monitor. Fail closed: no trading signals generated."""
import datetime as dt, hashlib, json, os, pathlib, re, sys, urllib.request
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "egx-pro-research-12nov2026" / "official-status.json"
ARTIFACT = ROOT / "egx-official-inbox" / "latest-official-report.pdf"
URLS = [
 "https://www.egx.com.eg/en/get_pdf.aspx?Lang=ENG&ID=1022",
 "https://egx.com.eg/en/get_pdf.aspx?Lang=ENG&ID=1022",
]
def local_today():
    return dt.datetime.now(ZoneInfo("Africa/Cairo")).date()
def expected_session(day):
    while day.weekday() in (4,5): day -= dt.timedelta(days=1)
    return day
def update(status, *, source=None, date=None, reason=None, sha=None):
    now=dt.datetime.now(ZoneInfo("Africa/Cairo")).isoformat(timespec="seconds")
    obj={"schemaVersion":"egx-official-research-monitor-v1",
         "checkedAt":now,"expectedSession":str(expected_session(local_today())),
         "lastVerifiedResearchSession":"2026-11-12",
         "status":status,"sourceUrl":source,
         "downloadedReportSession":date,"pdfSha256":sha,
         "reason":reason,"recommendationsUpdated":False,
         "publicationGrade":"REVIEW_ONLY",
         "officialReportsPage":"https://egx.com.eg/en/Services_Reports.aspx",
         "manualUpload":"https://github.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/upload/main/data/official-egx-reports",
         "note":"Latest available snapshot remains 2026-11-12 until full PDF row reconciliation. Never publish a new trading recommendation from this monitor."}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:obj[k] for k in ("status","expectedSession","downloadedReportSession","reason")},ensure_ascii=False))
def check_pdf(data):
    if len(data)<30000 or not data.startswith(b"%PDF"):raise ValueError("NOT_PDF")
    import fitz
    doc=fitz.open(stream=data,filetype="pdf")
    if len(doc)<10:raise ValueError("REPORT_TOO_SHORT")
    intro="\n".join(doc[i].get_text() for i in [0,2,3,16] if i<len(doc))
    dates=re.findall(r"(?:Trading Date|Issued at|^\s*)(?:\s*:\s*)?(\d{1,2}/\d{1,2}/20\d{2})",intro,re.I|re.M)
    if not dates:raise ValueError("SESSION_DATE_NOT_EXTRACTABLE")
    values=[]
    for x in dates:
        try:values.append(dt.datetime.strptime(x,"%d/%m/%Y").date())
        except ValueError:pass
    if not values:raise ValueError("INVALID_SESSION_DATE")
    primary=values[0]
    if primary>local_today():raise ValueError("FUTURE_SESSION")
    stock_pages=sum("Main Market Stocks Indicators" in doc[i].get_text() for i in range(min(35,len(doc))))
    if stock_pages<1:raise ValueError("NO_MAIN_MARKET_TABLE")
    return str(primary)
def main():
    if local_today().weekday() in (4,5):
        update("MARKET_CLOSED",reason="Friday/Saturday — no new session due");return
    errors=[]
    for url in URLS:
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 EGX-Research-Monitor/1.0","Accept":"application/pdf,*/*"})
            with urllib.request.urlopen(req,timeout=25) as res:
                final_url=res.geturl()
                if not final_url.lower().startswith(("https://www.egx.com.eg/","https://egx.com.eg/")):raise ValueError("UNTRUSTED_REDIRECT")
                data=res.read(14_000_000)
            session=check_pdf(data)
            expected=str(expected_session(local_today()))
            if session!=expected:
                update("NEEDS_UPLOAD",source=url,date=session,reason="OFFICIAL_REPORT_NOT_LATEST: expected "+expected)
                return
            ARTIFACT.parent.mkdir(parents=True,exist_ok=True);ARTIFACT.write_bytes(data)
            update("REPORT_DOWNLOADED_PENDING_ROW_REVIEW",source=url,date=session,sha=hashlib.sha256(data).hexdigest(),
                   reason="PDF obtained but ticker identity and all rows require reconciliation before new rankings")
            return
        except Exception as exc:errors.append(type(exc).__name__+":"+str(exc)[:170])
    update("NEEDS_UPLOAD",reason="; ".join(errors)[:550])
if __name__=="__main__":
    try:main()
    except Exception as exc:
        update("NEEDS_UPLOAD",reason="MONITOR_ERROR "+repr(exc)[:350])
