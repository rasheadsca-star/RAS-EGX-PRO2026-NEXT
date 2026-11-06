#!/usr/bin/env python3
"""EXPLORATORY event study of the channel-bounce scanner (not a pre-registered strategy test, cannot license anything).
Events de-clustered (>=10 sessions per ticker). Entry close t+1, exit close t+1+H. Round-trip cost 0.96% flat (fee+slippage, impact ignored => optimistic).
Benchmark: mean forward return of ALL ticker-days with ADV20>=10M EGP on the same horizon. usage: ... --db x.sqlite --out r.json"""
import argparse,json,sys,pathlib
import numpy as np,pandas as pd
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import channel_bounce_scan as C
COST=0.0096;JUMP=C.JUMP
def run(df,hs=(10,20)):
    ev=[];bm={h:[] for h in hs}
    for t,g in df.groupby("ticker"):
        g=g.sort_values("date").reset_index(drop=True);r=C.signals_for(g)
        if r is None:continue
        idx,out,info=r;c=g.close.values.astype(float);d=g.date.values;n=len(c)
        v=np.nan_to_num(g.volume.values.astype(float));adv=pd.Series(c*v).rolling(20).mean().values
        for h in hs:
            for e in range(260,n-h-1):
                if adv[e]>=C.ADV_MIN:
                    fr=c[e+1+h]/c[e+1]-1
                    if abs(fr)<5:bm[h].append((d[e],fr))
        last=-99
        for k in np.where(out)[0]:
            e=idx[k]
            if e-last<10:continue
            last=e
            for h in hs:
                if e+1+h<n:
                    mx=np.abs(np.diff(c[e+1:e+2+h])/c[e+1:e+1+h]).max()
                    ev.append(dict(ticker=t,date=pd.Timestamp(d[e]),h=h,gross=c[e+1+h]/c[e+1]-1,jump=bool(mx>JUMP)))
    return pd.DataFrame(ev),{h:pd.DataFrame(v,columns=["date","fr"]) for h,v in bm.items()}
def boot(x,m,B=5000,seed=7):
    rng=np.random.default_rng(seed);keys=np.unique(m);xs=pd.Series(x).groupby(m).apply(list);
    vals=[np.mean(np.concatenate([xs[k] for k in rng.choice(keys,len(keys))])) for _ in range(B)];return float(np.quantile(vals,.025)),float(np.quantile(vals,.975))
def main(a):
    df=C.load(a.db);ev,bm=run(df);out={}
    for h in (10,20):
        e=ev[(ev.h==h)];b=bm[h];period={"dev_to_2024":(pd.Timestamp("2017-01-01"),pd.Timestamp("2024-12-31")),"exposed_2025_26":(pd.Timestamp("2025-01-01"),pd.Timestamp("2026-12-31"))}
        for nm,(s,t) in period.items():
            ee=e[(e.date>=s)&(e.date<=t)&(~e.jump)];bb=b[(b.date>=s)&(b.date<=t)]
            if len(ee)<20:out[f"H{h}_{nm}"]=dict(n=len(ee),note="too few");continue
            ex=ee.gross.values-bb.fr.mean();m=ee.date.dt.to_period("M").astype(str).values;lo,hi=boot(ex,m)
            out[f"H{h}_{nm}"]=dict(n=int(len(ee)),mean_gross=float(ee.gross.mean()),mean_net=float(ee.gross.mean()-COST),hit_rate_gross=float((ee.gross>0).mean()),bench_mean=float(bb.fr.mean()),mean_excess_gross=float(ex.mean()),excess_ci95_month_cluster=[lo,hi],excluded_jump_events=int(((e.date>=s)&(e.date<=t)&e.jump).sum()))
    json.dump(out,open(a.out,"w"),indent=1);print(json.dumps(out,indent=1))
if __name__=="__main__":
    ap=argparse.ArgumentParser();ap.add_argument("--db",required=True);ap.add_argument("--out",required=True);main(ap.parse_args())
