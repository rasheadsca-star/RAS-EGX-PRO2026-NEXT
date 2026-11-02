"""Conservative screening-only execution checks. Not an exchange execution model."""
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
def tick_round(price,tick,side):
    if tick is None or float(tick)<=0:raise ValueError("TICK_UNVERIFIED")
    p=Decimal(str(price));t=Decimal(str(tick))
    if p<=0:raise ValueError("INVALID_PRICE")
    rounding=ROUND_CEILING if side=="entry" else ROUND_FLOOR
    return float((p/t).to_integral_value(rounding=rounding)*t)
def cost_stress(entry,stop,target,order_egp,fee_rate=.0018,slip_rate=.003,fixed_per_side=2.0):
    """Buy high/sell low; fees both sides, proportional slip, fixed charge per side."""
    if min(entry,stop,target,order_egp)<=0:raise ValueError("INVALID_INPUT")
    qty=order_egp/entry
    buy=entry*(1+slip_rate)
    sell_stop=stop*(1-slip_rate)
    sell_target=target*(1-slip_rate)
    buy_fee=fixed_per_side + qty*buy*fee_rate
    def net(exit_px):
        return qty*(exit_px-buy)-buy_fee-(fixed_per_side+qty*exit_px*fee_rate)
    return dict(stop_net_egp=round(net(sell_stop),2),
                target_net_egp=round(net(sell_target),2),
                fee_assumption="0.18% per side plus EGP2 per side; verify actual Thndr tariff",
                slip_assumption="0.30% per side; also test 0.45%",
                validated=False)
def verification_gate(ticker,session,tick_records):
    """Only dated, verified ticker-specific tick records qualify; default is unknown."""
    record=next((r for r in tick_records if r.get("ticker")==ticker and r.get("session")==session and r.get("official_verified") is True),None)
    if not record:return {"tick_verified":False,"reason":"NO_OFFICIAL_DATED_TICK_RECORD"}
    return {"tick_verified":True,"tick":record["tick"],"source":record.get("source")}
