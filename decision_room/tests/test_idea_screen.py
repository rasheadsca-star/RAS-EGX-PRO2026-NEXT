import json,sys,unittest
from pathlib import Path
import numpy as np,pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"tools"))
import idea_screen as S
P=json.load(open(Path(__file__).resolve().parents[1]/"config/idea_screen_prereg_2026-11-06_AMENDMENT1.json"))["parameters"]
def mk(n=400,seed=1):
    rng=np.random.default_rng(seed);d=pd.bdate_range("2019-01-01",periods=n)
    cl=pd.DataFrame(10*np.exp(np.cumsum(rng.normal(0,.01,(n,8)),0)),index=d,columns=list("ABCDEFGH"))
    vo=pd.DataFrame(rng.integers(1e6,2e6,(n,8)).astype(float),index=d,columns=cl.columns);return cl,vo
class T(unittest.TestCase):
    def test_signal_ignores_future(self):
        cl,vo=mk();k=300;_,_,e1,s1=S.features(cl,vo,P)
        cl2=cl.copy();cl2.iloc[k+1:]*=7;vo2=vo.copy();vo2.iloc[k+1:]*=0.01
        _,_,e2,s2=S.features(cl2,vo2,P)
        for i in s1:self.assertTrue((s1[i][0].iloc[:k+1]==s2[i][0].iloc[:k+1]).all().all(),i)
        self.assertTrue((e1.iloc[:k+1]==e2.iloc[:k+1]).all().all())
    def test_big_future_return_kept_not_filtered(self):
        cl,vo=mk();_,adv,el,_=S.features(cl,vo,P);mask=pd.DataFrame(False,index=cl.index,columns=cl.columns);mask.iloc[100:110,0]=True
        el[:]=True;cl.iloc[106:,0]*=3;log=[];s,e=cl.index[0],cl.index[-1]
        r=S.event_stats(cl,adv,el,mask,5,s,e,P,"X",log);self.assertGreaterEqual(r["big_return_kept"],1)
        self.assertEqual(r["missing"],0)
    def test_rsi_no_loss(self):
        cl=pd.DataFrame({"A":np.arange(1,30.)});self.assertEqual(S.rsi_n(cl,5)["A"].iloc[-1],100.0)
        self.assertTrue(np.isnan(S.rsi_n(pd.DataFrame({"A":np.ones(30)}),5)["A"].iloc[-1]))
    def test_missing_counted_and_blocks(self):
        cl,vo=mk();_,adv,el,_=S.features(cl,vo,P);el[:]=True;mask=pd.DataFrame(False,index=cl.index,columns=cl.columns)
        mask.iloc[100,0]=True;mask.iloc[103,0]=True;cl.iloc[106,0]=np.nan;log=[]
        r=S.event_stats(cl,adv,el,mask,5,cl.index[0],cl.index[-1],P,"X",log)
        self.assertEqual(r["missing"],1);self.assertEqual(sum(1 for z in log if z[3]=="MISSING_OUTCOME"),1)
    def test_boot_refuses_nan(self):
        with self.assertRaises(ValueError):S.boot([np.nan,1,2],["a","b","c"],P)
if __name__=="__main__":unittest.main()
