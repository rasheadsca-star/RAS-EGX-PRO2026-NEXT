#!/usr/bin/env python3
"""Publish paper-research ONLY rankings from a PDF + fully reviewed CSV pair.
Independent from all production engines and canonical SQLite.
Required CSV fields from verified staging plus identityReviewed=true per ticker.
"""
import csv, datetime as dt, hashlib, json, math, pathlib, sys
from egx_pdf_stage_verified import stage

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/"egx-pro-research-12nov2026"
WEIGHTS=["50/30/20","20/40/40","30/30/40","60/20/20","50/20/30",
         "40/40/20","40/30/30","30/40/30","33/33/34"]

def numeric_on_row(words,y,low,high):
    tokens=[w[4] for w in words if low<=w[0]<high and abs(w[1]-y)<6]
    if len(tokens)!=1: raise ValueError("ambiguous numeric cell "+str(tokens))
    return float(tokens[0].replace(",",""))

def extra_market_fields(doc,record):
    words=doc[record["sourcePage"]-1].get_text("words")
    rank=str(record["sourceRank"])
    anchors=[w for w in words if 15<w[0]<45 and w[4]==rank and 60<w[1]<1070]
    if len(anchors)!=1: raise ValueError("missing or duplicate source rank "+rank)
    y=anchors[0][1]
    turnover=numeric_on_row(words,y,559,630)
    change=numeric_on_row(words,y,518,563)
    if not (turnover>=0 and -100<=change<=100):
        raise ValueError("invalid official turnover/change "+rank)
    # Independent sanity check: value should be in plausible range of volume*OHLC.
    low,high,volume=record["low"],record["high"],record["volume"]
    if volume<=0 or not (.75*low*volume<=turnover<=1.25*high*volume):
        raise ValueError("turnover/price/volume mismatch "+rank)
    return turnover,change

def mid_percentiles(rows,key):
    values=sorted(float(x[key]) for x in rows)
    n=len(values); mapping={}
    from bisect import bisect_left,bisect_right
    for v in set(values):
        a,b=bisect_left(values,v),bisect_right(values,v)
        mapping[v]=100*((a+b-1)/2)/(n-1) if n>1 else 50
    return [mapping[float(x[key])] for x in rows]

def publish(pdf,csvfile):
    import fitz
    pdf,csvfile=pathlib.Path(pdf),pathlib.Path(csvfile)
    with csvfile.open(encoding="utf-8-sig",newline="") as handle:
        raw=list(csv.DictReader(handle))
    if len(raw)<180:raise ValueError("insufficient reviewed market coverage: "+str(len(raw)))
    if not all(str(r.get("identityReviewed","")).strip().lower()=="true" for r in raw):
        raise ValueError("identityReviewed=true required for every row; ambiguous ticker mapping blocks release")
    review=stage(str(pdf),str(csvfile),str(OUT/"staging"/(pdf.stem+".json")))
    report_date=review["sessionDate"]
    if report_date<= "2026-11-12":raise ValueError("do not overwrite frozen 12 Nov benchmark")
    if report_date>dt.date.today().isoformat():raise ValueError("future report")
    document=fitz.open(pdf)
    data=[]
    for record in review["rows"]:
        if not record["pdfMatched"]:raise ValueError("pdf match failed")
        turnover,change=extra_market_fields(document,record)
        high,low,close=record["high"],record["low"],record["close"]
        if high<=low or not low<=close<=high:raise ValueError("invalid close location")
        data.append(dict(symbol=record["ticker"],rank=record["sourceRank"],
          pdfPage=record["sourcePage"],close=close,high=high,low=low,
          open=record["open"],volume=record["volume"],turnover=turnover,
          changePct=change,closePosition=(close-low)/(high-low)))
    if len({x["symbol"] for x in data})!=len(data):raise ValueError("duplicate ticker")
    ps=[mid_percentiles(data,k) for k in ("changePct","closePosition","turnover")]
    ranklists={}
    for w in WEIGHTS:
        weights=[int(i) for i in w.split("/")]
        order=sorted([dict(**x,score=round(sum(weights[j]*ps[j][i]/100 for j in range(3)),4))
                      for i,x in enumerate(data)],
                      key=lambda x:(-x["score"],-x["turnover"],x["symbol"]))
        ranklists[w]=[dict(rank=i+1,**x) for i,x in enumerate(order[:10])]
    payload={"schemaVersion":"egx-research-official-reviewed-v1",
       "session":report_date,"weights":WEIGHTS,"rankings":ranklists,
       "marketRows":len(data),"sourcePdfSha256":hashlib.sha256(pdf.read_bytes()).hexdigest(),
       "reviewedCsvSha256":hashlib.sha256(csvfile.read_bytes()).hexdigest(),
       "officialSource":"EGX DiscDoc 1022 PDF matched with manually reconciled CSV",
       "reviewState":"PDF_MATCHED_REVIEWED_CSV_RESEARCH_ONLY",
       "qualityWarning":"Ticker identities manually reviewed; backtest and risk controls not certified; not an execution signal.",
       "executionGrade":False,"orders":[]}
    destination=OUT/"sessions"/(report_date+".json")
    content=json.dumps(payload,ensure_ascii=False,indent=2)+"\n"
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.exists() and destination.read_text(encoding="utf-8")!=content:
        raise ValueError("immutable session conflict")
    destination.write_text(content,encoding="utf-8")
    latest=OUT/"latest.json"
    if latest.exists():
        old=json.loads(latest.read_text(encoding="utf-8"))
        if old["session"]>report_date:raise ValueError("cannot regress session date")
    latest.write_text(content,encoding="utf-8")
    print("RESEARCH_ONLY_PUBLISHED",report_date,len(data),[r["symbol"] for r in ranklists["30/40/30"][:3]])

if __name__=="__main__":
    if len(sys.argv)!=3:sys.exit("Usage: egx_research_rank_verified.py report.pdf reviewed.csv")
    try:publish(sys.argv[1],sys.argv[2])
    except Exception as e:
        print("RESEARCH_PUBLISH_BLOCKED:",type(e).__name__,str(e),file=sys.stderr)
        sys.exit(2)
