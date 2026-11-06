#!/usr/bin/env python3
"""Idea screen v2 under config/idea_screen_prereg_2026-11-06_AMENDMENT1.json (v1 retracted). Read-only.
usage: idea_screen.py --db x.sqlite --prereg p.json --amendment a.json --out r.json --events e.csv
All parameters come from the amendment's `parameters` block. No future-conditioned filtering of any kind."""
import argparse,hashlib,json,sqlite3
import numpy as np,pandas as pd

def load(db):
    c=sqlite3.connect("file:"+db+"?mode=ro",uri=True)
    df=pd.read_sql("select ticker,date,close,volume from canonical_bars where price_basis='RAW' and close>0",c,parse_dates=["date"]);c.close()
    cl=df.pivot(index="date",columns="ticker",values="close").sort_index()
    vo=df.pivot(index="date",columns="ticker",values="volume").reindex(cl.index).fillna(0)
    return cl,vo

def rsi_n(cl,n):
    ch=cl.diff();g=ch.clip(lower=0).rolling(n).mean();l=(-ch.clip(upper=0)).rolling(n).mean()
    rs=g/l.replace(0,np.nan);r=100-100/(1+rs)
    r=r.where(~((l==0)&(g>0)),100.0)          # C7: no losses => 100
    return r.where(~((l==0)&(g==0)))          # both zero => undefined (NaN => no signal)

def features(cl,vo,P):
    ret=cl.pct_change(fill_method=None);adv=(cl*vo).rolling(20).mean()
    jl=(ret.abs()>P["jump_hygiene"]).rolling(P["jump_lookback"],min_periods=1).max().shift(1).fillna(0)>0   # info up to t-1
    elig=(adv>=P["adv_min"])&cl.notna()&~jl
    vavg=vo.rolling(20).mean().shift(1);I=P["ideas"];sig={}
    a=I["I1"];sig["I1"]=(elig&(ret>=a["ret_lo"])&(ret<=a["ret_hi"])&(vo>=a["volx"]*vavg),a["H"])
    a=I["I2"];sig["I2"]=(elig&(ret>=a["ret_lo"])&(ret<=a["ret_hi"])&(vo>=a["volx"]*vavg),a["H"])
    a=I["I3"];sig["I3"]=(elig&(cl>cl.rolling(a["lookback"]).max().shift(1))&(vo>=a["volx"]*vavg)&(ret>0),a["H"])
    a=I["I6"];sig["I6"]=(elig&(rsi_n(cl,a["rsi_n"])<a["rsi_max"])&(cl>cl.rolling(a["ma"]).mean()),a["H"])
    a=I["I7"];sig["I7"]=(elig&((adv/adv.rolling(40).mean().shift(21))>=a["ratio"])&(cl>cl.rolling(a["ma"]).mean()),a["H"])
    return ret,adv,elig,sig

def cost_matrix(adv,P):
    adv=adv.where(adv>0)    # zero/missing ADV => NaN => no trade
    return P["fee_slip_round_trip"]+2*P["impact_coef"]*(P["position_egp"]/adv)

def boot(x,m,P):
    """month-cluster bootstrap of the pooled mean; returns lower bounds at alpha_family and alpha_strict"""
    x=np.asarray(x,float)
    if not np.isfinite(x).all():raise ValueError("non-finite input to bootstrap")
    codes,_=pd.factorize(pd.Series(m));K=codes.max()+1
    S=np.bincount(codes,weights=x,minlength=K);N=np.bincount(codes,minlength=K).astype(float)
    rng=np.random.default_rng(P["seed"]);idx=rng.integers(0,K,(P["B"],K))
    v=S[idx].sum(1)/N[idx].sum(1)
    return float(np.quantile(v,P["alpha_family"])),float(np.quantile(v,P["alpha_strict"]))

def event_stats(cl,adv,elig,mask,H,s,e,P,idea,log):
    f=cl.shift(-(1+H))/cl.shift(-1)-1;C=cost_matrix(adv,P);Nn=f-C
    bm=Nn.where(elig).mean(axis=1);dates=cl.index;nd=len(dates);rows=[];miss=unreal=big=0
    for t in cl.columns:
        i=np.where(mask[t].values)[0];last=-10**9
        for k in i:
            if not(s<=dates[k]<=e):continue
            if k-last<H:continue                         # C4: entry-based declustering
            if not np.isfinite(C[t].iloc[k]):log.append((idea,t,dates[k].date(),"NO_ADV_NO_TRADE"));continue
            last=k
            if k+1+H>=nd:unreal+=1;log.append((idea,t,dates[k].date(),"UNREALIZED"));continue
            r=Nn[t].iloc[k];b=bm.iloc[k]
            if not(np.isfinite(r) and np.isfinite(b)):miss+=1;log.append((idea,t,dates[k].date(),"MISSING_OUTCOME"));continue
            if abs(f[t].iloc[k])>0.6:big+=1;log.append((idea,t,dates[k].date(),"OK_BIG_RETURN_KEPT"))
            rows.append((dates[k],r-b))
    n=len(rows);tot=n+miss
    out=dict(n=n,missing=miss,unrealized=unreal,big_return_kept=big,missing_share=(miss/tot if tot else None))
    if n<20:return out
    ev=pd.DataFrame(rows,columns=["d","x"]);m=ev.d.dt.to_period("M").astype(str).values
    lb,lbs=boot(ev.x.values,m,P)
    out.update(mean_net_excess=float(ev.x.mean()),hit_rate_net_excess=float((ev.x>0).mean()),lb_family=lb,lb_strict=lbs)
    return out

