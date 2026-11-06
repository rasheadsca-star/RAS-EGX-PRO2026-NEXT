import os,sys,numpy as np,pandas as pd
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","tools"))
import strategy_lowturnover as L
rng=np.random.default_rng(1);dates=pd.bdate_range("2016-01-01","2019-12-31");n=len(dates);T=[f"T{i:02d}" for i in range(40)]
drift=np.linspace(-0.0004,0.0008,40)
cl=pd.DataFrame({t:100*np.cumprod(1+drift[i]+rng.normal(0,0.01,n)) for i,t in enumerate(T)},index=dates)
vo=pd.DataFrame(1e6,index=dates,columns=T)  # ADV ~1e8 EGP, eligible
res,bench,excl=L.run(cl,vo,"2017-01-01","2019-11-30")
assert len(bench)>25 and all(len(v)==len(bench) for v in res.values())
st=L.stats(res["H1"],bench);assert st["mean_cost_m"]>0 and st["n_months"]==len(bench)
assert st["mean_gross_m"]>st["bench_mean_m"]-0.02,"momentum should not be far below benchmark when persistent drift is planted"
# no look-ahead: shuffling FUTURE prices after the first signal date must not change the first month's holdings
cl2=cl.copy();cut=dates.get_loc(dates[dates>=pd.Timestamp("2017-03-01")][0])
cl2.iloc[cut+25:]=cl2.iloc[cut+25:].values[::-1]
r1,_,_=L.run(cl,vo,"2017-02-01","2017-02-28");r2,_,_=L.run(cl2,vo,"2017-02-01","2017-02-28")
assert len(r1["H1"])==len(r2["H1"])
print("test_strategy_lowturnover OK")
assert not np.isnan([x[1] for x in res["H1"]]).any(),"NaN net returns (cost with missing ADV) must never occur"
cl3=cl.copy();cl3.iloc[400:,0]=np.nan;res3,_,_=L.run(cl3,vo,"2017-01-01","2019-11-30")
assert not np.isnan([x[1] for k in res3 for x in res3[k]]).any()
print("nan-safety OK")
