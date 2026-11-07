#!/usr/bin/env python3
"""Pre-registered low-turnover strategy family (config/strategy_preregistration_2026-11-06_lowturnover.json). Read-only on the DB.
usage: strategy_lowturnover.py --db staged.sqlite --prereg p.json --out result.json"""
import argparse,hashlib,json,sqlite3
import numpy as np,pandas as pd
SIZE=250000.0;FEE=0.0018;SLIP=0.003;JUMP=0.115
def load(db):
    c=sqlite3.connect("file:"+db+"?mode=ro",uri=True)
    df=pd.read_sql("select ticker,date,close,volume from canonical_bars where price_basis='RAW' and close>0",c,parse_dates=["date"]);c.close()
    cl=df.pivot(index="date",columns="ticker",values="close").sort_index();vo=df.pivot(index="date",columns="ticker",values="volume").reindex(cl.index)
    return cl,vo
def signals(cl,vo,i,kind,adv,ret1,idxma,idx):
    """ticker -> score (higher better) at session index i, among eligible"""
    el=(adv.iloc[i]>=5e6)&cl.iloc[i].notna()
    if kind in("H1","H3"):lo=126;s=cl.iloc[i-21]/cl.iloc[i-lo]-1
    elif kind=="H2":s=cl.iloc[i-21]/cl.iloc[i-252]-1
    elif kind=="H4":s=-ret1.iloc[i-59:i+1].std()
    elif kind=="H5":s=cl.iloc[i]/cl.iloc[i-251:i+1].max()
    jl=(ret1.iloc[max(1,i-251):i+1].abs()>JUMP).any()
    s=s[el&~jl&s.notna()]
    if kind=="H3" and not(idx.iloc[i]>idxma.iloc[i]):return s.iloc[0:0]
    return s
def run(cl,vo,start,end,N=10,excl_jump_hold=False):
    """ex-ante membership only (amendment 1). excl_jump_hold=True is a BIASED sensitivity, never used for advancement."""
    ret1=cl.pct_change(fill_method=None);adv=(cl*vo.fillna(0)).rolling(20).mean()
    el_all=(adv>=5e6)&cl.notna();jl_all=(ret1.abs()>JUMP).rolling(252,min_periods=1).max()>0
    ew=ret1.where(el_all&~jl_all).mean(axis=1).fillna(0);idx=(1+ew).cumprod();idxma=idx.rolling(100).mean()
    dates=cl.index;me=[k for k in range(len(dates)-1) if dates[k].month!=dates[k+1].month]
    kinds=["H1","H2","H3","H4","H5"];res={k:[] for k in kinds};bench=[];hold={k:{} for k in kinds}
    info=dict(unfilled_entries=0,exit_marked_last_close=0,jump_in_hold_names=0,cost_fallback_used=0)
    def price_at(t,i):
        v=cl.iloc[:i+1][t].dropna();return (v.iloc[-1],v.index[-1]) if len(v) else (np.nan,None)
    for a,b in zip(me[:-1],me[1:]):
        if not(pd.Timestamp(start)<=dates[a]<=pd.Timestamp(end)) or a<260 or b+1>=len(dates):continue
        en,ex=a+1,b+1
        elig=(adv.iloc[a]>=5e6)&cl.iloc[a].notna()&~jl_all.iloc[a]   # information up to t only
        if elig.sum()<N:continue
        def realized(t):
            p0=cl.iloc[en][t]
            if p0!=p0:return None,"unfilled"
            p1=cl.iloc[ex][t];mk=False
            if p1!=p1:p1,_=price_at(t,ex);mk=True
            jh=bool((ret1.iloc[en+1:ex+1][t].abs()>JUMP).any())
            return (p1/p0-1,mk,jh),"ok"
        cache={}
        def R(t):
            if t not in cache:cache[t]=realized(t)
            return cache[t]
        names=list(elig[elig].index);br=[]
        for t in names:
            r,st=R(t)
            if r is None:continue
            if excl_jump_hold and r[2]:continue
            br.append(r[0])
        bench.append((dates[ex],float(np.mean(br)) if br else 0.0))
        for k in kinds:
            s=signals(cl,vo,a,k,adv,ret1,idxma,idx)
            top=list(s.sort_values(ascending=False).index[:N]) if len(s)>=N else []
            w=1.0/N;gross_r={};filled=[]
            for t in top:
                r,st=R(t)
                if r is None:info["unfilled_entries"]+=1;continue
                if excl_jump_hold and r[2]:continue
                info["exit_marked_last_close"]+=int(r[1]);info["jump_in_hold_names"]+=int(r[2]);gross_r[t]=r[0];filled.append(t)
            gross=sum(w*gross_r[t] for t in filled)
            port=1+gross;old=hold[k]
            def imp(t):
                v=adv.iloc[a][t] if t in adv.columns else np.nan
                if not(np.isfinite(v)) or v<5e6:info["cost_fallback_used"]+=1;v=5e6
                return 0.25*SIZE/v
            c=0.0
            for t in filled:
                tw=w if t not in old else abs(w-old[t]);c+=tw*(FEE+SLIP+imp(t))
            for t in old:
                if t not in filled:c+=old[t]*(FEE+SLIP+imp(t))
            res[k].append((dates[ex],gross-c,gross,c,filled,list(top)))
            hold[k]={t:w*(1+gross_r[t])/port for t in filled}
    return res,bench,info
