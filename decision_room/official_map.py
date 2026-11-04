#!/usr/bin/env python3
"""Official EGX bulletin -> ticker mapping (read-only; never writes a DB).

Why this exists (audit 2026-11-02, defect D3): the bulletin has no ticker/ISIN and wraps long company names over several lines centred on
the number row. The old line-based parser let the name text of adjacent rows bleed into each other, so 115 of 230 rows were quarantined and
91 symbols were falsely STALE. This module
  1. parses the PDF by word bounding boxes (each name word is attached to the NEAREST number row -> no bleed),
  2. resolves rows with a persisted, hash-chained-by-content alias table (exact normalised name) + a previous-close check,
  3. falls back to fuzzy name matching ONLY as a *proposal* (never auto-confirmed), and
  4. refuses anything ambiguous: duplicate claims on one ticker, non-EGP rows, previous-close mismatch.
Nothing is invented: unmatched rows stay QUARANTINED with the reason. The ISIN is not in the bulletin; identity stays NAME+PREVCLOSE evidence.
usage: official_map.py --pdf f.pdf --db central.sqlite --session YYYY-MM-DD --alias alias.json --out mapping.json [--seed-pdf old.pdf --seed-session YYYY-MM-DD]"""
import argparse,collections,difflib,hashlib,html,json,re,sqlite3,subprocess,sys
PREV_TOL=0.007;FUZZY_MIN=0.74;FUZZY_GAP=0.09
NUM=re.compile(r'^-?[\d,]*\.?\d+$')
STOP={'s','a','e','sae','co','company','for','and','the','of','egypt','egyptian','el','al','holding','group','in','industries','investment','development'}

def norm_key(s):
    return re.sub(r"\s+"," ",s.lower()).strip()
def norm_fuzzy(s):
    s=re.sub(r"\(.*?\)"," ",s.lower());s=re.sub(r"[^a-z0-9 ]"," ",s)
    return " ".join(w for w in s.split() if w not in STOP)
def sim(a,b):
    a,b=norm_fuzzy(a),norm_fuzzy(b)
    if not a or not b:return 0.0
    return max(difflib.SequenceMatcher(None,a,b).ratio(),len(set(a.split())&set(b.split()))/max(1,len(set(a.split())|set(b.split()))))

