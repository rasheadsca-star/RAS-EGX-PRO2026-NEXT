#!/usr/bin/env python3
"""Identity audit of legacy-imported official bars (read-only on bars). For every OFFICIAL_EGX bar of the configured tickers whose source is a LEGACY import (selected_source_id
S5_*/S6_*) find the bulletin row (bbox parse in official_session) with the same session and name, and record: OHLC equality, implied previous close vs the ticker's previous close,
name similarity to the ticker and to its look-alike sibling, ISIN status. Writes table identity_review into a NEW db copy; RAW prices and ISIN are never changed.
usage: identity_review.py --src-db a.sqlite --dst-db b.sqlite --config identity_reviews.json [--report r.csv]"""
import argparse,csv,json,os,pathlib,sqlite3,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import official_map as om
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k.replace("_","-"),required=True) for k in("src_db","dst_db","config")];ap.add_argument("--report");a=ap.parse_args(argv)
    if os.path.exists(a.dst_db):sys.exit("dst exists: refusing to overwrite")
    s=sqlite3.connect(f"file:{a.src_db}?mode=ro",uri=True);d=sqlite3.connect(a.dst_db);s.backup(d);s.close()
    d.execute("create table identity_review(ticker,date,bar_source_id,status,bar_close,bulletin_name,pdf_page,pdf_rank,ohlc_equals_bulletin,implied_prev_close,ticker_prev_close,prev_gap_pct,name_sim,sibling_sim,isin,isin_status,note)")
    ident={t:(en,isin,st) for t,en,isin,st in d.execute("select ticker,name_en,isin,isin_status from symbol_identity")};rows=[]
    for rv in json.load(open(a.config))["reviews"]:
        t,sib=rv["ticker"],rv["sibling"]
        for dt,src,o,h,l,c in d.execute("select date,selected_source_id,open,high,low,close from canonical_bars where ticker=? and price_basis='RAW' and evidence_tier='OFFICIAL_EGX' and (selected_source_id like 'S5\\_%' escape '\\' or selected_source_id like 'S6\\_%' escape '\\') order by date",(t,)):
            best=None
            for pg,rk,nm,oo,hh,ll,cc,chg in d.execute("select pdf_page,pdf_rank,name_en,open,high,low,close,chg_pct from official_session where session_date=? and market is null",(dt,)):
                sm=om.sim(nm,ident[t][0])
                if sm>=0.9 and (best is None or sm>best[0]):best=(sm,pg,rk,nm,(oo,hh,ll,cc),chg)
            pc=om.prev_closes(d,dt).get(t)
            if best:
                imp=best[4][3]/(1+best[5]/100);eq=all(abs(x-y)<1e-9 for x,y in zip(best[4],(o,h,l,c)))
                rows.append((t,dt,src,rv["status"],c,best[3],best[1],best[2],int(eq),round(imp,4),pc,None if not pc else round(abs(imp/pc-1)*100,4),round(best[0],2),round(om.sim(best[3],ident[sib][0]),2),ident[t][1],ident[t][2],rv["note"]))
            else:rows.append((t,dt,src,rv["status"],c,None,None,None,None,None,pc,None,None,None,ident[t][1],ident[t][2],rv["note"]+" | NO_BULLETIN_ROW_FOUND"))
    d.executemany("insert into identity_review values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",rows);d.commit();ok=d.execute("pragma integrity_check").fetchone()[0];d.close()
    if a.report:
        w=csv.writer(open(a.report,"w",newline="",encoding="utf-8"));w.writerow(["ticker","date","bar_source_id","status","bar_close","bulletin_name","pdf_page","pdf_rank","ohlc_equals_bulletin","implied_prev_close","ticker_prev_close","prev_gap_pct","name_sim","sibling_sim","isin","isin_status","note"]);w.writerows(rows)
    print(json.dumps(dict(integrity=ok,rows=len(rows),all_ohlc_equal=all(r[8]==1 for r in rows),max_prev_gap_pct=max([r[11] for r in rows if r[11] is not None],default=None))))
if __name__=="__main__":main()
