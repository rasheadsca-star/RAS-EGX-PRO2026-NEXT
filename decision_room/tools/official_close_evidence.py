"""Adds table official_close_only from EGX 'Main Market Year to DD/MM/YYYY Statistics' PDFs (DiscDoc_ID55xxx).
Evidence only: canonical_bars / raw_observations are NEVER modified. The report carries the day's official close and
YTD high/low with dates (no daily OHLC, no volume). A row is tied to a ticker only by fingerprint
(close on the session AND YTD high/low on their dates match one DB ticker); otherwise ticker stays NULL.
usage: official_close_evidence.py --db in.sqlite --out out.sqlite PDF [PDF...]"""
import argparse,collections,datetime,hashlib,pathlib,re,shutil,sqlite3,subprocess,sys
ROW=re.compile(r'(\d{2}/\d{2}/\d{4})\s+([\d.,]+)\s+(\d{2}/\d{2}/\d{4})\s+([\d,.]+)\s+(-?[\d,.]+)')
NUM=re.compile(r'(?<![\w/])-?[\d,]*\.?\d+(?![\w/])')
HDR=re.compile(r'Year to (\d{2})/(\d{2})/(\d{4})')
def f(s):return float(s.replace(',',''))
def iso(d):return f"{d[6:]}-{d[3:5]}-{d[:2]}"
def parse_text(txt):
    m=HDR.search(txt)
    if not m:raise ValueError("not a Year-to-date statistics report")
    day=f"{m[3]}-{m[2]}-{m[1]}";rows=[]
    for ln in txt.splitlines():
        r=ROW.search(ln)
        if not r:continue
        nums=NUM.findall(ln[:r.start()])
        if not nums:continue
        rows.append(dict(name=ln[:32].strip(),hi=f(nums[-1]),hidate=iso(r[1]),lo=f(r[2]),lodate=iso(r[3]),close=f(r[4])))
    return day,rows
def classify(conn,day,rows):
    hist=collections.defaultdict(dict)
    for t,d,h,l,c,tier in conn.execute("select ticker,date,high,low,close,evidence_tier from canonical_bars where price_basis='RAW' and date>='2026-01-01'"):hist[t][d]=(h,l,c,tier)
    near=lambda a,b,p:a is not None and abs(a-b)<=b*p
    out=[]
    for x in rows:
        fp=[t for t,h in hist.items() if x['hidate'] in h and x['lodate'] in h and near(h[x['hidate']][0],x['hi'],.003) and near(h[x['lodate']][1],x['lo'],.003)]
        cl=[t for t,h in hist.items() if day in h and h[day][2] is not None and abs(h[day][2]-x['close'])<=max(.006,x['close']*.0005)]
        both=[t for t in fp if t in cl]
        if len(both)==1:t,s=both[0],'CONFIRMED'
        elif len(fp)==1:
            t=fp[0];s='DB_BAR_MISSING' if day not in hist[t] else 'DB_CLOSE_DIFFERS'
        else:t,s=None,'NOT_VERIFIED'
        d=hist[t].get(day) if t else None
        out.append((day,x['name'],x['close'],x['hi'],x['hidate'],x['lo'],x['lodate'],t,s,d[2] if d else None,d[3] if d else None))
    return out
def main(argv=None):
    a=argparse.ArgumentParser();a.add_argument("--db",required=True);a.add_argument("--out",required=True);a.add_argument("pdfs",nargs="+");x=a.parse_args(argv)
    shutil.copyfile(x.db,x.out);c=sqlite3.connect(x.out)
    before=c.execute("select count(*),sum(coalesce(close,0)) from canonical_bars").fetchone()
    c.execute("drop table if exists official_close_only")
    c.execute("""create table official_close_only(session text,egx_name text,official_close real,ytd_high real,ytd_high_date text,ytd_low real,ytd_low_date text,
      ticker text,status text,db_close real,db_tier text,source_file text,source_sha256 text,source_doc text default 'EGX Main Market Year-to-date Statistics')""")
    cnt=collections.Counter()
    for p in x.pdfs:
        p=pathlib.Path(p);txt=subprocess.run(["pdftotext","-layout",str(p),"-"],capture_output=True,text=True,check=True).stdout
        day,rows=parse_text(txt);sha=hashlib.sha256(p.read_bytes()).hexdigest()
        for r in classify(c,day,rows):
            c.execute("insert into official_close_only(session,egx_name,official_close,ytd_high,ytd_high_date,ytd_low,ytd_low_date,ticker,status,db_close,db_tier,source_file,source_sha256) values(?,?,?,?,?,?,?,?,?,?,?,?,?)",(*r,p.name,sha));cnt[(day,r[8])]+=1
    c.commit()
    after=c.execute("select count(*),sum(coalesce(close,0)) from canonical_bars").fetchone()
    assert before==after,"canonical_bars changed"
    print(dict(sessions=len({k[0] for k in cnt}),rows=sum(cnt.values()),canonical_bars_unchanged=True));c.close();return 0
if __name__=="__main__":sys.exit(main())
