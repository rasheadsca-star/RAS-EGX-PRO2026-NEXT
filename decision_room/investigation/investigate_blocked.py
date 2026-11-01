#!/usr/bin/env python3
"""Root-cause investigation of blocked symbols. READ-ONLY. Does not change any gate. usage: investigate_blocked.py <db> <outdir>"""
import sys,sqlite3,json,collections,pandas as pd,numpy as np
import pathlib;sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent/'repo'))
from egx_decision.ingest import load
from egx_decision.quality import evaluate
from egx_decision import config as K
db,out=sys.argv[1:3]
d=load(db);res,nb,sess=evaluate(d);cal=d["calendar"][d["calendar"]<=sess];c51=cal[-K.WIN51:]
con=sqlite3.connect(f"file:{db}?mode=ro",uri=True)
obs=pd.read_sql("select ticker,date,provider_family,source_id,valid,close from raw_observations",con);obs["date"]=pd.to_datetime(obs["date"])
cf=pd.read_sql("select ticker,date,pct_diff,resolution from conflicts",con);cf["date"]=pd.to_datetime(cf["date"])
off=pd.read_sql("select ticker,resolution_status from official_session where session_date='2026-11-01'",con)
bl=res[~res.passed]
rows=[];gapcat=collections.Counter();pct=[]
for _,q in bl.iterrows():
    t=q.ticker;g=d["bars"][d["bars"].ticker==t].date
    have=set(g);miss=[x for x in c51 if x not in have]
    o=obs[obs.ticker==t];last=g.max()
    later=o[o.date>last]
    cat=collections.Counter()
    for x in miss:
        ox=o[o.date==x];c=cf[(cf.ticker==t)&(cf.date==x)]
        if len(c):cat["CONFLICT_WITHHELD"]+=1;pct+= [abs(v) for v in c.pct_diff]
        elif len(ox)==0:cat["NO_OBSERVATION_ANY_SOURCE"]+=1
        elif (ox.valid==0).all():cat["OBS_REJECTED_INVALID"]+=1
        else:cat["OBS_PRESENT_NOT_CANONICAL"]+=1
    for k,v in cat.items():gapcat[k]+=v
    stale=g.max()!=sess
    rows.append(dict(ticker=t,last_canonical=last.date().isoformat(),stale=stale,missing_51=len(miss),**{f"gap_{k}":v for k,v in cat.items()},
        obs_after_last_canonical=len(later),sources_after=",".join(sorted(set(later.provider_family))) if len(later) else "",
        in_official_1101=bool(t in set(off.ticker.dropna())),reasons="; ".join(x.split(":")[0] for x in q.reasons)))
df=pd.DataFrame(rows).fillna(0);df.to_csv(out+"/blocked_root_cause.csv",index=False)
# classify primary root cause per symbol
def cause(r):
    if r.stale and r.obs_after_last_canonical==0:return "A_STALE_NO_SOURCE_DATA_AFTER_LAST_BAR (likely suspended/delisted/unsupported by sources)"
    if r.stale and r.obs_after_last_canonical>0:return "B_STALE_BUT_RAW_OBS_EXIST (canonicalisation/conflict problem)"
    if r.get("gap_CONFLICT_WITHHELD",0)>0 and r.get("gap_NO_OBSERVATION_ANY_SOURCE",0)==0:return "C_GAPS_ONLY_FROM_PROVIDER_CONFLICTS"
    if r.get("gap_NO_OBSERVATION_ANY_SOURCE",0)>0 and r.get("gap_CONFLICT_WITHHELD",0)==0:return "D_GAPS_NO_OBSERVATION (no-trade days or provider holes)"
    if r.get("gap_NO_OBSERVATION_ANY_SOURCE",0)>0:return "E_MIXED_CONFLICT_AND_NO_OBSERVATION"
    return "F_NO_GAP_OTHER_GATE (liquidity/jump/OHLC)"
df["root_cause"]=df.apply(cause,axis=1);df.to_csv(out+"/blocked_root_cause.csv",index=False)
summ=dict(blocked=len(df),by_root_cause=df.root_cause.value_counts().to_dict(),gap_dates_by_category=dict(gapcat),
  conflict_abs_pct_diff=dict(n=len(pct),median=round(float(np.median(pct)),3) if pct else None,p90=round(float(np.percentile(pct,90)),3) if pct else None,share_le_1_5=round(float(np.mean(np.array(pct)<=1.5)),3) if pct else None),
  stale_symbols=int(df.stale.sum()),stale_in_official_1101=int(((df.stale)&(df.in_official_1101)).sum()))
# JUMP events concentration
c=d["bars"].pivot(index="date",columns="ticker",values="close").reindex(c51).pct_change(fill_method=None);big=(c.abs()>K.MAX_ABS_RET_1D)
byday=big.sum(axis=1);byday=byday[byday>0]
summ["jump_events_by_day"]={k.date().isoformat():int(v) for k,v in byday.items()}
summ["market_ew_return_on_jump_days"]={k.date().isoformat():round(float(c.mean(axis=1).loc[k]),4) for k in byday.index}
# provider coverage of recent sessions: how many symbols have >=1 obs per date (last 10 sessions) vs canonical
cov=[]
for x in c51[-10:]:
    ob=obs[(obs.date==x)];cb=d["bars"][d["bars"].date==x]
    cov.append(dict(date=x.date().isoformat(),symbols_with_any_obs=int(ob.ticker.nunique()),symbols_with_canonical=int(cb.ticker.nunique()),
        symbols_conflict_withheld=int(cf[cf.date==x].ticker.nunique()),yahoo=int(ob[ob.provider_family=="yahoo"].ticker.nunique()),mubasher=int(ob[ob.provider_family=="mubasher"].ticker.nunique())))
summ["recent_session_coverage"]=cov
json.dump(summ,open(out+"/blocked_investigation_summary.json","w"),ensure_ascii=False,indent=1);print(json.dumps(summ,ensure_ascii=False,indent=1))
