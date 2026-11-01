#!/usr/bin/env python3
"""DIAGNOSTIC ONLY (never used for the published snapshot). Counts how many currently-blocked symbols would pass if two gate
policies were relaxed, so the owner/reviewer can decide with evidence. usage: whatif.py <db>"""
import sys,sqlite3,json,pandas as pd
sys.path.insert(0,__file__.rsplit('/tools/',1)[0])
from egx_decision.ingest import load
from egx_decision.quality import evaluate
from egx_decision import config as K
db=sys.argv[1];d=load(db);res,_,sess=evaluate(d);cal=d["calendar"][d["calendar"]<=sess];c51=cal[-K.WIN51:]
con=sqlite3.connect(f"file:{db}?mode=ro",uri=True)
cf=pd.read_sql("select ticker,date,pct_diff from conflicts",con);cf["date"]=pd.to_datetime(cf["date"])
tag=lambda r:{x.split(":")[0] for x in r}
out={"strict_passed":int(res.passed.sum())}
# P1: tolerate cross-provider close disagreement <=1.5% (both observations stay visible; canonical bar still withheld => use mid only for screening)
tol=0
ex=[]
for _,q in res[~res.passed].iterrows():
    tg=tag(q.reasons)
    if not tg<= {"CALENDAR_GAP","CONFLICT"} or not tg:continue
    c=cf[(cf.ticker==q.ticker)&(cf.date.isin(c51))]
    g=d["bars"][(d["bars"].ticker==q.ticker)&(d["bars"].date.isin(c51))].date
    missing=set(c51)-set(g)
    if missing<=set(c.date) and (c.pct_diff.abs()<=1.5).all():tol+=1;ex.append(q.ticker)
out["P1_conflict_tolerance_1_5pct_would_add"]=tol;out["P1_examples"]=ex[:15]
# P2: jump judged relative to the market (|ret - EW market ret| > 11%) instead of absolute
b=d["bars"];c=b.pivot(index="date",columns="ticker",values="close").reindex(cal).pct_change(fill_method=None)
mk=c.mean(axis=1);add=[]
for _,q in res[~res.passed].iterrows():
    if tag(q.reasons)!={"JUMP"}:continue
    r=c.loc[c51,q.ticker];resid=r.sub(mk.loc[c51])
    if (resid.abs()<=K.MAX_ABS_RET_1D).all():add.append(q.ticker)
out["P2_market_relative_jump_would_add"]=len(add);out["P2_examples"]=add[:15]
out["market_worst_day_in_window"]=[mk.loc[c51].idxmin().date().isoformat(),round(float(mk.loc[c51].min()),4)]
print(json.dumps(out,ensure_ascii=False,indent=1))
