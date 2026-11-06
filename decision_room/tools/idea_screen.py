#!/usr/bin/env python3
"""Pre-registered idea screen (config/idea_screen_prereg_2026-11-06.json). Read-only. usage: idea_screen.py --db x.sqlite --prereg p.json --out r.json"""
import argparse,hashlib,json,sqlite3
import numpy as np,pandas as pd
COST=0.0096;ALPHA=0.05/6
def load(db):
    c=sqlite3.connect("file:"+db+"?mode=ro",uri=True)
    df=pd.read_sql("select ticker,date,close,volume from canonical_bars where price_basis='RAW' and close>0",c,parse_dates=["date"]);c.close()
    cl=df.pivot(index="date",columns="ticker",values="close").sort_index();vo=df.pivot(index="date",columns="ticker",values="volume").reindex(cl.index).fillna(0);return cl,vo
def features(cl,vo):
    ret=cl.pct_change(fill_method=None);adv=(cl*vo).rolling(20).mean()
    jl=(ret.abs()>0.115).rolling(252,min_periods=1).max().shift(1).fillna(0)>0   # up to t-1
    elig=(adv>=5e6)&cl.notna()&~jl
    vavg=vo.rolling(20).mean().shift(1)
    d=pd.Series(0.0,index=cl.index)
    ch=cl.diff();g=ch.clip(lower=0).rolling(5).mean();l=(-ch.clip(upper=0)).rolling(5).mean();rsi=100-100/(1+g/l.replace(0,np.nan))
    sig={}
    sig["I1"]=(elig&(ret>=0.09)&(ret<=0.115)&(vo>=2*vavg),5)
    sig["I2"]=(elig&(ret<=-0.09)&(ret>=-0.115)&(vo>=2*vavg),5)
    sig["I3"]=(elig&(cl>cl.rolling(20).max().shift(1))&(vo>=3*vavg)&(ret>0),10)
    sig["I6"]=(elig&(rsi<15)&(cl>cl.rolling(200).mean()),5)
    sig["I7"]=(elig&((adv/adv.rolling(40).mean().shift(21))>=2)&(cl>cl.rolling(50).mean()),10)
    return ret,elig,sig
def fwd(cl,H):return cl.shift(-(1+H))/cl.shift(-1)-1
def boot_lb(x,m,B=20000,seed=20261106,q=ALPHA):
    rng=np.random.default_rng(seed);s=pd.Series(x).groupby(m).apply(np.array);keys=list(s.index);vals=np.empty(B)
    for i in range(B):vals[i]=np.concatenate([s[k] for k in rng.choice(len(keys),len(keys))]) .mean() if False else np.concatenate([s.iloc[j] for j in rng.integers(0,len(keys),len(keys))]).mean()
    return float(np.quantile(vals,q))
def event_stats(cl,elig,mask,H,s,e):
    f=fwd(cl,H);f=f.where(f.abs()<=0.6);bm=f.where(elig).mean(axis=1)
    rows=[];dates=cl.index
    for t in cl.columns:
        m=mask[t].values;i=np.where(m)[0];last=-99
        for k in i:
            if not(s<=dates[k]<=e) or k-last<H:continue
            last=k;r=f[t].iloc[k]
            if r==r and bm.iloc[k]==bm.iloc[k]:rows.append((dates[k],r-COST-bm.iloc[k]))
    if len(rows)<20:return dict(n=len(rows))
    ev=pd.DataFrame(rows,columns=["d","x"]);m=ev.d.dt.to_period("M").astype(str).values
    return dict(n=int(len(ev)),mean_net_excess=float(ev.x.mean()),hit_rate_net_excess=float((ev.x>0).mean()),lb=boot_lb(ev.x.values,m))
def tom(cl,elig,s,e):
    ret=cl.pct_change(fill_method=None).where(elig.shift(1).fillna(False)).clip(-0.6,0.6).mean(axis=1).fillna(0);dates=cl.index
    ym=pd.Series(dates.to_period("M"),index=dates);out=[]
    mons=sorted(set(ym))
    for a,b in zip(mons[:-1],mons[1:]):
        da=dates[ym==a];db=dates[ym==b]
        if len(da)<3 or len(db)<3:continue
        t0=da[-2];t1=db[2]
        if not(s<=t0<=e):continue
        w=ret.loc[(dates>t0)&(dates<=t1)];out.append((str(a),float((1+w).prod()-1-COST)))
    x=pd.DataFrame(out,columns=["m","x"])
    return dict(n_months=int(len(x)),mean_net_month=float(x.x.mean()),lb=boot_lb(x.x.values,np.arange(len(x))//3)) if len(x)>=12 else dict(n_months=len(x))
def main(a):
    P=json.load(open(a.prereg));cl,vo=load(a.db);ret,elig,sig=features(cl,vo);out=dict(prereg_sha256=hashlib.sha256(open(a.prereg,"rb").read()).hexdigest(),db_sha256=hashlib.sha256(open(a.db,"rb").read()).hexdigest())
    W=dict(discovery=("2017-01-01","2021-12-31"),validation=("2022-01-01","2024-12-31"),exposed_informational=("2025-01-01","2026-11-05"))
    for k,(mask,H) in sig.items():
        out[k]={n:event_stats(cl,elig,mask,H,pd.Timestamp(s),pd.Timestamp(e)) for n,(s,e) in W.items()}
    out["I4"]={n:tom(cl,elig,pd.Timestamp(s),pd.Timestamp(e)) for n,(s,e) in W.items()}
    wd=ret.where(elig.shift(1).fillna(False)).clip(-0.6,0.6).mean(axis=1);wd=wd[(wd.index>="2017-01-01")&(wd.index<="2024-12-31")]
    out["weekday_mean_daily_pct_2017_2024"]={str(n):round(float(v)*100,3) for n,v in wd.groupby(wd.index.day_name()).mean().items()}
    cand={}
    for k in ("I1","I2","I3","I6","I7"):
        d,v=out[k]["discovery"],out[k]["validation"]
        cand[k]=bool(d.get("mean_net_excess",-1)>0 and v.get("mean_net_excess",-1)>0 and v.get("lb",-1)>0 and v.get("n",0)>=100)
    d,v=out["I4"]["discovery"],out["I4"]["validation"];cand["I4"]=bool(d.get("mean_net_month",-1)>0 and v.get("mean_net_month",-1)>0 and v.get("lb",-1)>0 and v.get("n_months",0)>=30)
    out["candidates"]=cand;json.dump(out,open(a.out,"w"),indent=1);print(json.dumps(out,indent=1))
if __name__=="__main__":
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("db","prereg","out")];main(ap.parse_args())
