"""Research-only, unrounded scenarios. Never an executable signal."""
import math

def propose(g, ind):
    """Use only data through the current session. No future candles or order generation."""
    status="PAPER_SCENARIO_UNVALIDATED"
    blocked=dict(status=status, tradable=False, tick_verified=False, scenarios=[],
        note="لا مستويات تنفيذ معتمدة؛ حسابات بحثية غير مقرّبة لخطوة السعر. لا أوامر أو توصية شراء.")
    if len(g)<55 or not ind.get("trend") or ind.get("adv20",0)<1_000_000:
        return blocked
    closes=[float(x) for x in g["close"].iloc[-55:]]
    if not all(math.isfinite(v) and v>0 for v in closes):return blocked
    last=closes[-1]
    # The newest bar is excluded from reference levels to avoid self-reference.
    prior20=max(closes[-21:-1])
    prior10low=min(closes[-11:-1])
    recent10low=min(closes[-10:])
    plans=[]
    for mode,entry,stop in (
        ("اختراق إغلاق 20 جلسة سابق",prior20,prior10low),
        ("ارتداد افتراضي قرب MA20",float(ind["ma20"]),recent10low),
    ):
        # No fill assumption, no limit-up feasibility, no official tick-size evidence.
        risk=entry-stop
        if not (0<risk<=0.12*entry) or not math.isfinite(entry):continue
        plans.append(dict(type=mode,entry_raw=round(entry,5),stop_raw=round(stop,5),
                          target1_raw=round(entry+1.5*risk,5),target2_raw=round(entry+2.5*risk,5),
                          distance_from_close_pct=round((entry/last-1)*100,2),
                          rr_target1=1.5,rr_target2=2.5,
                          executable=False,verified_tick=False,
                          assumptions="نطاق مرجعي من أسعار الإغلاق RAW؛ لا تحقق من خطوة السعر أو حدود الحركة أو التنفيذ والتكاليف"))
    return dict(blocked,scenarios=plans)
