"""Official-tier bars: open outside Min/Max is NOT an OHLC fault; the same shape from a non-official provider IS."""
import sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import pandas as pd
from egx_decision import quality
def data(tier,close=10.0,low=10.2):
    cal=pd.bdate_range("2026-08-01",periods=60);rows=[]
    for i,d in enumerate(cal):
        rows.append(dict(ticker="T",date=d,open=10.0,high=10.5,low=9.8,close=10.1,volume=1_000_000,evidence_tier="SINGLE_PROVIDER"))
    rows[-1].update(open=9.9,low=low,high=10.6,close=close if False else 10.4,evidence_tier=tier)
    return dict(bars=pd.DataFrame(rows),calendar=cal,conflicts=pd.DataFrame(columns=["ticker","date","kind","resolution"]),corp=pd.DataFrame(columns=["ticker","date","status","raw_change_pct"]),ident=pd.DataFrame({"ticker":["T"]}))
def reasons(tier,**k):
    res,_,_=quality.evaluate(data(tier,**k));return [r for r in res.iloc[0]["reasons"] if r.startswith("OHLC")]
def test_official_open_below_low_ok():assert reasons("OFFICIAL_EGX")==[]
def test_non_official_same_shape_flagged():assert reasons("SINGLE_PROVIDER")!=[]
def test_official_close_outside_range_still_flagged():
    d=data("OFFICIAL_EGX");d["bars"].loc[d["bars"].index[-1],"close"]=11.0
    res,_,_=quality.evaluate(d);assert any(r.startswith("OHLC") for r in res.iloc[0]["reasons"])
if __name__=="__main__":
    fs=[(k,v) for k,v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for k,v in fs:v();print("ok",k)
    print(f"{len(fs)} tests passed")
