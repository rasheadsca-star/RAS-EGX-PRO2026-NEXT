#!/usr/bin/env python3
"""Pre-registered strategy test (see config/strategy_preregistration_2026-11-05.json): select on development, evaluate ONCE on the holdout, with fees, slippage,
liquidity impact and a participation cap. Read-only on the DB. usage: strategy_holdout.py --db staged.sqlite --prereg p.json --out result.json"""
import argparse,hashlib,json,sqlite3,sys,pathlib
import numpy as np,pandas as pd
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import walkforward as W
SIZE=250000.0;CAP=0.05
def rows_A(df,s,e):
    out=[]
    for t,g in df.groupby("ticker"):
        o,h,l,c,v=[g[k].values.astype(float) for k in("open","high","low","close","volume")];d=g["date"].values;n=len(c)
        if n<130:continue
        bad=np.r_[False,np.abs(np.diff(c)/c[:-1])>0.115];cb=np.cumsum(bad);ma50=pd.Series(c).rolling(50).mean().values;adv=pd.Series(c*np.nan_to_num(v)).rolling(20).mean().values
        hh=pd.Series(h).rolling(55).max().shift(1).values;ll=pd.Series(l).rolling(20).min().shift(1).values;i=60
        while i<n-2:
            if np.datetime64(s)<=d[i]<=np.datetime64(e) and c[i]>hh[i] and c[i]>ma50[i] and adv[i]>=1e6:
                j0=i+1;end=min(n-1,j0+60)
                if cb[end]-cb[i-56]>0:i+=1;continue
                ex=end
                for j in range(j0+1,end+1):
                    if c[j]<ll[j]:ex=j;break
                if cb[ex]-cb[i-56]==0:out.append(dict(ticker=t,date=pd.Timestamp(d[i]),gross=c[ex]/c[j0]-1,adv=adv[i],hold=ex-j0))
                i=ex
            else:i+=1
    return pd.DataFrame(out)
def rows_B(df,s,e):
    P={};ADV={};D=None
    piv=df.pivot(index="date",columns="ticker",values="close");vol=df.pivot(index="date",columns="ticker",values="volume").reindex(piv.index)
    adv=(piv*vol.fillna(0)).rolling(20).mean();ret=piv.shift(5)/piv.shift(68)-1;dates=piv.index;out=[]
    jump=(piv.pct_change(fill_method=None).abs()>0.115)
    me=[dates[k] for k in range(len(dates)-1) if dates[k].month!=dates[k+1].month]
    for d in me:
        if not(pd.Timestamp(s)<=d<=pd.Timestamp(e)):continue
        i=dates.get_loc(d)
        if i+22>=len(dates):continue
        el=(adv.iloc[i]>=1e6)&ret.iloc[i].notna();cand=ret.iloc[i][el]
        if len(cand)<30:continue
        top=cand[cand>=cand.quantile(0.9)].index
        for t in top:
            seg=jump[t].iloc[max(0,i-68):i+23]
            if seg.any():continue
            p0=piv[t].iloc[i+1];p1=piv[t].iloc[i+22]
            if p0==p0 and p1==p1 and p0>0:out.append(dict(ticker=t,date=d,gross=p1/p0-1,adv=adv[t].iloc[i],hold=21))
    return pd.DataFrame(out)
def rows_C(df,s,e):
    r=W.signals(df,s,e,True);r=r[r.filled].copy()
    if len(r)==0:return r
    d2=df.sort_values(["ticker","date"]).copy();d2["adv"]=(d2.close*d2.volume.fillna(0)).groupby(d2.ticker).transform(lambda x:x.rolling(20).mean())
    r=r.merge(d2[["ticker","date","adv"]],on=["ticker","date"],how="left");r["hold"]=10;return r[["ticker","date","gross","adv","hold"]]
def cost(r,mult,fee=0.0018,slip=0.003):
    p=SIZE/r.adv.values;ok=(p<=CAP)&np.isfinite(p)
    return ok,2*(fee+slip)+2*0.25*p*(mult if mult else 0) if False else 2*(fee+slip)+2*0.25*p