def tom(cl,adv,elig,s,e,P):
    dates=cl.index;C=cost_matrix(adv,P);ym=pd.Series(dates.to_period("M"),index=dates);mons=sorted(set(ym));rows=[];pos={d:i for i,d in enumerate(dates)}
    bmcache={};dropped=0
    def bmL(L):
        if L not in bmcache:
            net=cl.shift(-L)/cl-1-C;ew=net.where(elig).mean(axis=1);w=ew[(ew.index>=s)&(ew.index<=e)].dropna();bmcache[L]=float(w.mean())
        return bmcache[L]
    for a,b in zip(mons[:-1],mons[1:]):
        da=dates[ym==a];db=dates[ym==b]
        if len(da)<3 or len(db)<3:continue
        t0=da[-2];t1=db[2]
        if not(s<=t0<=e):continue
        L=pos[t1]-pos[t0];r=(cl.loc[t1]/cl.loc[t0]-1-C.loc[t0]).where(elig.loc[t0])
        dropped+=int(elig.loc[t0].sum()-r.notna().sum())
        if r.notna().sum()==0:continue
        rows.append((str(a),float(r.mean()),float(r.mean())-bmL(L)))
    x=pd.DataFrame(rows,columns=["m","net","excess"])
    if len(x)<P["ideas"]["I4"]["min_months"]:return dict(n_months=len(x),names_dropped_missing_end=dropped)
    lb,lbs=boot(x.excess.values,np.arange(len(x))//P["ideas"]["I4"]["cluster_months"],P)
    return dict(n_months=len(x),names_dropped_missing_end=dropped,mean_net_month=float(x.net.mean()),mean_net_excess=float(x.excess.mean()),lb_family=lb,lb_strict=lbs)

def main(a):
    P=json.load(open(a.amendment))["parameters"];cl,vo=load(a.db);ret,adv,elig,sig=features(cl,vo,P)
    out=dict(prereg_sha256=hashlib.sha256(open(a.prereg,"rb").read()).hexdigest(),amendment_sha256=hashlib.sha256(open(a.amendment,"rb").read()).hexdigest(),db_sha256=hashlib.sha256(open(a.db,"rb").read()).hexdigest())
    W={k:(pd.Timestamp(v[0]),pd.Timestamp(v[1])) for k,v in P["windows"].items()};log=[]
    for k,(mask,H) in sig.items():out[k]={n:event_stats(cl,adv,elig,mask,H,s,e,P,k,log) for n,(s,e) in W.items()}
    out["I4"]={n:tom(cl,adv,elig,s,e,P) for n,(s,e) in W.items()}
    wd=ret.where(elig.shift(1).fillna(False)).mean(axis=1).dropna();wd=wd[(wd.index>="2017-01-01")&(wd.index<="2024-12-31")]
    out["weekday_mean_daily_pct_2017_2024"]={str(n):round(float(v)*100,3) for n,v in wd.groupby(wd.index.day_name()).mean().items()}
    cand={}
    for k in ("I1","I2","I3","I6","I7"):
        d,v=out[k]["discovery"],out[k]["validation"]
        ok=lambda z:(z.get("missing_share") or 0)<=P["max_missing_share"]
        cand[k]=bool(d.get("mean_net_excess",-1)>0 and v.get("mean_net_excess",-1)>0 and v.get("lb_strict",-1)>0 and v.get("n",0)>=P["ideas"][k]["nmin"] and ok(d) and ok(v))
    d,v=out["I4"]["discovery"],out["I4"]["validation"]
    cand["I4"]=bool(d.get("mean_net_excess",-1)>0 and v.get("mean_net_excess",-1)>0 and v.get("lb_strict",-1)>0 and v.get("n_months",0)>=P["ideas"]["I4"]["min_months"])
    out["candidates"]=cand;json.dump(out,open(a.out,"w"),indent=1)
    pd.DataFrame(log,columns=["idea","ticker","date","status"]).to_csv(a.events,index=False);print(json.dumps(out,indent=1))

if __name__=="__main__":
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("db","prereg","amendment","out","events")];main(ap.parse_args())
