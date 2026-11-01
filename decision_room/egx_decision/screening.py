"""Indicators on RAW closes known at the session close. No look-ahead: every window ends at `session`."""
import numpy as np,pandas as pd
from . import config as K
def indicators(g,session):
    w=g.iloc[-K.MIN_BARS:]
    p=w["close"].values;v=w["volume"].fillna(0).values
    last=float(p[-1]);ma20=float(p[-20:].mean());ma50=float(p[-50:].mean())
    mom5=(last/p[-6]-1)*100;mom20=(last/p[-21]-1)*100
    volref=v[-21:-1].mean();rel=float(v[-1]/volref) if volref>0 else 0.0
    rets=np.diff(p[-21:])/p[-21:-1];vol20=float(rets.std(ddof=1)*100)
    adv=float((w["close"]*w["volume"].fillna(0)).iloc[-20:].mean())
    trend=bool(last>ma20>ma50 and mom20>0)
    score=round(max(0,min(100,40+(16 if last>ma20 else -12)+(12 if ma20>ma50 else -8)+max(-18,min(18,mom20*0.8))+max(-8,min(10,(rel-1)*8)))))
    return dict(last=last,ma20=round(ma20,4),ma50=round(ma50,4),momentum5=round(mom5,2),momentum20=round(mom20,2),relativeVolume=round(rel,2),
        volatility20_pct=round(vol20,2),adv20=round(adv,0),max_order_egp=round(adv*K.MAX_ORDER_ADV_FRAC,0),trend=trend,score=score,
        history=[dict(date=d.date().isoformat(),close=float(c)) for d,c in w["close"].iloc[-75:].items()] if len(w)>=1 else [])
def reasons(ind,tier):
    r=[("اتجاه صاعد: السعر أعلى MA20 وMA50 وزخم 20 جلسة موجب" if ind["trend"] else "الاتجاه غير صاعد"),
       f"زخم 5 جلسات {ind['momentum5']:+.1f}% و20 جلسة {ind['momentum20']:+.1f}%",
       f"تأكيد الحجم: {ind['relativeVolume']:.2f}× المتوسط (يتطلب ≥1.0× للتأكيد)",
       f"سيولة: ADV20 ≈ {ind['adv20']:,.0f} جنيه، وأقصى أمر ≈ {ind['max_order_egp']:,.0f} جنيه (1%)",
       f"مخاطرة: تذبذب يومي 20 جلسة ≈ {ind['volatility20_pct']:.2f}%",
       f"جودة المصدر: {tier}"]
    return r