def summarize(r,mult=1.0):
    if len(r)==0:return dict(n=0)
    ok,_=cost(r,1);r=r[ok];
    if len(r)==0:return dict(n=0,capacity_filtered=True)
    p=SIZE/r.adv.values;rt=(2*(0.0018+0.003)+2*0.25*p)*mult if mult>0 else np.zeros(len(r))
    net=(r.gross.values-rt);mon=r.date.dt.to_period("M").astype(str).values;lo,hi=W.boot(net,mon) if len(set(mon))>1 else (np.nan,np.nan)
    half=r.date.dt.year.astype(str)+"H"+((r.date.dt.month>6)+1).astype(str)
    hb={k:round(float(net[(half==k).values].mean()*100),3) for k in sorted(set(half))}
    pf=float(net[net>0].sum()/-net[net<0].sum()) if (net<0).any() else None
    return dict(n=int(len(r)),skipped_over_cap=int(ok.size-ok.sum()) if False else None,mean_net_pct=round(float(net.mean()*100),3),ci95_pct=[round(float(lo*100),3),round(float(hi*100),3)],median_net_pct=round(float(np.median(net)*100),3),win_rate=round(float((net>0).mean()),4),profit_factor=None if pf is None else round(pf,3),mean_gross_pct=round(float(r.gross.mean()*100),3),mean_cost_pct=round(float(rt.mean()*100),3),mean_participation_pct=round(float(p.mean()*100),3),half_year_mean_net_pct=hb,tickers=int(r.ticker.nunique()),months=int(len(set(mon))))
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("db","prereg","out")];a=ap.parse_args(argv)
    pre=json.load(open(a.prereg));psha=hashlib.sha256(open(a.prereg,"rb").read()).hexdigest();df=W.load(a.db);dv=pre["periods"]["development"];ho=pre["periods"]["holdout"]
    fn={"A_breakout55":rows_A,"B_xsmom63":rows_B,"C_ma20_pullback":rows_C};res=dict(prereg_sha256=psha,db_last_date=str(df.date.max().date()),development={},holdout={},sensitivity_holdout={})
    dev={k:f(df,*dv) for k,f in fn.items()};hol={k:f(df,*ho) for k,f in fn.items()}
    for k in fn:res["development"][k]=summarize(dev[k])
    ok=[k for k in fn if res["development"][k].get("n",0)>=200 and res["development"][k]["mean_net_pct"]>0 and res["development"][k]["ci95_pct"][0]>0]
    sel=max(ok,key=lambda k:res["development"][k]["ci95_pct"][0]) if ok else None;res["selected_on_development"]=sel
    for k in fn:res["holdout"][k]=summarize(hol[k])      # all reported for transparency; ONLY the selected one can pass
    if sel:
        for m in(0,1,2):res["sensitivity_holdout"][f"{sel}_cost_x{m}"]=summarize(hol[sel],m)
        h=res["holdout"][sel];hb=list(h.get("half_year_mean_net_pct",{}).values())
        res["holdout_pass"]=bool(h.get("n",0)>=200 and h["mean_net_pct"]>0 and h["ci95_pct"][0]>0 and sum(1 for x in hb if x>0)>=3)
    else:res["holdout_pass"]=False;res["reason"]="no candidate met the development selection rule -> NO strategy selected; holdout numbers are informational only"
    res["decision"]="STRATEGY_PASSED_HOLDOUT (still research: needs independent validation)" if res["holdout_pass"] else "NO_STRATEGY_APPROVED"
    res["caveats"]=["RAW prices (no adjusted series); windows with >11.5% moves excluded","bars mostly single-provider, non-official","survivorship: only symbols present in the DB","overlapping trades -> month-cluster bootstrap","impact model is an assumption (0.25 x participation per side), broker tariff unverified"]
    json.dump(res,open(a.out,"w"),indent=1,ensure_ascii=False);print(json.dumps({k:res[k] for k in("selected_on_development","holdout_pass","decision")}));return 0
if __name__=="__main__":sys.exit(main())
