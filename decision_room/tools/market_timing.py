#!/usr/bin/env python3
"""Market-level trend filter under config/market_timing_prereg_2026-11-06.json. Read-only.
usage: market_timing.py --db x.sqlite --prereg p.json --amendment a.json --out r.json"""
import argparse,hashlib,json,sqlite3
import numpy as np,pandas as pd
FEE=0.0018;SLIP=0.003;IMP=0.25;POS=250000;ADV_MIN=5e6;ART=0.115;MINN=3;B=10000;SEED=20261106;A1=0.05;A2=0.001
def load(db):
    c=sqlite3.connect("file:"+db+"?mode=ro",uri=True)
    df=pd.read_sql("select ticker,date,close,volume from canonical_bars where price_basis='RAW' and close>0",c,parse_dates=["date"]);c.close()
    cl=df.pivot(index="date",columns="ticker",values="close").sort_index()
    return cl,df.pivot(index="date",columns="ticker",values="volume").reindex(cl.index).fillna(0)
def index_and_cost(cl,vo):
    ret=cl.pct_change(fill_method=None);adv=(cl*vo).rolling(20).mean()
    el=((adv>=ADV_MIN)&cl.notna()).shift(1,fill_value=False)           # known at t-1
    ok=el&ret.notna();art=ok&(ret.abs()>ART);val=ok&~art
    r=ret.where(val).mean(axis=1);n=val.sum(axis=1)
    r=r.where(n>=MINN);first=r.first_valid_index();r=r.loc[first:].fillna(0.0)   # Amendment1: calendar continuity, thin days flat
    thin=int((n.loc[first:]<MINN).sum())
    imp=(IMP*POS/adv.where(adv>0)).shift(1).where(el).mean(axis=1)
    return r,imp,dict(thin_days_flat=thin,artefact_name_days_excluded=int(art.sum().sum()),valid_name_days=int(val.sum().sum()))
def run_rule(r,imp,ma,s,e):
    r0=r;L=(1+r0).cumprod();sig=(L>L.rolling(ma,min_periods=ma).mean())
    pos=sig.shift(2,fill_value=False).astype(float)                      # signal t -> trade t+1 -> exposed from t+2
    ma_ok=L.rolling(ma,min_periods=ma).mean().notna().shift(2,fill_value=False)
    w=(r0.index>=s)&(r0.index<=e)&ma_ok.values
    rw=r0[w];pw=pos[w];iw=imp.reindex(rw.index).fillna(imp.mean())
    if len(rw)==0:return None
    side=FEE+SLIP+iw
    chg=(pw.diff().abs().fillna(pw.iloc[0])).astype(float)               # entry from cash counts
    tr=pw*rw-chg*side
    bh=rw.copy();bh.iloc[0]-=side.iloc[0]
    return rw.index[0],tr,bh,float(pw.mean()),int(chg.sum()),pw
def mdd(x):
    eq=(1+x).cumprod();return float((eq/eq.cummax()-1).min())
def monthly(x):return (1+x).groupby(x.index.to_period("M")).prod()-1
def boot(x):
    K_=np.arange(len(x))//3;S=np.bincount(K_,weights=x);N=np.bincount(K_).astype(float);K=len(S)
    rng=np.random.default_rng(SEED);idx=rng.integers(0,K,(B,K));v=S[idx].sum(1)/N[idx].sum(1)
    return float(np.quantile(v,A1)),float(np.quantile(v,A2))
def window(r,imp,ma,s,e,full=True):
    o=run_rule(r,imp,ma,pd.Timestamp(s),pd.Timestamp(e))
    if o is None:return dict(n_months=0)
    start,tr,bh,ex,sw,pw=o;mt,mb=monthly(tr),monthly(bh);d=(mt-ex*mb).dropna()
    out=dict(actual_start=str(start.date()),days=int(len(tr)),invested_fraction=ex,switches=sw,switches_per_year=sw/(len(tr)/252),
      timing_total=float((1+tr).prod()-1),bh_total=float((1+bh).prod()-1),timing_maxdd=mdd(tr),bh_maxdd=mdd(bh),
      timing_ann_vol=float(tr.std()*np.sqrt(252)),bh_ann_vol=float(bh.std()*np.sqrt(252)),n_months=int(len(d)),mean_d=float(d.mean()),mean_timing_m=float(mt.mean()),mean_bh_m=float(mb.mean()))
    if full and len(d)>=12:out["lb05"],out["lb001"]=boot(d.values)
    return out
def main(a):
    P=json.load(open(a.prereg));cl,vo=load(a.db);r,imp,info=index_and_cost(cl,vo);W=P["windows"]
    out=dict(prereg_sha256=hashlib.sha256(open(a.prereg,"rb").read()).hexdigest(),amendment_sha256=hashlib.sha256(open(a.amendment,"rb").read()).hexdigest(),db_sha256=hashlib.sha256(open(a.db,"rb").read()).hexdigest(),index_info=info,index_first_date=str(r.index[0].date()))
    out["primary_ma200"]={n:window(r,imp,200,*W[n]) for n in W}
    out["sensitivity_descriptive"]={str(m):{n:window(r,imp,m,*W[n],full=False) for n in W} for m in P["sensitivity_descriptive_only"]["ma_windows"]}
    d,v=out["primary_ma200"]["discovery"],out["primary_ma200"]["validation"]
    out["candidate_for_forward_paper"]=bool(d.get("mean_d",-1)>0 and v.get("mean_d",-1)>0 and v.get("lb05",-1)>0 and v.get("timing_maxdd",-9)>v.get("bh_maxdd",9) and v.get("n_months",0)>=30)
    out["strict_gate_lb001_gt0"]=bool(v.get("lb001",-1)>0)
    json.dump(out,open(a.out,"w"),indent=1);print(json.dumps(out,indent=1))
if __name__=="__main__":
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("db","prereg","amendment","out")];main(ap.parse_args())
