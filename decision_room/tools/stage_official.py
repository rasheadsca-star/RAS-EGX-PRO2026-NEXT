#!/usr/bin/env python3
"""Stage ONE official bulletin session into a NEW copy of the central DB (never in place; refuses if dst exists).
Only rows resolved as RESOLVED_ALIAS_PREVCLOSE (alias name + previous close within 0.7%) AND sane (low>0, high>=low, low<=close<=high; the
auction 'open' is NOT range-checked) are inserted as OFFICIAL_EGX; everything else is recorded in official_session with its quarantine status.
A ticker that already has a RAW bar for that date is never overwritten (a disagreement >0.1% is reported, not applied).
usage: stage_official.py --src-db a.sqlite --dst-db b.sqlite --pdf f.pdf --session YYYY-MM-DD --alias alias.json --report r.json"""
import argparse,collections,hashlib,json,os,pathlib,shutil,sqlite3,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import official_map as om
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("src-db","dst-db","pdf","session","alias","report")];a=ap.parse_args(argv)
    if os.path.exists(a.dst_db):sys.exit("dst exists: refusing to overwrite")
    src=sqlite3.connect(f"file:{a.src_db}?mode=ro",uri=True);dst=sqlite3.connect(a.dst_db);src.backup(dst);src.close()
    sha=hashlib.sha256(open(a.pdf,"rb").read()).hexdigest();sid="S7_EGX_OFFICIAL_"+a.session.replace("-","")
    rows=om.parse_pdf(a.pdf);byk={(r["page"],r["rank"]):r for r in rows}
    ident={t:(en,cur) for t,en,cur in dst.execute("select ticker,name_en,currency from symbol_identity")}
    prev=om.prev_closes(dst,a.session)
    have={t:c for t,c in dst.execute("select ticker,close from canonical_bars where price_basis='RAW' and date=?",(a.session,))}
    res,props=om.resolve(rows,prev,ident,om.load_alias(a.alias)["aliases"])
    dst.execute("insert or ignore into source_registry(source_id,provider_family,description,location,snapshot_ref,file_sha256,license_status,adjusted_or_raw,interval,currency,date_timezone,independence_note) values(?,?,?,?,?,?,?,?,?,?,?,?)",(sid,"egx_official","EGX official daily bulletin "+a.session,os.path.basename(a.pdf),a.session,sha,"official EGX report","RAW","1d","EGP/USD","Africa/Cairo","name alias + previous close; no ISIN in equity table"))
    cnt=collections.Counter();disagree=[]
    for x in res:
        r=byk[(x["page"],x["rank"])];st=x["status"]
        if st=="RESOLVED_ALIAS_PREVCLOSE":
            if not(r["low"]>0 and r["high"]>=r["low"] and r["low"]<=r["close"]<=r["high"]):st="QUARANTINED_PRICE_BOUNDS"
            elif x["ticker"] in have:
                st="ALREADY_HAS_BAR"
                if abs(have[x["ticker"]]/r["close"]-1)>0.001:disagree.append((x["ticker"],have[x["ticker"]],r["close"]))
        cnt[st]+=1
        dst.execute("insert into official_session(session_date,market,pdf_page,pdf_rank,name_en,currency,open,high,low,close,volume,value,chg_pct,ticker,resolution_status,resolution_evidence,bounds_status) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(a.session,None,r["page"],r["rank"],r["name"],r["cur"],r["open"],r["high"],r["low"],r["close"],r["volume"],r["value"],r["chg_pct"],x["ticker"] if st in("RESOLVED_ALIAS_PREVCLOSE","ALREADY_HAS_BAR") else None,st,x["evidence"],"OK" if st!="QUARANTINED_PRICE_BOUNDS" else "BOUNDS"))
        if st=="RESOLVED_ALIAS_PREVCLOSE":
            t=x["ticker"]
            dst.execute("insert into raw_observations(ticker,date,source_id,provider_family,open,high,low,close,adj_close,volume,currency,declared_basis,valid,invalid_reason,source_path,row_ref,official_verified) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(t,a.session,sid,"egx_official",r["open"],r["high"],r["low"],r["close"],None,r["volume"],"EGP","RAW",1,None,os.path.basename(a.pdf),f"p{r['page']}:rank{r['rank']}:sha256:{sha[:16]}",1))
            dst.execute("insert into canonical_bars(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes) values(?,?,?,?,?,?,?,?,?,?,?,?,?)",(t,a.session,"RAW",r["open"],r["high"],r["low"],r["close"],r["volume"],"OFFICIAL_EGX","egx_official",sid,1,"Official bulletin; alias name + prev close; open = auction price"))
    dst.commit();ok=dst.execute("pragma integrity_check").fetchone()[0];dst.close()
    rep=dict(session=a.session,pdf_sha256=sha,rows=len(rows),statuses=cnt,integrity=ok,proposals=[(p["page"],p["rank"],p["name"],p["ticker"],p["evidence"]) for p in props],disagree_with_existing_bar=disagree)
    json.dump(rep,open(a.report,"w"),ensure_ascii=False,indent=1);print(json.dumps(dict(session=a.session,rows=len(rows),statuses=cnt,integrity=ok,disagree=len(disagree)),ensure_ascii=False))
if __name__=="__main__":main()
