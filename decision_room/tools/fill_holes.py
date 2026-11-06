#!/usr/bin/env python3
"""Fill HOLES (missing ticker/date RAW bars) inside the last N confirmed sessions of a STAGED DB from documented non-official sources.
Never replaces an existing bar (official or not). Candidates: (a) main-branch data/history/*.json (Mubasher or Yahoo, per row primarySource),
(b) the append-only free-source ledger (Yahoo chart, status QUARANTINED upstream).
 * two INDEPENDENT provider families that agree on close within 0.3%  -> CORROBORATED_2_PROVIDERS (Yahoo OHLCV kept)
 * one provider only                                                  -> SINGLE_PROVIDER
 * two providers that disagree >0.3%                                  -> NO canonical bar; a `conflicts` row (PROVIDER_DISAGREEMENT) is written (fail-closed)
Every candidate is stored in raw_observations. Rows failing ingest_daily.validate_row are rejected (counted).
usage: fill_holes.py --src-db staged.sqlite --dst-db filled.sqlite --mainhist dir --ledger fse.sqlite --report r.json [--window 51]"""
import argparse,collections,glob,json,os,pathlib,sqlite3,sys,datetime
import pandas as pd
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import ingest_daily as I
TOL=0.003
def fam(p):return "mubasher" if str(p).lower().startswith("mubasher") else "yahoo"
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("src-db","dst-db","mainhist","ledger","report")];ap.add_argument("--window",type=int,default=51);a=ap.parse_args(argv)
    if os.path.exists(a.dst_db):sys.exit("dst exists")
    src=sqlite3.connect(f"file:{a.src_db}?mode=ro",uri=True);dst=sqlite3.connect(a.dst_db);src.backup(dst);src.close()
    b=pd.read_sql("select ticker,date from canonical_bars where price_basis='RAW' and close>0",dst);cnt=b.groupby("date").ticker.nunique();cal=sorted(cnt[cnt>=50].index)[-a.window:]
    have=b.groupby("ticker").date.apply(set);today=datetime.date.fromisoformat(cal[-1])
    cand=collections.defaultdict(dict)   # (t,d)-> {family: row}
    for f in glob.glob(a.mainhist+"/*.json"):
        d=json.load(open(f));t=d["ticker"]
        for s in d["sessions"]:
            if s["date"] in cal and s["date"] not in have.get(t,set()):
                s=dict(s);s["_src"]="S8_MAIN_HISTORY_20261104";cand[(t,s["date"])][fam(s.get("primarySource"))]=s
    led=sqlite3.connect(f"file:{a.ledger}?mode=ro",uri=True)
    for sym,sess,o,h,l,c,v in led.execute("select symbol,session,open,high,low,close,volume from observations"):
        t=sym.replace(".CA","")
        if sess in cal and sess not in have.get(t,set()):cand[(t,sess)].setdefault("yahoo",dict(date=sess,open=o,high=h,low=l,close=c,volume=v,ticker=t,currency="EGP",_src="S9_YAHOO_FREE_SOURCE_LEDGER"))
    for sid,desc in(("S8_MAIN_HISTORY_20261104","main-branch data/history snapshot 2026-11-04 (Mubasher/Yahoo per row)"),("S9_YAHOO_FREE_SOURCE_LEDGER","egx-research-ledger free_source_evidence.sqlite (Yahoo chart)")):
        dst.execute("insert or ignore into source_registry(source_id,provider_family,description,location,snapshot_ref,file_sha256,license_status,adjusted_or_raw,interval,currency,date_timezone,independence_note) values(?,?,?,?,?,?,?,?,?,?,?,?)",(sid,"mixed" if sid.startswith("S8") else "yahoo",desc,"github",a.mainhist if sid.startswith("S8") else a.ledger,None,"unverified","RAW","1d","EGP","Africa/Cairo","non-official; hole-fill only"))
    ident={t for (t,) in dst.execute("select ticker from symbol_identity")}
    rep=collections.Counter();bydate=collections.defaultdict(collections.Counter);rej=collections.Counter()
    for (t,d),fm in sorted(cand.items()):
        if t not in ident:rep["unknown_ticker"]+=1;continue
        ok={}
        for k,s in fm.items():
            why=I.validate_row(dict(s,ticker=t),t,today) if s.get("sourceSessionDate") in(None,d) else "SESSION_DATE_MISMATCH"
            if why:rej[why]+=1;continue
            ok[k]=s
            dst.execute("insert into raw_observations(ticker,date,source_id,provider_family,open,high,low,close,adj_close,volume,currency,declared_basis,valid,invalid_reason,source_path,row_ref,official_verified) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(t,d,s["_src"],k,s["open"],s["high"],s["low"],s["close"],None,s["volume"],"EGP","RAW",1,None,s["_src"],"hole-fill",0))
        if not ok:rep["no_valid_candidate"]+=1;continue
        if len(ok)==2:
            m,y=ok["mubasher"],ok["yahoo"]
            if abs(m["close"]/y["close"]-1)<=TOL:tier,row,prov="CORROBORATED_2_PROVIDERS",y,"mubasher,yahoo"
            else:
                if not dst.execute("select 1 from conflicts where ticker=? and date=?",(t,d)).fetchone():
                    dst.execute("insert into conflicts(ticker,date,kind,source_a,close_a,source_b,close_b,pct_diff,resolution) values(?,?,?,?,?,?,?,?,?)",(t,d,"PROVIDER_DISAGREEMENT","mubasher",m["close"],"yahoo",y["close"],round((m["close"]/y["close"]-1)*100,3),"OPEN"));rep["conflict_row_added"]+=1
                else:rep["conflict_already_recorded"]+=1
                rep["conflict_unfilled"]+=1;bydate[d]["conflict"]+=1;continue
        else:
            (k,row),=ok.items();tier,prov="SINGLE_PROVIDER",k
        dst.execute("insert into canonical_bars(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes) values(?,?,?,?,?,?,?,?,?,?,?,?,?)",(t,d,"RAW",row["open"],row["high"],row["low"],row["close"],row["volume"],tier,prov,row["_src"],len(ok),"hole-fill (non-official); never replaces an existing bar"))
        rep["filled_"+tier]+=1;bydate[d][tier]+=1
    dst.commit();ok_=dst.execute("pragma integrity_check").fetchone()[0];dst.close()
    out=dict(window=cal[0]+".."+cal[-1],integrity=ok_,summary=rep,rejected=rej,by_date={d:dict(v) for d,v in sorted(bydate.items())})
    json.dump(out,open(a.report,"w"),ensure_ascii=False,indent=1);print(json.dumps(dict(integrity=ok_,summary=rep,rejected=rej),ensure_ascii=False))
if __name__=="__main__":main()
