#!/usr/bin/env python3
"""Frozen-rule walk-forward / out-of-sample replay of the PAPER scenario 'MA20 pullback' (decision_room/egx_decision/paper_scenarios.py).
Rule (NOT fitted, nothing tuned): signal day i if ADV20>=1M EGP, close>MA20>MA50, mom20>0, R=MA20-min(last10 closes) in (0,12%];
limit entry at MA20 valid 5 sessions (fill if low<=MA20, price=min(MA20,open)); stop=min(last10 closes); T1=entry+1.5R; hold<=20 sessions;
gap-through-stop exits at the open. Stop wins ties inside one candle (conservative). Cost = round trip 2*(fee+slippage).
Windows with an unresolved >11.5% close-to-close jump (possible split/corp action in RAW prices) are excluded symmetrically.
Read-only on the DB. usage: walkforward.py --db central.sqlite --out result.json [--oos-start 2024-01-01] [--fee 0.0018 --slip 0.003]
Honest limits: survivorship (only symbols that exist in the DB), RAW closes (no official corp-action adjustment), non-official history for most bars,
overlapping signals (CI by month-cluster bootstrap), broker tariff unverified."""
import argparse,json,math,sqlite3
import numpy as np,pandas as pd
VALID=5;HOLD=20
def wilson(k,n,z=1.96):
    if n==0:return [None,None]
    p=k/n;den=1+z*z/n;ce=(p+z*z/2/n)/den;hw=z*math.sqrt(p*(1-p)/n+z*z/4/n/n)/den;return [round(ce-hw,4),round(ce+hw,4)]
def boot(x,groups,B=2000,seed=1):
    rng=np.random.default_rng(seed);ug=np.unique(groups);idx={g:np.where(groups==g)[0] for g in ug};m=[]
    for _ in range(B):
        s=rng.choice(ug,len(ug));m.append(np.concatenate([x[idx[g]] for g in s]).mean())
    return np.percentile(m,[2.5,97.5])
def load(db):
    con=sqlite3.connect(f"file:{db}?mode=ro",uri=True)
    df=pd.read_sql("select ticker,date,open,high,low,close,volume from canonical_bars where price_basis='RAW' and close>0 order by ticker,date",con)
    df["date"]=pd.to_datetime(df["date"]);return df
def signals(df,start,end,trend_filter=True):
    out=[];s,e=np.datetime64(start),np.datetime64(end)
    for t,g in df.groupby("ticker"):
        o,h,l,c,v=[g[k].values.astype(float) for k in("open","high","low","close","volume")];d=g["date"].values;n=len(c)
        if n<120:continue
        bad=np.r_[False,np.abs(np.diff(c)/c[:-1])>0.115];cb=np.cumsum(bad)
        ma20=pd.Series(c).rolling(20).mean().values;ma50=pd.Series(c).rolling(50).mean().values
        adv=pd.Series(c*np.nan_to_num(v)).rolling(20).mean().values
        for i in range(54,n-VALID-HOLD-2):
            if not(s<=d[i]<=e):continue
            if cb[min(n-1,i+VALID+HOLD+1)]-cb[i-55]>0:continue
            if adv[i]<1e6:continue
            if trend_filter and not(c[i]>ma20[i]>ma50[i] and c[i]/c[i-20]-1>0):continue
            entry=ma20[i];stop=c[i-9:i+1].min();R=entry-stop
            if not(0<R<=0.12*entry):continue
            t1=entry+1.5*R;fill=None
            for j in range(i+1,i+1+VALID):
                if l[j]<=entry:fill=(j,min(entry,o[j]));break
            rec=dict(ticker=t,date=pd.Timestamp(d[i]),filled=fill is not None,res=None,gross=np.nan)
            if fill:
                j0,fp=fill;res=None;ex=None
                for j in range(j0,min(n,j0+HOLD+1)):
                    if o[j]<=stop and j>j0:res="STOP";ex=o[j];break
                    if l[j]<=stop:res="STOP";ex=min(stop,o[j]) if j>j0 else stop;break
                    if h[j]>=t1:res="T1";ex=t1;break
                if res is None:res="TIME";ex=c[min(n-1,j0+HOLD)]
                rec.update(res=res,gross=ex/fp-1)
            out.append(rec)
    return pd.DataFrame(out)
def summarize(r,rt):
    f=r[r.filled] if len(r) else r;n=len(f)
    if n==0:return dict(signals=int(len(r)),filled=0)
    net=(f.gross-rt).values;k=int((f.res=="T1").sum());mon=f.date.dt.to_period("M").astype(str).values
    lo,hi=boot(net,mon) if len(set(mon))>1 else (float("nan"),float("nan"))
    eq=np.cumprod(1+np.sort(net)[::-1]*0+net/ max(1,1)) if False else None
    return dict(signals=int(len(r)),filled=int(n),T1_rate=round(k/n,4),T1_ci95=wilson(k,n),stop_rate=round(float((f.res=="STOP").mean()),4),
        mean_net_pct=round(float(net.mean()*100),3),mean_net_ci95_pct=[round(float(lo*100),3),round(float(hi*100),3)],median_net_pct=round(float(np.median(net)*100),3),
        win_rate_net=round(float((net>0).mean()),4),months=int(len(set(mon))),tickers=int(f.ticker.nunique()))
def main(argv=None):
    ap=argparse.ArgumentParser();ap.add_argument("--db",required=True);ap.add_argument("--out",required=True)
    ap.add_argument("--dev-start",default="2017-01-01");ap.add_argument("--oos-start",default="2024-01-01");ap.add_argument("--end",default="2026-12-31")
    ap.add_argument("--fee",type=float,default=0.0018);ap.add_argument("--slip",type=float,default=0.003);a=ap.parse_args(argv)
    df=load(a.db);rt=2*(a.fee+a.slip);res={"rule":"MA20 pullback (frozen)","round_trip_cost":rt,"db_last_date":str(df.date.max().date())}
    dev_end=str((pd.Timestamp(a.oos_start)-pd.Timedelta(days=1)).date())
    for tf,name in((True,"rule_with_trend_filter"),(False,"baseline_no_trend_filter")):
        r=signals(df,a.dev_start,a.end,tf);r["year"]=r.date.dt.year
        blk={"development":summarize(r[r.date<=dev_end],rt),"out_of_sample":summarize(r[r.date>dev_end],rt),"by_year":{},"cost_sensitivity_oos":{}}
        for y,gy in r.groupby("year"):blk["by_year"][int(y)]=summarize(gy,rt)
        oos=r[r.date>dev_end]
        for lab,x in(("gross_0",0.0),("half",rt/2),("base",rt),("x1.5",rt*1.5)):blk["cost_sensitivity_oos"][lab]=summarize(oos,x)
        res[name]=blk
    json.dump(res,open(a.out,"w"),indent=1,ensure_ascii=False);print(json.dumps({k:res[k]["out_of_sample"] for k in("rule_with_trend_filter","baseline_no_trend_filter")},indent=1));return 0
if __name__=="__main__":raise SystemExit(main())
