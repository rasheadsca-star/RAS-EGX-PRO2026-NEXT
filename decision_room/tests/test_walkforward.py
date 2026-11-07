import sys,pathlib,sqlite3,tempfile,os
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/"tools"))
import numpy as np,walkforward as wf
def _db(path):
    c=sqlite3.connect(path);c.execute("create table canonical_bars(ticker,date,price_basis,open,high,low,close,volume)")
    import datetime
    d=datetime.date(2020,1,1);rng=np.random.default_rng(0);p=100.0;rows=[]
    for _ in range(400):
        while d.weekday() in(4,5):d+=datetime.timedelta(1)
        r=rng.normal(0.001,0.01);o=p;p=p*(1+r);rows.append(("X",d.isoformat(),"RAW",o,max(o,p)*1.005,min(o,p)*0.995,p,1_000_000))
        d+=datetime.timedelta(1)
    c.executemany("insert into canonical_bars values(?,?,?,?,?,?,?,?)",rows);c.commit();c.close()
def test_runs_and_is_deterministic():
    with tempfile.TemporaryDirectory() as t:
        db=os.path.join(t,"d.sqlite");_db(db)
        a=os.path.join(t,"a.json");b=os.path.join(t,"b.json")
        wf.main(["--db",db,"--out",a,"--oos-start","2021-01-01"]);wf.main(["--db",db,"--out",b,"--oos-start","2021-01-01"])
        assert open(a).read()==open(b).read()
def test_costs_reduce_net():
    with tempfile.TemporaryDirectory() as t:
        db=os.path.join(t,"d.sqlite");_db(db);df=wf.load(db);r=wf.signals(df,"2020-03-01","2021-12-31",False)
        assert wf.summarize(r,0.0)["mean_net_pct"]>wf.summarize(r,0.0096)["mean_net_pct"]

if __name__=="__main__":
    fs=[(k,v) for k,v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for k,v in fs:v();print("ok",k)
    print(f"{len(fs)} tests passed")
