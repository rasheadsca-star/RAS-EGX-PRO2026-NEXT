import os,sys,numpy as np,pandas as pd
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","tools"))
import strategy_lowturnover as L
rng=np.random.default_rng(1);dates=pd.bdate_range("2016-01-01","2019-12-31");n=len(dates);T=[f"T{i:02d}" for i in range(40)]
drift=np.linspace(-0.0004,0.0008,40)
cl=pd.DataFrame({t:100*np.cumprod(1+drift[i]+rng.normal(0,0.01,n)) for i,t in enumerate(T)},index=dates)
vo=pd.DataFrame(1e6,index=dates,columns=T)
res,bench,info=L.run(cl,vo,"2017-01-01","2019-11-30")
assert len(bench)>25 and all(len(v)==len(bench) for v in res.values())
st=L.stats(res["H1"],bench);assert st["mean_cost_m"]>0 and st["n_months"]==len(bench)
assert not np.isnan([x[1] for k in res for x in res[k]]).any()
# EX-ANTE: changing prices AFTER the entry day (jump / NaN in the holding window) must not change selected names at t
me=[k for k in range(len(dates)-1) if dates[k].month!=dates[k+1].month]
a=[k for k in me if dates[k]>=pd.Timestamp("2017-06-01")][0];b=[k for k in me if k>a][0]
r0,_,_=L.run(cl,vo,str(dates[a].date()),str(dates[a].date()))
cl2=cl.copy()
for t in T[::2]:cl2.iloc[a+3:b+1,cl2.columns.get_loc(t)]*=1.5          # >11.5% jump inside holding window
for t in T[1::4]:cl2.iloc[a+5:,cl2.columns.get_loc(t)]=np.nan         # disappear after entry
r1,_,_=L.run(cl2,vo,str(dates[a].date()),str(dates[a].date()))
for k in r0:
    assert len(r0[k])==1 and len(r1[k])==1
    assert r0[k][0][5]==r1[k][0][5] and len(r0[k][0][5])>0,f"{k}: selection at t changed when only the future changed (look-ahead)"
# missing future bars: unfilled entries counted, no NaN
cl3=cl.copy();cl3.iloc[a+1,:]=np.nan;_,_,i3=L.run(cl3,vo,str(dates[a].date()),str(dates[a].date()));assert i3['unfilled_entries']>0
# non-finite series must be refused by the bootstrap
try:L.boot([0.1,float("nan"),0.2,0.1]);raise SystemExit("should refuse")
except ValueError:pass
print("test_strategy_lowturnover OK")
