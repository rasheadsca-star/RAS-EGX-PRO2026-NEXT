"""H1 market-state filter (experimental, FORWARD_TEST_ONLY). Frozen rule: equal-weight liquid basket vs SMA100.
Not a trade recommendation. If its date does not match the data session, state is UNKNOWN (fail closed)."""
import pandas as pd
from . import config as K
def compute(data,session):
    b=data["bars"];cal=data["calendar"];cal=cal[cal<=pd.Timestamp(session)]
    if len(cal)<121:return dict(state="UNKNOWN",reason="أقل من 121 جلسة")
    b=b[b["date"].isin(cal)]
    c=b.pivot(index="date",columns="ticker",values="close").reindex(cal)
    v=b.pivot(index="date",columns="ticker",values="volume").reindex(cal)
    adv=(c*v).rolling(20,min_periods=20).mean();elig=adv.shift(1)>=K.MIN_ADV20_EGP
    r=c.pct_change(fill_method=None).where(elig).clip(-K.MAX_ABS_RET_1D,K.MAX_ABS_RET_1D).mean(axis=1).fillna(0.0)
    L=(1+r).cumprod();ma=L.rolling(100,min_periods=100).mean()
    if pd.isna(ma.iloc[-1]):return dict(state="UNKNOWN",reason="SMA100 غير متاح")
    sig=bool(L.iloc[-1]>ma.iloc[-1])
    return dict(state="IN_MARKET" if sig else "CASH",session=cal[-1].date().isoformat(),index_level=round(float(L.iloc[-1]),4),
        sma100=round(float(ma.iloc[-1]),4),eligible_universe=int(elig.iloc[-1].sum()),
        status=K.H1_STATUS_ALLOWED,orders_enabled=False,signal_is_trade_recommendation=False,
        effective_from="الجلسة t+2 (الإشارة عند إغلاق t، الدخول عند إغلاق t+1)",
        evidence=dict(train_ok=True,validation_ok=True,holdout="غير معتمد: عائد H1 +51.2% مقابل +105.3% للسوق وسحب 32.2% مقابل 30.9% (فترة مكشوفة معلوماتية)"),
        limitations=["تحيز البقاء","تكلفة إعادة موازنة السلة غير محسوبة","مصدر واحد غالبًا","عدد التبديلات قليل (13–21)"])
def validate_external(status_json,session):
    """Cross-check an externally supplied H1 status file against the data session."""
    if status_json.get("latest_benchmark_session")!=session:return "UNKNOWN"
    if status_json.get("status")!=K.H1_STATUS_ALLOWED:return "UNKNOWN"
    s=status_json.get("signal_at_last_close")
    return s if s in("CASH","IN_MARKET") else "UNKNOWN"