def boot(x,seed=20261106,B=20000,blk=3,q=0.01/9):
    x=np.asarray(x,dtype=float)
    if not np.isfinite(x).all():raise ValueError('non-finite series; refusing to bootstrap')
    n=len(x);rng=np.random.default_rng(seed);m=[]
    nb=int(np.ceil(n/blk))
    for _ in range(B):
        st=rng.integers(0,n-blk+1,nb);m.append(np.concatenate([x[s:s+blk] for s in st])[:n].mean())
    return float(np.quantile(m,q))
def stats(rows,bench):
    d=pd.Series({r[0]:r[1] for r in rows});bm=pd.Series(dict(bench)).reindex(d.index);ex=d-bm
    eq=(1+d).cumprod();dd=(eq/eq.cummax()-1).min();n=len(d)
    yr=ex.groupby(d.index.year).mean();net_yr=d.groupby(d.index.year).mean()
    return dict(n_months=n,mean_net_m=float(d.mean()),ann_net=float(eq.iloc[-1]**(12/n)-1) if n else None,ann_vol=float(d.std()*12**.5),ratio_rf_zero_diagnostic=float(d.mean()/d.std()*12**.5) if d.std()>0 else None,max_dd=float(dd),
      mean_excess_m=float(ex.mean()),boot_lb_net=boot(d.values),boot_lb_excess=boot(ex.values),years_positive_excess=int((yr>0).sum()),years=int(len(yr)),mean_gross_m=float(np.mean([r[2] for r in rows])),mean_cost_m=float(np.mean([r[3] for r in rows])),bench_mean_m=float(bm.mean()))
def sha(p):return hashlib.sha256(open(p,"rb").read()).hexdigest()
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("db","prereg","amendment","out")];a=ap.parse_args(argv)
    P=json.load(open(a.prereg));cl,vo=load(a.db)
    out=dict(prereg_sha256=sha(a.prereg),amendment_sha256=sha(a.amendment),db_sha256=sha(a.db),alpha="0.01/9",data_range=[str(cl.index.min().date()),str(cl.index.max().date())])
    for name,(s_,e) in dict(development=P["periods"]["development"],exposed_informational=P["periods"]["exposed_informational"]).items():
        res,bench,info=run(cl,vo,s_,e);blk={k:stats(r,bench) for k,r in res.items() if len(r)>=12}
        res2,bench2,info2=run(cl,vo,s_,e,excl_jump_hold=True)
        sens={k:dict(mean_net_m=float(np.mean([x[1] for x in r])),n_months=len(r)) for k,r in res2.items() if len(r)>=12}
        out[name]=dict(period=[s_,e],execution_info=info,hypotheses=blk,BIASED_sensitivity_excluding_jump_in_hold=sens)
    dv=out["development"]["hypotheses"];adv={k:bool(v["n_months"]>=60 and v["mean_net_m"]>0 and v["boot_lb_excess"]>0 and v["years_positive_excess"]>=6) for k,v in dv.items()}
    out["advance_to_forward_paper"]=adv;out["decision"]="ADVANCE_TO_FORWARD_PAPER:"+",".join(k for k,v in adv.items() if v) if any(adv.values()) else "NO_STRATEGY_APPROVED"
    json.dump(out,open(a.out,"w"),indent=1)
    print(out["decision"],out["development"]["execution_info"])
    for part in("development","exposed_informational"):
        print(part)
        for k,v in out[part]["hypotheses"].items():print(" ",k,{x:round(v[x],4) for x in("n_months","mean_net_m","ann_net","max_dd","mean_excess_m","boot_lb_excess","mean_gross_m","mean_cost_m","bench_mean_m")},v["years_positive_excess"],"/",v["years"])
    return 0
if __name__=="__main__":raise SystemExit(main())
