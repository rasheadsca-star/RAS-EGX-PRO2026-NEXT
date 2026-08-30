from __future__ import annotations

import hashlib, json, math
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from statistics import median

LABELS = ("TARGET_BEFORE_STOP", "STOP_BEFORE_TARGET", "TIME_EXIT", "NO_ENTRY")
DECISIONS = {"BUY_CANDIDATE", "WAIT", "VETO", "NO_TRADE", "DATA_BLOCKED"}

def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

def finite(value, default=None):
    try:
        value=float(value)
        return value if math.isfinite(value) else default
    except (TypeError, ValueError): return default

def valid_session(row):
    try: datetime.strptime(row["date"], "%Y-%m-%d")
    except (KeyError, TypeError, ValueError): return False
    vals=[finite(row.get(k)) for k in ("open","high","low","close","volume")]
    return None not in vals and vals[0] > 0 and vals[2] > 0 and vals[1] >= max(vals[0], vals[2], vals[3]) and vals[2] <= min(vals[0], vals[1], vals[3]) and vals[4] >= 0

def data_gate(stock, minimum_sessions=100, required_last_session=None):
    reasons=[]; ticker=str(stock.get("ticker") or "").strip().upper(); rows=stock.get("sessions") or []
    if not ticker: reasons.append("MISSING_TICKER")
    if stock.get("symbolVerified") is not True: reasons.append("UNVERIFIED_SYMBOL")
    clean=[r for r in rows if valid_session(r)]
    dates=[r["date"] for r in clean]
    if len(clean) < minimum_sessions: reasons.append("INSUFFICIENT_HISTORY")
    if len(dates) != len(set(dates)): reasons.append("DUPLICATE_SESSION")
    if dates != sorted(dates): reasons.append("UNSORTED_HISTORY")
    if required_last_session and (not dates or dates[-1] != required_last_session): reasons.append("STALE_OHLCV")
    if clean and sum(1 for r in clean[-20:] if finite(r.get("volume"),0)==0) > 4: reasons.append("ILLIQUID_ZERO_VOLUME")
    return {"ticker":ticker,"status":"READY" if not reasons else "DATA_BLOCKED","reasons":reasons,"validSessions":len(clean),"lastSession":dates[-1] if dates else None,"rows":clean}

def atr(rows, end, period=14):
    start=max(1,end-period+1); values=[]
    for i in range(start,end+1):
        r,p=rows[i],rows[i-1]
        values.append(max(r["high"]-r["low"],abs(r["high"]-p["close"]),abs(r["low"]-p["close"])))
    return sum(values)/len(values) if values else None

def features(rows, i):
    close=rows[i]["close"]; a=atr(rows,i); prior=rows[max(0,i-20):i]
    avg_vol=sum(r["volume"] for r in prior)/len(prior)
    turnover=[r["close"]*r["volume"] for r in prior]
    ret=lambda n: close/rows[i-n]["close"]-1
    return [ret(1),ret(5),ret(20),close/(sum(r["close"] for r in prior)/len(prior))-1,rows[i]["volume"]/avg_vol-1 if avg_vol else 0,(a/close if a else 0),math.log1p(median(turnover))]

def geometry(rows, i):
    entry=rows[i]["close"]; a=atr(rows,i); prior=rows[max(0,i-20):i+1]
    support=min(r["low"] for r in prior[-10:]); resistance=max(r["high"] for r in prior)
    stop=min(entry-0.75*a, support-0.10*a)
    target=max(entry+1.0*a, resistance+0.10*a)
    return entry,stop,target

