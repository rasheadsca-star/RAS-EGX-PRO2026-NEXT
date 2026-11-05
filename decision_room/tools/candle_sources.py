#!/usr/bin/env python3
"""Per-candle source audit (read-only): for each ticker/date in the analysis window list every raw observation (source, provider family, OHLC), the canonical bar and its tier,
conflict rows, the official bulletin close when present and the % gaps. Output CSV + a per-ticker summary of the conflict dates. Nothing is modified.
usage: candle_sources.py --db staged.sqlite --tickers A,B --out-prefix p [--window 51] [--from-date YYYY-MM-DD]"""
import argparse,csv,json,sqlite3,pandas as pd
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k.replace("_","-"),required=True) for k in("db","tickers","out_prefix")];ap.add_argument("--window",type=int,default=51);ap.add_argument("--from-date");a=ap.parse_args(argv)
    con=sqlite3.connect(f"file:{a.db}?mode=ro",uri=True);b=pd.read_sql("select ticker,date from canonical_bars where price_basis='RAW' and close>0",con);cnt=b.groupby("date").ticker.nunique();cal=sorted(cnt[cnt>=50].index)[-a.window:]
    lo=a.from_date or cal[0];rows=[];summ={}
    for t in a.tickers.split(","):
        cb={r[0]:r[1:] for r in con.execute("select date,open,high,low,close,evidence_tier,providers from canonical_bars where ticker=? and price_basis='RAW' and date>=?",(t,lo))}
        ob={};[ob.setdefault(d,[]).append((s,f,o,h,l,c)) for d,s,f,o,h,l,c in con.execute("select date,source_id,provider_family,open,high,low,close from raw_observations where ticker=? and date>=? and valid=1",(t,lo))]
        cf={d:(k,sa,ca_,sb,cb_,p,res) for d,k,sa,ca_,sb,cb_,p,res in con.execute("select date,kind,source_a,close_a,source_b,close_b,pct_diff,resolution from conflicts where ticker=? and date>=?",(t,lo))}
        off={d:c for d,c in con.execute("select date,close from canonical_bars where ticker=? and price_basis='RAW' and evidence_tier='OFFICIAL_EGX' and date>=?",(t,lo))}
        for d in sorted(set(cal)|set(cb)|set(ob)|set(cf)):
            if d<lo:continue
            can=cb.get(d);x=cf.get(d);os_=ob.get(d,[])
            rows.append(dict(ticker=t,date=d,in_window=d in cal,canonical_close=can[3] if can else None,tier=can[4] if can else "MISSING",observations="; ".join(f"{s}[{f}]={c}" for s,f,o,h,l,c in os_),conflict=(f"{x[0]} {x[1]}={x[2]} vs {x[3]}={x[4]} ({x[5]}%) {x[6]}") if x else "",official_close=off.get(d),canonical_vs_official_pct=None if not(can and d in off) else round((can[3]/off[d]-1)*100,3)))
        cd=sorted(d for d in cf if d in cal);summ[t]=dict(conflict_dates_in_window=cd,n=len(cd),kinds=sorted({cf[d][0] for d in cd}),max_abs_pct=max((abs(cf[d][5]) for d in cd),default=None),
            by_pair=sorted({(cf[d][1].split('/')[-1],cf[d][3].split('/')[-1]) for d in cd}))
    w=csv.DictWriter(open(a.out_prefix+".csv","w",newline="",encoding="utf-8"),fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    json.dump(summ,open(a.out_prefix+"_summary.json","w"),indent=1,ensure_ascii=False);print(json.dumps(summ,ensure_ascii=False)[:1800])
if __name__=="__main__":main()
