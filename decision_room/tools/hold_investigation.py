#!/usr/bin/env python3
"""Evidence sheet for proposals that stay on HOLD (nothing applied): per session bulletin row vs the ticker's previous close, prior-bar tier, public close, registry name/ISIN status,
cross-check against the 'sibling' ticker (e.g. MTIE vs MMAT) and corporate events. usage: hold_investigation.py --db baseline.sqlite --reports dir --mainhist dir --tickers MTIE,PHAR,... --out-prefix p"""
import argparse,csv,glob,json,pathlib,sqlite3,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import official_map as om
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k.replace("_","-"),required=True) for k in("db","reports","mainhist","tickers","out_prefix")];a=ap.parse_args(argv);T=set(a.tickers.split(","))
    con=sqlite3.connect(f"file:{a.db}?mode=ro",uri=True);ident={t:(en,isin,st) for t,en,isin,st in con.execute("select ticker,name_en,isin,isin_status from symbol_identity")}
    ev={};[ev.setdefault(t,[]).append((s,k)) for s,k,t in con.execute("select session,kind,ticker from official_corporate_events where ticker is not null")]
    rows=[]
    for f in sorted(glob.glob(a.reports+"/stage_*.json")):
        r=json.load(open(f));ses=r["session"];pc=om.prev_closes(con,ses)
        try:pub={s["date"]:s["close"] for s in json.load(open(f"{a.mainhist}/X.json".replace("X","%s")))["sessions"]}
        except Exception:pub={}
        for page,rank,name,tk,_ in r["proposals"]:
            if tk not in T:continue
            o=con.execute("select close,chg_pct from official_session where session_date=? and pdf_page=? and pdf_rank=? and market is null",(ses,page,rank)).fetchone()
            if not o:continue
            try:ph={s["date"]:s["close"] for s in json.load(open(f"{a.mainhist}/{tk}.json"))["sessions"]}.get(ses)
            except Exception:ph=None
            imp=o[0]/(1+o[1]/100);pv=pc.get(tk);tier=con.execute("select evidence_tier,date from canonical_bars where ticker=? and price_basis='RAW' and date<? order by date desc limit 1",(tk,ses)).fetchone()
            sib={t2:round(om.sim(name,ident[t2][0]),2) for t2 in T if t2!=tk and t2 in ident}
            rows.append(dict(ticker=tk,session=ses,bulletin_name=name,registry_name=ident[tk][0],isin=ident[tk][1],isin_status=ident[tk][2],bulletin_close=o[0],implied_prev_close=round(imp,4),ticker_prev_close=pv,prev_close_date=tier[1] if tier else None,prior_bar_tier=tier[0] if tier else None,prev_gap_egp=None if pv is None else round(abs(imp-pv),4),prev_gap_pct=None if pv is None else round(abs(imp/pv-1)*100,3),public_close_same_day=ph,public_vs_bulletin_pct=None if not ph else round((ph/o[0]-1)*100,3),sim_to_other_held_tickers=json.dumps(sib),corporate_events=json.dumps(ev.get(tk,[])),applied="NO"))
    if rows:
        w=csv.DictWriter(open(a.out_prefix+".csv","w",newline="",encoding="utf-8"),fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    print(len(rows),"rows")
if __name__=="__main__":main()
