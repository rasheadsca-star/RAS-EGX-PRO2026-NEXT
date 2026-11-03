#!/usr/bin/env python3
"""Create dated, UNAPPROVED EGX ISIN/ticker candidates from official index pages.

Each source is downloaded as HTML and preserved with SHA-256. A current
index-constituents listing does not prove a security had the same symbol on a
past trading date. This tool never writes canonical bars or approves aliases.

Input: --source INDEX=URL (repeat), OR --html INDEX=filename (fixtures)
Output: CSV + provenance JSON. Errors fail closed; no partial output written.
"""
import argparse
import csv
import datetime as dt
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
from egx_identity_reference import isin_valid

ISIN = re.compile(r"^EG[A-Z0-9]{9}[0-9]$")
REUTERS = re.compile(r"^([A-Z0-9.]{2,20})\.CA$")
KNOWN = frozenset(("CASE30","EGX70","EGX100","EGX30","EGX30CAP","EGX30TR","EGX35","TAMAYUZ","EGX70EWI","EGX100EWI"))
COLUMNS = ["ticker","isin","name","source_url","effective_from"]
class ExtractError(ValueError): pass

class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables=[];self.current=None;self.cell=None
    def handle_starttag(self,tag,attrs):
        if tag=="table":self.current=[]
        if tag in ("th","td") and self.current is not None:self.cell=[]
    def handle_data(self,data):
        if self.cell is not None:self.cell.append(data)
    def handle_endtag(self,tag):
        if tag in ("th","td") and self.cell is not None and self.current is not None:
            self.current.append((" ".join(" ".join(self.cell).split()),tag))
            self.cell=None
        if tag=="tr" and self.current is not None:
            self.tables.append(self.current)
            self.current=[]
        if tag=="table":self.current=None

def official(url):
    u=urllib.parse.urlsplit(url)
    if u.scheme!="https" or u.username or u.password or u.fragment:
        raise ExtractError("SOURCE_REQUIRES_HTTPS_NO_CREDENTIALS")
    if u.hostname not in ("egx.com.eg","beta.egx.com.eg","www.egx.com.eg"):
        raise ExtractError("SOURCE_DOMAIN_NOT_OFFICIAL")
    if not u.path.startswith("/en/market/indices/constituents"):
        raise ExtractError("WRONG_OFFICIAL_PAGE_TYPE")
    if urllib.parse.parse_qs(u.query).get("index") is None:
        raise ExtractError("MISSING_INDEX_QUERY")
    return True

def parse(source_html,url,as_of):
    official(url)
    parser=Tables();parser.feed(source_html)
    rows=[];found_header=False
    # HTMLParser collects each logical <tr> in a list.
    for raw in parser.tables:
        cells=[v for v,_ in raw]
        if len(cells)<3:continue
        if (cells[0].strip().upper()=="ISIN" and "REUTERS" in cells[1].upper()):
            found_header=True;continue
        isin=cells[0].upper().strip()
        code=cells[1].upper().strip()
        m=REUTERS.fullmatch(code)
        if not ISIN.fullmatch(isin) or not m:continue
        if not isin_valid(isin):raise ExtractError("INVALID_ISIN_CHECK_DIGIT:"+isin)
        name=cells[2].strip()
        if not name:raise ExtractError("EMPTY_COMPANY_NAME")
        rows.append(dict(ticker=m.group(1),isin=isin,name=name,source_url=url,effective_from=as_of))
    if not found_header or len(rows)<1:raise ExtractError("NO_OFFICIAL_ISIN_REUTERS_TABLE")
    return rows

def digest(data):return hashlib.sha256(data).hexdigest()

def build(sources,as_of):
    dt.date.fromisoformat(as_of)
    if not sources:raise ExtractError("NO_INDEX_SOURCES")
    pairs={};seen_isin={};sources_report=[];conflicts=[]
    for index,url,body in sources:
        official(url)
        rows=parse(body.decode("utf-8-sig"),url,as_of)
        sources_report.append(dict(index=index,url=url,sha256=digest(body),observed_on=as_of,rows=len(rows)))
        for r in rows:
            ticker,isin=r["ticker"],r["isin"]
            prior=pairs.get(ticker)
            if prior and prior["isin"]!=isin:conflicts.append(dict(kind="TICKER_MULTIPLE_ISINS",ticker=ticker,isin_a=prior["isin"],isin_b=isin))
            if isin in seen_isin and seen_isin[isin]!=ticker:
                conflicts.append(dict(kind="ISIN_MULTIPLE_TICKERS",isin=isin,ticker_a=seen_isin[isin],ticker_b=ticker))
            if not prior:pairs[ticker]=r
            seen_isin.setdefault(isin,ticker)
    if conflicts:raise ExtractError("CROSS_INDEX_IDENTITY_CONFLICT:"+json.dumps(conflicts,ensure_ascii=False))
    return dict(rows=sorted(pairs.values(),key=lambda r:r["ticker"]),provenance=dict(
        status="UNAPPROVED_CURRENT_INDEX_CROSSWALK",as_of=as_of,
        source_authenticated=False,history_asof_proved=False,
        independent_symbol_approval=False,may_publish_official_prices=False,
        entries=len(pairs),sources=sources_report))

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--as-of",required=True)
    a.add_argument("--source",action="append",default=[],help="INDEX=https://beta.egx.com.eg/en/market/indices/constituents?index=CASE30")
    a.add_argument("--html",action="append",default=[],help="INDEX=LOCAL_HTML_FILE")
    a.add_argument("--csv-out",required=True);a.add_argument("--evidence-out",required=True)
    args=a.parse_args()
    if args.html and args.source:raise ExtractError("MIXED_LOCAL_AND_REMOTE_SOURCES")
    sources=[]
    for spec in args.html:
        idx,sep,path=spec.partition("=")
        if not sep:raise ExtractError("BAD_HTML_INPUT")
        idx=idx.upper()
        if idx not in KNOWN:raise ExtractError("UNSUPPORTED_INDEX")
        url="https://beta.egx.com.eg/en/market/indices/constituents?index="+idx
        sources.append((idx,url,Path(path).read_bytes()))
    for spec in args.source:
        idx,sep,url=spec.partition("=")
        if not sep:raise ExtractError("BAD_SOURCE")
        idx=idx.upper()
        if idx not in KNOWN:raise ExtractError("UNSUPPORTED_INDEX")
        official(url)
        if urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get("index",[""])[0].upper()!=idx:
            raise ExtractError("INDEX_URL_MISMATCH")
        req=urllib.request.Request(url,headers={"User-Agent":"EGX-PRO-research-audit/1.0","Accept":"text/html"})
        with urllib.request.urlopen(req,timeout=25) as res:
            payload=res.read(3_000_001)
        if len(payload)>3_000_000:raise ExtractError("HTML_OVERSIZE")
        sources.append((idx,url,payload))
    out=build(sources,args.as_of)
    p=Path(args.csv_out);q=Path(args.evidence_out)
    if p.resolve()==q.resolve():raise ExtractError("OUTPUT_PATH_COLLISION")
    p.parent.mkdir(parents=True,exist_ok=True);q.parent.mkdir(parents=True,exist_ok=True)
    buf=io.StringIO();wr=csv.DictWriter(buf,fieldnames=COLUMNS)
    wr.writeheader();wr.writerows(out["rows"])
    p.write_text(buf.getvalue(),encoding="utf-8")
    q.write_text(json.dumps(out["provenance"],ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(out["provenance"],ensure_ascii=False))
if __name__=="__main__":main()
