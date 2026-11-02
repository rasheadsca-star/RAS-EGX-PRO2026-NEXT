#!/usr/bin/env python3
"""Conservative EGX official company-name resolver. Research-only; no DB writes."""
import argparse, collections, difflib, hashlib, json, math, re, sqlite3
from pathlib import Path

STOP=frozenset("s a e sae company co for and the of egypt egyptian el al holding group in industries investment development".split())
def norm(s):
    s=re.sub(r"\(.*?\)"," ",(s or "").casefold())
    s=re.sub(r"[^a-z0-9]+"," ",s)
    return " ".join(w for w in s.split() if w not in STOP)
def similarity(a,b):
    a,b=norm(a),norm(b)
    if not a or not b:return 0.
    x,y=set(a.split()),set(b.split())
    return max(difflib.SequenceMatcher(None,a,b).ratio(),len(x&y)/max(1,len(x|y)))
def load_reference(db,previous_session):
    c=sqlite3.connect("file:"+str(Path(db).resolve())+"?mode=ro",uri=True)
    try:
        previous={t:float(close) for t,close in c.execute(
            "select ticker,close from canonical_bars where date=? and price_basis='RAW'",(previous_session,))}
        names=collections.defaultdict(list);currencies={}
        for t,en,cur in c.execute("select ticker,name_en,currency from symbol_identity"):
            if en:names[t].append(en)
            currencies[t]=cur
        for name,t in c.execute("select name_en,ticker from official_session where session_date=? and ticker is not null",(previous_session,)):
            if name and t in currencies:names[t].append(name)
        # Persisted aliases are only reusable after an independent approval.
        # PROVISIONAL alias rows are NEVER accepted as mapping authority.
        has_alias=c.execute("select 1 from sqlite_master where type='table' and name='official_alias_registry'").fetchone()
        if has_alias:
            for alias,t in c.execute("select alias_normalized,ticker from official_alias_registry where status='VERIFIED'"):
                if t in currencies and alias:names[t].append(alias)
        return previous,names,currencies
    finally:c.close()
def is_ohlc_ok(row):
    try:
        o,h,l,c,v=(float(row[k]) for k in ("open","high","low","close","volume"))
        return all(math.isfinite(x) for x in (o,h,l,c,v)) and min(o,h,l,c)>0 and v>=0 and l<=min(o,c) and max(o,c)<=h
    except (ValueError,TypeError,KeyError):return False
def resolve(items,db,previous_session,source_sha256=None):
    previous,names,currencies=load_reference(db,previous_session)
    results=[];tentative=collections.defaultdict(list)
    for ix,row in enumerate(items):
        r={k:row.get(k) for k in ("page","rank","market","name","currency","open","high","low","close","chg_pct","volume","trades","value_traded")}
        r.update(row_index=ix,ticker=None,evidence={})
        if r["currency"]!="EGP":
            r["resolution_status"]="QUARANTINED_NON_EGP";results.append(r);continue
        if row.get("status")=="CHECK" or not is_ohlc_ok(row):
            r["resolution_status"]="QUARANTINED_OHLC";results.append(r);continue
        try:
            implied=float(row["close"])/(1+float(row["chg_pct"])/100)
            if not math.isfinite(implied) or implied<=0:raise ValueError("invalid prior close")
        except (ValueError,TypeError,ZeroDivisionError):
            r["resolution_status"]="QUARANTINED_INVALID_PREVIOUS_CLOSE";results.append(r);continue
        candidates=[]
        for t,close in previous.items():
            if currencies.get(t)!="EGP" or close<=0:continue
            delta=abs(implied/close-1)
            if delta>0.007:continue
            score=max((similarity(row["name"],n) for n in names[t]),default=0)
            if score>=0.58:candidates.append((score,delta,t))
        candidates.sort(key=lambda z:(-z[0],z[1],z[2]))
        r["evidence"]={"top":[{"ticker":t,"name_similarity":round(s,6),"prior_close_relative_error":round(d,8)} for s,d,t in candidates[:2]],"previous_session":previous_session}
        if not candidates or candidates[0][0]<0.74 or (len(candidates)>1 and candidates[0][0]-candidates[1][0]<0.09):
            r["resolution_status"]="QUARANTINED_NAME_OR_AMBIGUITY"
        else:
            r["ticker"]=candidates[0][2]
            r["resolution_status"]="PROVISIONAL_NAME_PREVCLOSE"
            tentative[r["ticker"]].append(ix)
        results.append(r)
    for t,ids in tentative.items():
        if len(ids)>1:
            for ix in ids:
                results[ix]["ticker"]=None
                results[ix]["resolution_status"]="QUARANTINED_DUPLICATE_TICKER"
    summary=dict(source_rows=len(results),provisional=sum(bool(r["ticker"]) for r in results),
        by_status=dict(sorted(collections.Counter(r["resolution_status"] for r in results).items())),
        source_sha256=source_sha256,previous_session=previous_session,output_for_trading=False,
        mapping_verification="PROVISIONAL_REQUIRES_APPROVAL")
    return {"summary":summary,"items":results}
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",required=True);p.add_argument("--db",required=True)
    p.add_argument("--previous-session",required=True);p.add_argument("--out",required=True)
    a=p.parse_args();raw=Path(a.input).read_bytes();j=json.loads(raw)
    items=j["items"] if isinstance(j,dict) else j
    r=resolve(items,a.db,a.previous_session,j.get("pdf_sha256") if isinstance(j,dict) else hashlib.sha256(raw).hexdigest())
    out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(r["summary"],ensure_ascii=False))
if __name__=="__main__":main()