def _words(pdf):
    out=subprocess.run(['pdftotext','-bbox',pdf,'-'],capture_output=True,text=True,check=True).stdout
    pages=re.split(r'<page ',out)[1:]
    return [[(float(m[1]),float(m[2]),float(m[3]),float(m[4]),html.unescape(m[5])) for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>',pg)] for pg in pages]
def _f(x):return float(x.replace(',',''))
def parse_words(pages):
    rows=[]
    for pi,W in enumerate(pages,1):
        cur=[w for w in W if w[4] in('EGP','USD')]
        if not cur:continue
        cx0=min(w[0] for w in cur)-2;anchors=[]
        for c in sorted(cur,key=lambda w:w[1]):
            ym=(c[1]+c[3])/2
            line=sorted([w for w in W if abs((w[1]+w[3])/2-ym)<2.5],key=lambda w:w[0])
            left=[w for w in line if w[0]<c[0]];right=[w[4] for w in line if w[0]>c[0]]
            rk=[w for w in left if re.fullmatch(r'\d{1,3}',w[4])];nums=right[:11]
            if not rk or len(nums)<11 or not all(NUM.match(n) or n.endswith('%') for n in nums[:6]):continue
            try:o,h,l,h52,l52,cl,chg,val=[_f(n) for n in nums[:8]];vol=_f(nums[9]);trd=_f(nums[10])
            except Exception:continue
            anchors.append(dict(page=pi,rank=int(rk[0][4]),ym=ym,cur=c[4],open=o,high=h,low=l,close=cl,chg_pct=chg,value=val,volume=vol,trades=trd,names=[]))
        if not anchors:continue
        xl=min((w[2] for w in W if w[4].isdigit() and abs((w[1]+w[3])/2-anchors[0]['ym'])<2.5),default=0)
        top=min(a['ym'] for a in anchors)-60;bot=max(a['ym'] for a in anchors)+60
        for w in W:
            ym=(w[1]+w[3])/2
            if w[0]>=xl-1 and w[2]<=cx0+1 and top<=ym<=bot and not re.fullmatch(r'\d{1,3}',w[4]):
                a=min(anchors,key=lambda a:abs(a['ym']-ym))
                if abs(a['ym']-ym)<=45:a['names'].append((ym,w[0],w[4]))
        for a in anchors:
            a['name']=re.sub(r'^(Stock Name\s+)+','',' '.join(t for _,_,t in sorted(a['names'])));del a['names'];del a['ym'];rows.append(a)
    return rows
def parse_pdf(pdf):return parse_words(_words(pdf))


def parse_corporate_events(pdf,session):
    """Pages 7-10 'Corporate Actions' block of the daily bulletin -> list of dicts (new listings, stock dividends, capital increases,
    cash dividends = 'Paid Coupons' of equities). Text-layout regexes; unknown layouts yield no event (never invented)."""
    txt=subprocess.run(['pdftotext','-f','7','-l','10','-layout',pdf,'-'],capture_output=True,text=True,check=True).stdout
    sec=None;ev=[]
    for ln in txt.splitlines():
        l=ln.strip()
        for h,k in(("- Stock Dividend","STOCK_DIVIDEND"),("- Capital Increases","CAPITAL_INCREASE"),("- New Listings","NEW_LISTING"),("- Paid Coupons","CASH_DIVIDEND_OR_COUPON"),("- Stock Split","STOCK_SPLIT"),("- Rights","RIGHTS")):
            if l.startswith(h):sec=k
        if l.startswith("Capital Increases"):sec="CAPITAL_INCREASE"
        if l.startswith("Page "):continue
        if sec=="STOCK_DIVIDEND":
            m=re.match(r'(\d\d/\d\d/\d{4})\s+(EG\w{10})\s+(.+?)\s+(EGP|USD)\s+([\d.]+)\s+([\d.]+)$',l)
            if m:ev.append(dict(kind=sec,date=m[1],isin=m[2],name=m[3],currency=m[4],ratio1=float(m[5]),ratio2=float(m[6])))
        elif sec=="CAPITAL_INCREASE":
            m=re.match(r'(\d\d/\d\d/\d{4})\s+(\w+)\s+(.+?)\s+(EGP|USD)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)$',l)
            if m:ev.append(dict(kind=sec,date=m[1],company_code=m[2],name=m[3],currency=m[4],shares_before=int(m[5].replace(',','')),shares_after=int(m[6].replace(',','')),capital_increase=int(m[7].replace(',',''))))
        elif sec=="NEW_LISTING":
            m=re.match(r'(\w+)\s+(.+?)\s+([\d,]+)\s+([\d.]+)\s+(EGP|USD)\s+(\d\d/\d\d/\d{4})$',l)
            if m:ev.append(dict(kind=sec,code=m[1],name=m[2],shares=int(m[3].replace(',','')),par=float(m[4]),currency=m[5],date=m[6]))
        elif sec=="CASH_DIVIDEND_OR_COUPON":
            m=re.match(r'(EG\w{10})\s+(.+?)\s+(EGP|USD)\s+(\d+)\s+(\d\d/\d\d/\d{4})\s+(\d\d/\d\d/\d{4})\s+([\d.]+)\s+(EGP|USD)$',l)
            if m:ev.append(dict(kind=sec,isin=m[1],name=m[2],currency=m[3],cp_no=int(m[4]),div_date=m[5],pay_date=m[6],amount=float(m[7])))
    for e in ev:e["session"]=session
    return ev

def load_alias(path):
    try:d=json.load(open(path))
    except FileNotFoundError:return {"schema":"egx-alias-1","aliases":{}}
    return d
def save_alias(d,path):
    d["content_sha256"]=hashlib.sha256(json.dumps(d["aliases"],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    json.dump(d,open(path,"w"),ensure_ascii=False,indent=1,sort_keys=True)

def resolve(rows,prev_close,ident,alias):
    """rows: parsed bulletin rows; prev_close: {ticker: last canonical RAW close before the session}; ident: {ticker:(name_en,currency)};
    alias: {norm_name: ticker}. Returns (results, proposals). Each result has status + evidence; never raises on bad rows."""
    res=[];claims=collections.defaultdict(list)
    for x in rows:
        r=dict(page=x["page"],rank=x["rank"],name=x["name"],cur=x["cur"],close=x["close"],ticker=None,status=None,evidence=None)
        if x["cur"]!="EGP":r.update(status="EXCLUDED_NON_EGP",evidence=x["cur"]);res.append(r);continue
        implied=x["close"]/(1+x["chg_pct"]/100) if x["chg_pct"]>-100 else None
        key=norm_key(x["name"]);t=alias.get(key)
        if t and implied and t in prev_close and abs(implied/prev_close[t]-1)<=PREV_TOL:
            r.update(ticker=t,status="RESOLVED_ALIAS_PREVCLOSE",evidence=f"alias;prev_diff={abs(implied/prev_close[t]-1):.5f}")
        elif t and t not in prev_close:
            r.update(status="QUARANTINED_NO_PREV_CLOSE",evidence=f"alias->{t}")
        elif t:
            r.update(status="QUARANTINED_ALIAS_PREVCLOSE_MISMATCH",evidence=f"alias->{t}")
        else:
            cands=sorted(((sim(x["name"],en),abs(implied/prev_close[tk]-1),tk) for tk,(en,cur) in ident.items() if cur=="EGP" and tk in prev_close and implied and abs(implied/prev_close[tk]-1)<=PREV_TOL),key=lambda z:(-z[0],z[2]))
            if cands and cands[0][0]>=FUZZY_MIN and (len(cands)==1 or cands[0][0]-cands[1][0]>=FUZZY_GAP):
                r.update(ticker=cands[0][2],status="PROPOSED_FUZZY_NEEDS_APPROVAL",evidence=f"sim={cands[0][0]:.2f};prev_diff={cands[0][1]:.5f}")
            else:r.update(status="QUARANTINED_NO_MATCH",evidence=str([(round(a,2),c) for a,_,c in cands[:2]]))
        if r["ticker"]:claims[r["ticker"]].append(r)
        res.append(r)
    for t,v in claims.items():
        if len(v)>1:
            for r in v:r.update(status="QUARANTINED_DUPLICATE_CLAIM",evidence=f"{t} claimed by {len(v)} rows",ticker=None)
    props=[r for r in res if r["status"]=="PROPOSED_FUZZY_NEEDS_APPROVAL"]
    return res,props

def prev_closes(con,session,max_days=10):
    """Per-ticker last RAW close BEFORE `session` (the bulletin's 'previous close' is the stock's own previous trading close, so a symbol that
    did not trade yesterday is compared with its last close, within max_days calendar days; older -> no previous close available)."""
    return {t:c for t,c in con.execute("select b.ticker,b.close from canonical_bars b where b.price_basis='RAW' and b.date>=date(?,?) and b.date=(select max(date) from canonical_bars where ticker=b.ticker and price_basis='RAW' and date<?)",(session,f"-{max_days} day",session))}

def learn_aliases(rows,confirmed):
    """confirmed: {(page,rank): ticker} from rows the owner/pipeline resolved with name_similarity 1.0 + prev-close. Returns {norm_name: ticker}."""
    out={}
    for x in rows:
        t=confirmed.get((x["page"],x["rank"]))
        if t:out[norm_key(x["name"])]=t
    return out

def main(argv=None):
    ap=argparse.ArgumentParser();ap.add_argument("--pdf",required=True);ap.add_argument("--db",required=True);ap.add_argument("--session",required=True)
    ap.add_argument("--alias",required=True);ap.add_argument("--out",required=True);ap.add_argument("--seed-pdf",help="earlier bulletin whose DB-confirmed rows seed the alias table");ap.add_argument("--seed-session")
    a=ap.parse_args(argv)
    con=sqlite3.connect(f"file:{a.db}?mode=ro",uri=True)
    rows=parse_pdf(a.pdf)
    al=load_alias(a.alias)
    if a.seed_pdf:
        conf={(p,r):t for p,r,t in con.execute("select pdf_page,pdf_rank,ticker from official_session where session_date=? and ticker is not null",(a.seed_session,))}
        al["aliases"].update(learn_aliases(parse_pdf(a.seed_pdf),conf));save_alias(al,a.alias)
    ident={t:(en,cur) for t,en,cur in con.execute("select ticker,name_en,currency from symbol_identity")}
    prev=prev_closes(con,a.session)
    res,props=resolve(rows,prev,ident,al["aliases"])
    cnt=collections.Counter(r["status"] for r in res)
    json.dump(dict(session=a.session,rows=len(rows),counts=cnt,results=res),open(a.out,"w"),ensure_ascii=False,indent=1)
    print(json.dumps(dict(rows=len(rows),counts=cnt),ensure_ascii=False))
    return 0
if __name__=="__main__":sys.exit(main())
