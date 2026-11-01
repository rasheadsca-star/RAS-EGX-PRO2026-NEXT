"""Per-ticker fail-closed gate with itemised reasons. Score never overrides a gate."""
import numpy as np,pandas as pd
from . import config as K
def evaluate(data,session=None):
    bars,cal=data["bars"],data["calendar"]
    session=pd.Timestamp(session) if session is not None else cal[-1]
    cal=cal[cal<=session]
    c20=cal[-K.WIN20:];c51=cal[-K.WIN51:]
    conf=data["conflicts"].assign(date=lambda d:pd.to_datetime(d["date"]))
    ca=data["corp"].assign(date=lambda d:pd.to_datetime(d["date"]))
    out=[]
    known=set(bars["ticker"].unique())
    for t,g in bars[bars["date"]<=session].groupby("ticker"):
        g=g.sort_values("date").drop_duplicates("date",keep="last").set_index("date")
        why=[];info=dict(ticker=t)
        info["last_date"]=g.index.max().date().isoformat()
        if g.index.max()!=session:
            gap=int((cal>g.index.max()).sum());why.append(f"STALE: آخر شمعة {info['last_date']} (متأخرة {gap} جلسة)")
        w51=g.reindex(c51);w20=g.reindex(c20)
        miss20=[d for d in c20 if pd.isna(w20.loc[d,"close"])]
        miss51=[d for d in c51 if pd.isna(w51.loc[d,"close"])]
        if miss20 or miss51:
            cd=set(conf[(conf.ticker==t)]["date"]);cause=[]
            for d in (miss20 or miss51):cause.append("شمعة محجوبة بسبب تعارض مصادر" if d in cd else "لا توجد ملاحظة")
            why.append(f"CALENDAR_GAP: {len(miss20)} فجوة في آخر 20 و{len(miss51)} في آخر 51 ({'؛'.join(sorted(set(cause)))})")
        if len(g)<K.MIN_BARS:why.append("HISTORY: أقل من 51 جلسة")
        av=w20.dropna(subset=["close"]);adv=0.0
        if len(av):
            vv=av["volume"].fillna(0)
            adv=float((av["close"]*vv).mean())
            if (vv>0).sum()<K.MIN_VOLUME_DAYS_20*len(av)/K.WIN20:why.append(f"NO_TRADING: أيام التداول {(vv>0).sum()} من {len(av)} شمعة متاحة")
            if av["close"].nunique()==1 and len(av)>=K.WIN20//2:why.append("FLAT_PRICE: سعر ثابت طوال الشموع المتاحة")
            if adv<K.MIN_ADV20_EGP:why.append(f"LIQUIDITY: ADV20={adv:,.0f} أقل من 1,000,000 جنيه")
            bad=av[(av["high"]<av[["open","close"]].max(axis=1))|(av["low"]>av[["open","close"]].min(axis=1))|(av["low"]<=0)]
            if len(bad):why.append("OHLC: شمعة غير متسقة في "+"، ".join(d.date().isoformat() for d in bad.index[:3]))
        info["adv20"]=adv
        cc=conf[(conf.ticker==t)&(conf.date.isin(c51))]
        if len(cc):why.append(f"CONFLICT: {len(cc)} تعارض سعر داخل نافذة التحليل")
        ee=ca[(ca.ticker==t)&(ca.date>=c51[0])&(ca.date<=session)]
        if len(ee):why.append(f"CORPORATE_ACTION: {len(ee)} حدث داخل نافذة التحليل ({'، '.join(sorted(set(ee['status'])))})")
        r=w51["close"].pct_change(fill_method=None).abs()
        if (r>K.MAX_ABS_RET_1D).any():why.append("JUMP: حركة يومية >11% داخل النافذة غير محسومة")
        info["reasons"]=why;info["passed"]=not why
        out.append(info)
    res=pd.DataFrame(out)
    # symbols known in registry but without any RAW bar
    reg=set(data["ident"]["ticker"])-known
    return res,sorted(reg),session
def waterfall(res,no_bars):
    order=["STALE","CALENDAR_GAP","HISTORY","NO_TRADING","FLAT_PRICE","LIQUIDITY","OHLC","CONFLICT","CORPORATE_ACTION","JUMP"]
    w={"registry_symbols":len(res)+len(no_bars),"with_bars":len(res),"without_any_bar":len(no_bars),"passed":int(res["passed"].sum()),"blocked":int((~res["passed"]).sum())}
    first={k:0 for k in order};anyr={k:0 for k in order}
    for rs in res["reasons"]:
        tags=[x.split(":")[0] for x in rs]
        for k in order:
            if k in tags:anyr[k]+=1
        for k in order:
            if k in tags:first[k]+=1;break
    w["first_blocking_reason"]=first;w["any_reason"]=anyr
    return w