def label_event(rows, i, horizon=5, no_gap_down_fill=True):
    entry,stop,target=geometry(rows,i); future=rows[i+1:i+1+horizon]
    if not future: return None
    if no_gap_down_fill and future[0]["open"] < stop:
        return {"label":"NO_ENTRY","entry":entry,"stop":stop,"target":target,"mfe":0,"mae":0,"held":0}
    mfe=mae=0.0
    for held,r in enumerate(future,1):
        mfe=max(mfe,(r["high"]-entry)/entry); mae=min(mae,(r["low"]-entry)/entry)
        # Conservative same-bar ambiguity.
        if r["low"] <= stop: return {"label":"STOP_BEFORE_TARGET","entry":entry,"stop":stop,"target":target,"mfe":mfe,"mae":mae,"held":held}
        if r["high"] >= target: return {"label":"TARGET_BEFORE_STOP","entry":entry,"stop":stop,"target":target,"mfe":mfe,"mae":mae,"held":held}
    return {"label":"TIME_EXIT","entry":entry,"stop":stop,"target":target,"mfe":mfe,"mae":mae,"held":len(future)}

class Softmax:
    def __init__(self,n_features): self.w=[[0.0]*(n_features+1) for _ in LABELS]
    def predict(self,x):
        z=[w[0]+sum(a*b for a,b in zip(w[1:],x)) for w in self.w]; m=max(z); e=[math.exp(v-m) for v in z]; s=sum(e)
        return [v/s for v in e]
    def fit(self,xs,ys,epochs=180,lr=.08,l2=.01):
        for _ in range(epochs):
            grad=[[0.0]*len(w) for w in self.w]
            for x,y in zip(xs,ys):
                p=self.predict(x)
                for k in range(len(LABELS)):
                    err=p[k]-(1 if y==k else 0); grad[k][0]+=err
                    for j,v in enumerate(x,1): grad[k][j]+=err*v
            n=max(1,len(xs))
            for k,w in enumerate(self.w):
                for j in range(len(w)): w[j]-=lr*(grad[k][j]/n+(l2*w[j] if j else 0))
        return self

def standardize(train, test):
    means=[sum(r[j] for r in train)/len(train) for j in range(len(train[0]))]
    scales=[max(1e-9,(sum((r[j]-means[j])**2 for r in train)/len(train))**.5) for j in range(len(means))]
    tx=lambda r:[(v-means[j])/scales[j] for j,v in enumerate(r)]
    return [tx(r) for r in train],[tx(r) for r in test],means,scales

def brier(probabilities, labels):
    return sum(sum((p[k]-(1 if y==k else 0))**2 for k in range(len(LABELS))) for p,y in zip(probabilities,labels))/len(labels)

def recommendation(ticker, signal_date, geom, probs, mfe, mae, hold, costs=.006, data_quality=1.0):
    entry,stop,target=geom; p=dict(zip(LABELS,probs)); gain=(target-entry)/entry; loss=(entry-stop)/entry
    ev=p["TARGET_BEFORE_STOP"]*gain-p["STOP_BEFORE_TARGET"]*loss-p["TIME_EXIT"]*costs/2-costs
    if data_quality < .8: decision="DATA_BLOCKED"
    elif ev >= .01 and p["TARGET_BEFORE_STOP"] >= .52: decision="BUY_CANDIDATE"
    elif ev > 0: decision="WAIT"
    else: decision="NO_TRADE"
    return {"ticker":ticker,"signalDate":signal_date,"entryLow":round(entry*.997,4),"entryHigh":round(entry*1.003,4),"stop":round(stop,4),"target":round(target,4),"pTargetBeforeStop":round(p["TARGET_BEFORE_STOP"],6),"pStopBeforeTarget":round(p["STOP_BEFORE_TARGET"],6),"pTimeExit":round(p["TIME_EXIT"],6),"pNoEntry":round(p["NO_ENTRY"],6),"expectedNetReturn":round(ev,6),"expectedValue":round(ev,6),"expectedMFE":round(mfe,6),"expectedMAE":round(mae,6),"expectedHoldSessions":round(hold,2),"confidence":round(max(probs)*data_quality,6),"dataQuality":round(data_quality,4),"decision":decision,"engineVersion":"V18.0.0-shadow","modelVersion":"softmax-baseline-1","featureVersion":"v18-features-1","schemaVersion":"18.0.0","productionAuthority":False,"automaticOrders":False}
