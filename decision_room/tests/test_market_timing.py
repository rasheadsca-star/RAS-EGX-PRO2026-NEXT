import sys,unittest
from pathlib import Path
import numpy as np,pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"tools"))
import market_timing as M
def mk(n=700,seed=2):
    rng=np.random.default_rng(seed);d=pd.bdate_range("2017-01-02",periods=n)
    cl=pd.DataFrame(10*np.exp(np.cumsum(rng.normal(0.0003,.01,(n,40)),0)),index=d,columns=[f"T{i}" for i in range(40)])
    return cl,pd.DataFrame(2e6,index=d,columns=cl.columns)
class T(unittest.TestCase):
    def test_position_ignores_future(self):
        cl,vo=mk();k=500;r,imp,_=M.index_and_cost(cl,vo)
        cl2=cl.copy();cl2.iloc[k+1:]*=0.2;r2,imp2,_=M.index_and_cost(cl2,vo)
        s,e=pd.Timestamp("2017-01-01"),pd.Timestamp("2030-01-01")
        p1=M.run_rule(r,imp,200,s,e)[5];p2=M.run_rule(r2,imp2,200,s,e)[5]
        # exposure on day d depends on signal at d-2: positions through k+1 must match
        i=r.index
        a=p1[p1.index<=i[k]];b=p2.reindex(a.index);self.assertGreater(len(a),50);self.assertTrue((a==b).all())
    def test_artefact_excluded_not_clipped(self):
        cl,vo=mk();cl.iloc[300:,0]*=0.5;r,imp,info=M.index_and_cost(cl,vo)
        self.assertGreaterEqual(info["artefact_name_days_excluded"],1)
    def test_switch_cost_charged(self):
        cl,vo=mk();r,imp,_=M.index_and_cost(cl,vo);o=M.run_rule(r,imp,200,pd.Timestamp("2017-01-01"),pd.Timestamp("2030-01-01"))
        self.assertGreater(o[4],0);self.assertTrue(np.isfinite(o[1]).all())
if __name__=="__main__":unittest.main()
