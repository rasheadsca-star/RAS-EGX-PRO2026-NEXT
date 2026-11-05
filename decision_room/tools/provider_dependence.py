#!/usr/bin/env python3
"""Document how much of the staged DB (and of each qualified stock's indicator windows) rests on a single provider. Read-only.
usage: provider_dependence.py --db staged.sqlite --ranking ranking.json --out dependence.json"""
import argparse,json,sqlite3,pandas as pd
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("db","ranking","out")];a=ap.parse_args(argv)
    con=sqlite3.connect(f"file:{a.db}?mode=ro",uri=True);b=pd.read_sql("select ticker,date,evidence_tier from canonical_bars where price_basis='RAW' and close>0",con)
    tot=b.evidence_tier.value_counts().to_dict();n=len(b);out=dict(raw_bars=n,tiers=tot,tier_pct={k:round(v/n*100,2) for k,v in tot.items()})
    last=sorted(b.date.unique())[-250:];b250=b[b.date.isin(last)];out["last_250_sessions_tier_pct"]={k:round(v/len(b250)*100,2) for k,v in b250.evidence_tier.value_counts().items()}
    rk=json.load(open(a.ranking));per=[]
    for r in rk:
        g=b[b.ticker==r["ticker"]].sort_values("date")
        for w in(20,50):
            x=g.tail(w).evidence_tier.value_counts()
            r[f"w{w}"]={k:int(v) for k,v in x.items()}
        per.append(dict(ticker=r["ticker"],list=r["list"],window20=r["w20"],window50=r["w50"],single_provider_pct_ma50=round(r["w50"].get("SINGLE_PROVIDER",0)/max(1,sum(r["w50"].values()))*100,1),official_pct_ma50=round(r["w50"].get("OFFICIAL_EGX",0)/max(1,sum(r["w50"].values()))*100,1)))
    out["qualified"]=per
    out["interpretation"]="Whole DB: single-provider bars dominate (see tier_pct). The qualified stocks are the exception only because the CONFLICT/CALENDAR gates select symbols whose recent window is corroborated by 2 providers; their last <=5 sessions are official; remaining bars are single-provider hole-fills. Gates test internal consistency across sources, not truth: indicators stay research-only."
    json.dump(out,open(a.out,"w"),indent=1,ensure_ascii=False);print(json.dumps(out["tier_pct"]),[ (p["ticker"],p["single_provider_pct_ma50"],p["official_pct_ma50"]) for p in per])
if __name__=="__main__":main()
