#!/usr/bin/env python3
"""Ascending-channel stocks with high liquidity: where each one sits in its channel NOW, plus whether a confirmed bounce (scanner rules) fired in the last 10 sessions.
Descriptive only. usage: channel_watchlist.py --db x.sqlite --out dir"""
import argparse,os,sys,pathlib
import numpy as np,pandas as pd
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import channel_bounce_scan as C
def main(a):
    df=C.load(a.db);rows=[];ser={}
    for t,g in df.groupby("ticker"):
        g=g.sort_values("date").reset_index(drop=True)
        if len(g)<C.L+30:continue
        r=C.signals_for(g);idx,out,info=r
        c=g.close.values.astype(float);v=np.nan_to_num(g.volume.values.astype(float));y=np.log(c);b,r2,s,fit,res=C.channel(y);k=-1
        adv=(c*v)[-20:].mean()
        if not(b[k]>0 and r2[k]>=C.R2MIN and b[k]*252>=C.ANN_MIN and adv>=C.ADV_MIN):continue
        ret=np.abs(np.diff(c)/c[:-1])[-C.L+1:];lows=np.log(g.low.values.astype(float))
        v20=pd.Series(v).rolling(20).mean().shift(1).values
        z=(y[-1]-fit[k][-1])/s[k];l3=(lows[-3:].min()-fit[k][-1])/s[k]
        rows.append(dict(ticker=t,last_date=str(g.date.iloc[-1].date()),tier=g.evidence_tier.iloc[-1],close=c[-1],adv20_mEGP=round(adv/1e6,1),slope_ann_pct=round(b[k]*252*100),r2=round(r2[k],2),
            band_low=round(float(np.exp(fit[k][-1]-C.BAND*s[k])),3),band_mid=round(float(np.exp(fit[k][-1])),3),band_up=round(float(np.exp(fit[k][-1]+C.BAND*s[k])),3),
            close_pos_sigma=round(z,2),low3_pos_sigma=round(l3,2),bounce_from_3d_low_pct=round((c[-1]/np.exp(lows[-3:].min())-1)*100,1),
            vol_ratio_last3=round(float(np.nanmax(v[-3:]/v20[-3:])),2),max_daily_move_90d_pct=round(ret.max()*100,1),data_hygiene_jump=bool(ret.max()>C.JUMP),
            confirmed_bounce_last10=int(out[-10:].sum())))
        ser[t]=(g,fit[k],s[k])
    w=pd.DataFrame(rows).sort_values("close_pos_sigma");os.makedirs(a.out,exist_ok=True);w.to_csv(os.path.join(a.out,"channel_watchlist.csv"),index=False)
    import matplotlib;matplotlib.use("Agg");import matplotlib.pyplot as plt
    n=len(w);cols=4;rws=int(np.ceil(n/cols));fig,ax=plt.subplots(rws,cols,figsize=(cols*4.2,rws*3));ax=np.atleast_2d(ax)
    for i,t in enumerate(w.ticker):
        g,f,s=ser[t];x=np.arange(C.L);a_=ax[i//cols][i%cols];gg=g.iloc[-C.L:]
        a_.plot(x,gg.close.values,lw=1.2,color="#1f4e79");a_.plot(x,np.exp(f),"--",color="#777",lw=.8);a_.plot(x,np.exp(f-C.BAND*s),color="#2e7d32",lw=.8);a_.plot(x,np.exp(f+C.BAND*s),color="#b71c1c",lw=.8)
        a_.set_title(f"{t}  pos={w.set_index('ticker').close_pos_sigma[t]}σ",fontsize=9);a_.tick_params(labelsize=6)
    for j in range(n,rws*cols):ax[j//cols][j%cols].axis("off")
    fig.suptitle("Ascending regression channels (90 sessions): green = lower band, red = upper band",fontsize=10);fig.tight_layout();fig.savefig(os.path.join(a.out,"channel_watchlist.png"),dpi=110)
    print(w.to_string())
if __name__=="__main__":
    ap=argparse.ArgumentParser();ap.add_argument("--db",required=True);ap.add_argument("--out",required=True);main(ap.parse_args())
