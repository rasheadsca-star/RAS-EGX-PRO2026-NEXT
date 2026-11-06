import sys,pathlib,sqlite3,tempfile,json,os
import numpy as np,pandas as pd
R=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(R/"tools"))
import strategy_holdout as S
def frame(seed=1,n=420,k=6):
    rng=np.random.default_rng(seed);rows=[];dates=pd.bdate_range("2023-01-02",periods=n)
    for t in range(k):
        c=100*np.exp(np.cumsum(rng.normal(0,0.012,n)))
        for i,d in enumerate(dates):rows.append(dict(ticker=f"T{t}",date=d,open=c[i],high=c[i]*1.01,low=c[i]*0.99,close=c[i],volume=1e6))
    return pd.DataFrame(rows)
def test_capacity_cap_and_costs():
    r=pd.DataFrame(dict(ticker=["A","B"],date=pd.to_datetime(["2025-01-02","2025-01-03"]),gross=[0.05,0.05],adv=[1e9,1e6],hold=[5,5]))   # B: 250k/1M=25% > 5% cap
    ok,rt=S.cost(r,1);assert list(ok)==[True,False]
    s=S.summarize(r);assert s["n"]==1 and abs(s["mean_cost_pct"]-(2*(0.0018+0.003)*100))<0.05   # A: impact ~0
def test_breakout_has_no_lookahead():
    df=frame();cut=df[df.date<=pd.Timestamp("2024-03-01")]
    a=S.rows_A(df,"2023-06-01","2024-12-31");b=S.rows_A(cut,"2023-06-01","2024-12-31")
    keep=a[a.date<=pd.Timestamp("2023-11-30")]    # trades that end well before the cut must not depend on later bars
    m=keep.merge(b,on=["ticker","date"],suffixes=("","_cut"));assert len(m)==len(keep) and np.allclose(m.gross,m.gross_cut)
def test_noise_selects_nothing():
    with tempfile.TemporaryDirectory() as t:
        df=frame(3,1500,8);df=df[df.date.dt.year>=2000]
        import walkforward as W
        db=t+"/d.sqlite";c=sqlite3.connect(db);c.execute("create table canonical_bars(ticker,date,price_basis,open,high,low,close,volume)")
        c.executemany("insert into canonical_bars values(?,?,'RAW',?,?,?,?,?)",[(r.ticker,r.date.strftime("%Y-%m-%d"),r.open,r.high,r.low,r.close,r.volume) for r in df.itertuples()]);c.commit();c.close()
        pre=t+"/p.json";json.dump({"periods":{"development":["2024-01-01","2026-12-31"],"holdout":["2027-01-01","2028-12-31"]}},open(pre,"w"))
        S.main(["--db",db,"--prereg",pre,"--out",t+"/o.json"]);o=json.load(open(t+"/o.json"))
        assert o["holdout_pass"] is False and o["decision"]=="NO_STRATEGY_APPROVED"
if __name__=="__main__":
    fs=[(k,v) for k,v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for k,v in fs:v();print("ok",k)
    print(len(fs),"tests passed")
