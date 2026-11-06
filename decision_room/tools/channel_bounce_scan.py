#!/usr/bin/env python3
"""Descriptive technical scanner (NOT a strategy, NOT a recommendation): ascending log-regression channel + bounce off the lower band
on above-average volume with high liquidity. Fixed textbook parameters, not tuned. Read-only on the DB.
usage: channel_bounce_scan.py --db staged.sqlite --out dir [--asof YYYY-MM-DD]"""
import argparse,json,os,sqlite3
import numpy as np,pandas as pd
from numpy.lib.stride_tricks import sliding_window_view as swv
L=90;R2MIN=0.5;ANN_MIN=0.15;BAND=1.5;ZONE=0.25;BOUNCE_MIN=0.015;VOLX=1.5;ADV_MIN=10e6;TOUCHES_MIN=2;JUMP=0.115
def load(db):
    c=sqlite3.connect("file:"+db+"?mode=ro",uri=True)
    df=pd.read_sql("select ticker,date,open,high,low,close,volume,evidence_tier from canonical_bars where price_basis='RAW' and close>0",c,parse_dates=["date"]);c.close();return df
def channel(y):
    W=swv(y,L);x=np.arange(L)-(L-1)/2;sxx=(x**2).sum();ym=W.mean(1);b=(W*x).sum(1)/sxx
    fit=ym[:,None]+b[:,None]*x[None,:];res=W-fit;ssr=(res**2).sum(1);sst=((W-ym[:,None])**2).sum(1)
    return b,1-ssr/np.where(sst>0,sst,np.nan),np.sqrt(ssr/(L-2)),fit,res
def signals_for(g):
    """returns DataFrame indexed by window-end row with boolean 'sig' and fields"""
    c=g.close.values.astype(float);h=g.high.values.astype(float);l=g.low.values.astype(float);v=np.nan_to_num(g.volume.values.astype(float));n=len(c)
    if n<L+30:return None
    y=np.log(c);b,r2,s,fit,res=channel(y);m=len(b);idx=np.arange(L-1,n)
    ret=np.r_[np.nan,np.abs(np.diff(c)/c[:-1])];jmp=swv(np.nan_to_num(ret),L).max(1)>JUMP
    adv=pd.Series(c*v).rolling(20).mean().values[idx];v20=pd.Series(v).rolling(20).mean().shift(1).values
    lowb=np.exp(fit[:,-1]-BAND*s);zone=np.exp(fit[:,-1]-BAND*s+ZONE*s)
    # touch = low within the zone around the lower band (log space)
    touch_all=np.log(l)[None,:]  # placeholder
    out=np.zeros(m,bool);info=[]
    ll=np.log(l)
    for k in range(m):
        e=idx[k]
        if not(b[k]>0 and r2[k]>=R2MIN and b[k]*252>=ANN_MIN) or jmp[k] or not(adv[k]>=ADV_MIN) or s[k]<=0:info.append(None);continue
        lb=fit[k]-BAND*s[k]  # lower band over the window (log), per position
        thr=lb+ZONE*s[k];lows=ll[e-L+1:e+1]
        rec=lows[-3:].min();recpos=np.argmin(lows[-3:])
        if not(rec<=thr[-3:][recpos]):info.append(None);continue
        if not(c[e]>=np.exp(lb[-1]+0.75*s[k]) and c[e]>np.exp(rec)*(1+BOUNCE_MIN) and c[e]>c[e-1]):info.append(None);continue
        touch=lows[:-5]<=thr[:-5];ev=0;last=-99
        for j in np.where(touch)[0]:
            if j-last>=5:ev+=1
            last=j
        if ev<TOUCHES_MIN:info.append(None);continue
        vr=np.nanmax(v[e-2:e+1]/v20[e-2:e+1]) if np.all(v20[e-2:e+1]>0) else np.nan
        if not(vr>=VOLX):info.append(None);continue
        pos=(y[e]-(fit[k][-1]-2*s[k]))/(4*s[k]);out[k]=True
        info.append(dict(slope_ann=float(b[k]*252),r2=float(r2[k]),band_low=float(np.exp(lb[-1])),band_mid=float(np.exp(fit[k][-1])),band_up=float(np.exp(fit[k][-1]+BAND*s[k])),prior_touches=int(ev),vol_ratio=float(vr),bounce_pct=float(c[e]/np.exp(rec)-1),adv20=float(adv[k]),chan_pos=float(pos)))
    return idx,out,info
def scan(df,asof=None):
    rows=[]
    for t,g in df.groupby("ticker"):
        g=g.sort_values("date").reset_index(drop=True)
        if asof is not None:g=g[g.date<=pd.Timestamp(asof)].reset_index(drop=True)
        r=signals_for(g)
        if r is None:continue
        idx,out,info=r
        if out[-1]:
            d=info[-1];d.update(ticker=t,date=str(g.date.iloc[-1].date()),close=float(g.close.iloc[-1]),tier=g.evidence_tier.iloc[-1],last_session_gap=0);rows.append(d)
    return pd.DataFrame(rows)
if __name__=="__main__":
    ap=argparse.ArgumentParser();ap.add_argument("--db",required=True);ap.add_argument("--out",required=True);ap.add_argument("--asof");a=ap.parse_args()
    df=load(a.db);last=df.date.max();s=scan(df,a.asof);os.makedirs(a.out,exist_ok=True)
    if len(s):s=s[s.date==str(last.date())].sort_values("vol_ratio",ascending=False)
    s.to_csv(os.path.join(a.out,"channel_bounce_candidates.csv"),index=False);print(len(s),"candidates on",last.date());print(s.to_string() if len(s) else "none")
