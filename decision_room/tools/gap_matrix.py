#!/usr/bin/env python3
"""Per-session coverage of the last N confirmed sessions by evidence tier + holes + open conflicts + corporate events (read-only), and a per-ticker list of the holes
with the reason each could not be filled (no candidate / provider disagreement / rejected). Nothing is estimated or interpolated.
usage: gap_matrix.py --db staged.sqlite --out-prefix p [--window 51]"""
import argparse,csv,json,sqlite3,pandas as pd
def main(argv=None):
    ap=argparse.ArgumentParser();ap.add_argument("--db",required=True);ap.add_argument("--out-prefix",required=True);ap.add_argument("--window",type=int,default=51);a=ap.parse_args(argv)
    con=sqlite3.connect(f"file:{a.db}?mode=ro",uri=True);b=pd.read_sql("select ticker,date,evidence_tier from canonical_bars where price_basis='RAW' and close>0",con)
    cnt=b.groupby("date").ticker.nunique();cal=sorted(cnt[cnt>=50].index)[-a.window:];universe=sorted(b[b.date.isin(cal)].ticker.unique())
    conf=pd.read_sql("select ticker,date,kind,resolution from conflicts",con);ca=pd.read_sql("select ticker,date from corporate_actions where date>=?",con,params=(cal[0],))
    ev=pd.read_sql("select session,kind,ticker,name from official_corporate_events",con)
    rows=[];holes=[]
    have={(r.ticker,r.date):r.evidence_tier for r in b[b.date.isin(cal)].itertuples()}
    cset={(r.ticker,r.date):r.kind for r in conf.itertuples()}
    for d in cal:
        tiers=pd.Series([have.get((t,d),"MISSING") for t in universe]).value_counts().to_dict()
        rows.append(dict(date=d,universe=len(universe),**{k:int(tiers.get(k,0)) for k in("OFFICIAL_EGX","CORROBORATED_2_PROVIDERS","SINGLE_PROVIDER","MISSING")},open_conflicts_on_date=int(sum(1 for t in universe if (t,d) in cset)),events=int((ev.session==d).sum())))
        for t in universe:
            if (t,d) not in have:holes.append(dict(ticker=t,date=d,reason=("PROVIDER_DISAGREEMENT/CONFLICT row: "+cset[(t,d)]) if (t,d) in cset else "NO_SOURCE_CANDIDATE_OR_NOT_TRADED"))
    w=csv.DictWriter(open(a.out_prefix+"_by_session.csv","w",newline=""),fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    w=csv.DictWriter(open(a.out_prefix+"_holes.csv","w",newline=""),fieldnames=["ticker","date","reason"]);w.writeheader();w.writerows(holes)
    s=dict(window=f"{cal[0]}..{cal[-1]}",sessions=len(cal),universe=len(universe),holes=len(holes),holes_22_29_oct=sum(1 for h in holes if "2026-10-22"<=h["date"]<="2026-10-29"),holes_with_conflict_row=sum(1 for h in holes if h["reason"].startswith("PROVIDER")))
    json.dump(s,open(a.out_prefix+"_summary.json","w"),indent=1);print(json.dumps(s))
if __name__=="__main__":main()
