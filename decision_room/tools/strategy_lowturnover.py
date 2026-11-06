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
def run(cl,vo,start,end,N=10):
    ret1=cl.pct_change(fill_method=None);adv=(cl*vo.fillna(0)).rolling(20).mean()
    el_all=(adv>=5e6)&cl.notna();jl_all=(ret1.abs()>JUMP).rolling(252,min_periods=1).max()>0
    ew=ret1.where(el_all&~jl_all).mean(axis=1).fillna(0);idx=(1+ew).cumprod();idxma=idx.rolling(100).mean()
    dates=cl.index;me=[k for k in range(len(dates)-1) if dates[k].month!=dates[k+1].month]
    kinds=["H1","H2","H3","H4","H5"];res={k:[] for k in kinds};bench=[];hold={k:set() for k in kinds};excl=dict(jump_in_hold=0,missing_exit=0)
    for a,b in zip(me[:-1],me[1:]):
        if not(pd.Timestamp(start)<=dates[a]<=pd.Timestamp(end)) or a<260 or b+1>=len(dates):continue
        en,ex=a+1,b+1;r=cl.iloc[ex]/cl.iloc[en]-1
        jh=(ret1.iloc[en+1:ex+1].abs()>JUMP).any();ok=r.notna()&~jh
        excl["jump_in_hold"]+=int((jh&r.notna()).sum());excl["missing_exit"]+=int(r.isna().sum())
        elig=(adv.iloc[a]>=5e6)&cl.iloc[a].notna()&~jl_all.iloc[a]&ok
        if elig.sum()<N:continue
        bench.append((dates[ex],float(r[elig].mean())))
        for k in kinds:
            s=signals(cl,vo,a,k,adv,ret1,idxma,idx);s=s[s.index.isin(r.index[ok])]
            top=list(s.sort_values(ascending=False).index[:N]) if len(s)>=N else []
            new=set(top);old=hold[k];w=1.0/N
            imp=lambda t:0.25*SIZE/(adv.iloc[a][t] if t in adv.columns and adv.iloc[a][t]==adv.iloc[a][t] and adv.iloc[a][t]>=5e6 else 5e6)
            cost=sum(w*(FEE+SLIP+imp(t)) for t in new-old)+sum(w*(FEE+SLIP+imp(t)) for t in old-new)
            gross=sum(w*float(r[t]) for t in top) if top else 0.0
            res[k].append((dates[ex],gross-cost,gross,cost));hold[k]=new
    return res,bench,excl
def boot(x,seed=20261106,B=5000,blk=3,q=0.01):
    x=np.asarray(x);n=len(x);rng=np.random.default_rng(seed);m=[]
    nb=int(np.ceil(n/blk))
    for _ in range(B):
        st=rng.integers(0,n-blk+1,nb);m.append(np.concatenate([x[s:s+blk] for s in st])[:n].mean())
    return float(np.quantile(m,q))
def stats(rows,bench):
    d=pd.Series({a:b for a,b,*_ in rows});bm=pd.Series(dict(bench)).reindex(d.index);ex=d-bm
    eq=(1+d).cumprod();dd=(eq/eq.cummax()-1).min();n=len(d)
    yr=ex.groupby(d.index.year).mean();net_yr=d.groupby(d.index.year).mean()
    return dict(n_months=n,mean_net_m=float(d.mean()),ann_net=float(eq.iloc[-1]**(12/n)-1) if n else None,ann_vol=float(d.std()*12**.5),sharpe_rf0=float(d.mean()/d.std()*12**.5) if d.std()>0 else None,max_dd=float(dd),
      mean_excess_m=float(ex.mean()),boot99_lb_net=boot(d.values),boot99_lb_excess=boot(ex.values),years_positive_excess=int((yr>0).sum()),years=int(len(yr)),mean_gross_m=float(np.mean([g for *_,g,c in rows])),mean_cost_m=float(np.mean([c for *_,c in rows])),bench_mean_m=float(bm.mean()))
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("db","prereg","out")];a=ap.parse_args(argv)
    P=json.load(open(a.prereg));cl,vo=load(a.db);out=dict(prereg_sha256=hashlib.sha256(open(a.prereg,"rb").read()).hexdigest(),data_range=[str(cl.index.min().date()),str(cl.index.max().date())])
    for name,(s,e) in dict(development=P["periods"]["development"],exposed_informational=P["periods"]["exposed_informational"]).items():
        res,bench,excl=run(cl,vo,s,e);blk={}
        for k,rows in res.items():
            if len(rows)>=12:blk[k]=stats(rows,bench)
        out[name]=dict(period=[s,e],exclusions=excl,hypotheses=blk)
    dv=out["development"]["hypotheses"];adv={}
    for k,v in dv.items():adv[k]=bool(v["n_months"]>=60 and v["mean_net_m"]>0 and v["boot99_lb_excess"]>0 and v["years_positive_excess"]>=6)
    out["advance_to_forward_paper"]=adv;out["decision"]="ADVANCE_TO_FORWARD_PAPER:"+",".join(k for k,v in adv.items() if v) if any(adv.values()) else "NO_STRATEGY_APPROVED"
    json.dump(out,open(a.out,"w"),indent=1);print(json.dumps(dict(decision=out["decision"],adv=adv,dev={k:{x:round(y,4) if isinstance(y,float) else y for x,y in v.items() if x in("n_months","mean_net_m","ann_net","sharpe_rf0","max_dd","mean_excess_m","boot99_lb_excess","years_positive_excess")} for k,v in dv.items()}),indent=1));return 0
if __name__=="__main__":raise SystemExit(main())
