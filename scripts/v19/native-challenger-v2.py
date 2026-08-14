#!/usr/bin/env python3
import json, math, os, runpy, statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv("GITHUB_WORKSPACE") or ".").resolve()
BASE = runpy.run_path(str(ROOT / "scripts/research/v16-two-stage-predictor.py"), run_name="v19_v2_base")
norm_hist = BASE["norm_hist"]
sigmoid = BASE["BASE"]["sigmoid"]
rv = BASE["round_value"]
HISTORY = ROOT / "data/history"
OUT = ROOT / "data/v19/native-challenger-v2.json"
V16_RESEARCH = ROOT / "data/research/v16-v169-basket-engine.json"
ENGINE = "V19_CHAT_GPT_NATIVE_CHALLENGER_V2"
CHAMPION = "V16_9_EQUAL_WEIGHT_BASKET"
COST = 0.60
MIN_UNIVERSE = 60
FEATURE_WARMUP = 22
TRAIN_WARMUP = 15
HOLDOUT = 20
BASKET_SIZES = (3, 4, 5)

RECIPES = {
    "TOP10_BASELINE": {"top10": 1.00},
    "FOCUS5": {"top3": 0.20, "top5": 0.50, "top10": 0.30},
    "RETURN_BLEND": {"top5": 0.32, "top10": 0.23, "expected": 0.30, "positive": 0.15},
    "RISK_ADJUSTED": {"top3": 0.15, "top5": 0.30, "top10": 0.15, "expected": 0.25, "positive": 0.20, "loss": -0.05},
    "CONCENTRATED_ALPHA": {"top3": 0.28, "top5": 0.32, "top10": 0.10, "expected": 0.25, "positive": 0.10, "loss": -0.05},
    "BALANCED_ALPHA": {"top3": 0.15, "top5": 0.25, "top10": 0.20, "expected": 0.20, "positive": 0.15, "loss": -0.05},
}

def rd(p, default=None):
    try: return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception: return {} if default is None else default

def wr(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(p) + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    json.loads(tmp.read_text(encoding="utf-8")); tmp.replace(p)

def finite(v, default=None):
    try:
        x = float(v); return x if math.isfinite(x) else default
    except Exception: return default

def clip(x, lo, hi): return max(lo, min(hi, x))
def pct(a, b): return (a / b - 1.0) * 100.0 if b else 0.0

def mean(xs):
    q = [finite(x) for x in xs]; q = [x for x in q if x is not None]
    return statistics.fmean(q) if q else 0.0

def stdev(xs):
    q = [finite(x) for x in xs]; q = [x for x in q if x is not None]
    return statistics.pstdev(q) if len(q) > 1 else 0.0

def aggregate(xs):
    q = [finite(x) for x in xs]; q = [x for x in q if x is not None]
    gains = sum(max(0.0, x) for x in q); losses = abs(sum(min(0.0, x) for x in q)); eq = peak = 1.0; dd = 0.0
    for x in q:
        eq *= 1.0 + x / 100.0; peak = max(peak, eq); dd = min(dd, (eq / peak - 1.0) * 100.0)
    return {"sessions":len(q),"averageNetReturnPct":rv(mean(q),4),"medianNetReturnPct":rv(statistics.median(q) if q else 0.0,4),"sessionWinRatePct":rv(sum(x>0 for x in q)/max(1,len(q))*100.0,3),"profitFactor":rv(gains/losses,3) if losses else None,"compoundedNetReturnPct":rv((eq-1.0)*100.0,3),"maximumDrawdownPct":rv(dd,3),"volatilityPct":rv(stdev(q),4),"bestSessionPct":rv(max(q) if q else 0.0,3),"worstSessionPct":rv(min(q) if q else 0.0,3)}

def selection_objective(m):
    n=max(1,m["sessions"]); avg=finite(m["averageNetReturnPct"],-9); med=finite(m["medianNetReturnPct"],-9); pf=finite(m["profitFactor"],.1); win=finite(m["sessionWinRatePct"],0); dd=finite(m["maximumDrawdownPct"],-100); vol=finite(m["volatilityPct"],9)
    return avg+.18*med+.10*math.log(max(pf,.1))+.002*win+.012*max(dd,-20)-.20*(vol/math.sqrt(n))

def sma(rows,i,n,key="close"):
    if i-n+1<0:return None
    q=[rows[j].get(key) for j in range(i-n+1,i+1)]
    return mean(q) if len(q)==n and all(finite(x) is not None for x in q) else None

def atr(rows,i,n=14):
    if i-n+1<1:return None
    return mean([max(rows[j]["high"]-rows[j]["low"],abs(rows[j]["high"]-rows[j-1]["close"]),abs(rows[j]["low"]-rows[j-1]["close"])) for j in range(i-n+1,i+1)])

def rsi(rows,i,n=14):
    if i-n<0:return None
    gains=losses=0.0
    for j in range(i-n+1,i+1):
        d=rows[j]["close"]-rows[j-1]["close"]; gains+=max(d,0); losses+=max(-d,0)
    if losses==0:return 100.0
    rs=(gains/n)/(losses/n); return 100.0-100.0/(1.0+rs)

def feature(history,i):
    if i<FEATURE_WARMUP:return None
    rows=history["rows"]; q=rows[i]; a=atr(rows,i); rr=rsi(rows,i); av20=sma(rows,i-1,20,"volume"); s5=sma(rows,i,5); s10=sma(rows,i,10); s20=sma(rows,i,20)
    if not all(finite(x) is not None for x in (a,rr,av20,s5,s10,s20)) or av20<=0 or a<=0:return None
    prev20=rows[i-20:i]; high20=max(x["high"] for x in prev20); low20=min(x["low"] for x in prev20); turns=[rows[j]["close"]*rows[j]["volume"] for j in range(i-19,i+1)]; candle_range=max(q["high"]-q["low"],q["close"]*.001); tr20=[pct(rows[j]["close"],rows[j-1]["close"]) for j in range(i-19,i+1)]
    p=(q["high"]+q["low"]+q["close"])/3.0; s1=2*p-q["high"]; r1=2*p-q["low"]; support=max([x for x in (p-(q["high"]-q["low"]),s1,p) if x<q["close"]] or [q["close"]-a]); resistance=min([x for x in (p,r1,p+(q["high"]-q["low"])) if x>q["close"]] or [q["close"]+1.5*a])
    z={"ticker":history["ticker"],"name":history["name"],"date":q["date"],"open":q["open"],"high":q["high"],"low":q["low"],"close":q["close"],"volume":q["volume"],"atr":a,"atrPct":a/q["close"]*100,"rsi":rr,"ret1":pct(q["close"],rows[i-1]["close"]),"ret3":pct(q["close"],rows[i-3]["close"]),"ret5":pct(q["close"],rows[i-5]["close"]),"ret10":pct(q["close"],rows[i-10]["close"]),"ret20":pct(q["close"],rows[i-20]["close"]),"sma5Dist":pct(q["close"],s5),"sma10Dist":pct(q["close"],s10),"sma20Dist":pct(q["close"],s20),"volumeRatio20":q["volume"]/av20,"turnover20":mean(turns),"range20":(q["close"]-low20)/max(1e-9,high20-low20),"breakout20":pct(q["close"],high20),"volatility20":stdev(tr20),"closePosition":(q["close"]-q["low"])/candle_range,"bodyPct":(q["close"]-q["open"])/q["close"]*100,"gapPct":pct(q["open"],rows[i-1]["close"]),"support":support,"resistance":resistance,"distSupportAtr":(q["close"]-support)/a,"distResistanceAtr":(resistance-q["close"])/a}
    if not(.25<=z["atrPct"]<=16) or abs(z["ret1"])>35:return None
    return z

def add_market_context(by_date):
    for rows in by_date.values():
        med1=statistics.median(x["ret1"] for x in rows); med5=statistics.median(x["ret5"] for x in rows); med20=statistics.median(x["ret20"] for x in rows); breadth=sum(x["ret1"]>0 for x in rows)/len(rows)
        for x in rows:x.update({"rs1":x["ret1"]-med1,"rs5":x["ret5"]-med5,"rs20":x["ret20"]-med20,"market1":med1,"market5":med5,"market20":med20,"breadth":breadth})

def vector(z):
    logturn=math.log10(max(z["turnover20"],1)); logvr=math.log(max(z["volumeRatio20"],.125),2)
    return [1.0,clip(z["ret1"]/10,-1.5,1.5),clip(z["ret3"]/18,-1.5,1.5),clip(z["ret5"]/30,-1.5,1.5),clip(z["ret10"]/45,-1.5,1.5),clip(z["ret20"]/80,-1.5,1.5),clip(z["rs1"]/10,-1.5,1.5),clip(z["rs5"]/25,-1.5,1.5),clip(z["rs20"]/60,-1.5,1.5),clip((z["rsi"]-55)/35,-1.5,1.5),clip(z["atrPct"]/10,0,1.5),clip(logvr/5,-1.5,1.5),clip((logturn-6.5)/2.5,-1.5,1.5),clip(z["sma5Dist"]/12,-1.5,1.5),clip(z["sma10Dist"]/20,-1.5,1.5),clip(z["sma20Dist"]/35,-1.5,1.5),clip((z["range20"]-.5)*2,-1.5,1.5),clip(z["breakout20"]/15,-1.5,1.5),clip(z["volatility20"]/8,0,1.5),clip(z["closePosition"]*2-1,-1,1),clip(z["bodyPct"]/8,-1.5,1.5),clip(z["gapPct"]/8,-1.5,1.5),clip(z["distSupportAtr"]/4,-1.5,1.5),clip(z["distResistanceAtr"]/4,-1.5,1.5),clip(z["market1"]/7,-1.5,1.5),clip(z["market5"]/18,-1.5,1.5),clip(z["market20"]/35,-1.5,1.5),z["breadth"]*2-1]

def class_weight(rows,target):
    pos=max(1,sum(int(r[target]) for r in rows)); neg=max(1,len(rows)-pos); return clip(neg/pos,1,20)

def train_logistic(weights,rows,target,epochs=16,lr=.026,l2=.018):
    pw=class_weight(rows,target)
    for _ in range(epochs):
        grad=[0.0]*len(weights)
        for r in rows:
            p=sigmoid(sum(a*b for a,b in zip(weights,r["x"]))); e=(p-r[target])*(pw if r[target] else 1)
            for j,v in enumerate(r["x"]):grad[j]+=e*v
        n=max(1,len(rows))
        for j in range(len(weights)):weights[j]-=lr*(grad[j]/n+(0 if j==0 else l2*weights[j]))
    return weights

def prob(weights,row,seen,target):
    raw=sigmoid(sum(a*b for a,b in zip(weights,row["x"]))); pw=class_weight(seen,target); odds=raw/max(1e-9,1-raw); corrected=odds/pw; return corrected/(1+corrected)

def train_return(weights,rows,epochs=18,lr=.020,l2=.025):
    for _ in range(epochs):
        grad=[0.0]*len(weights)
        for r in rows:
            pred=sum(a*b for a,b in zip(weights,r["x"])); target=clip(r["nextReturn"],-8,8)/8; err=clip(pred-target,-1.5,1.5)
            for j,v in enumerate(r["x"]):grad[j]+=err*v
        n=max(1,len(rows))
        for j in range(len(weights)):weights[j]-=lr*(grad[j]/n+(0 if j==0 else l2*weights[j]))
    return weights

def init_models(n,rows):
    return {"top3":train_logistic([0.0]*n,rows,"yTop3",30,.030),"top5":train_logistic([0.0]*n,rows,"yTop5",30,.030),"top10":train_logistic([0.0]*n,rows,"yTop10",30,.030),"positive":train_logistic([0.0]*n,rows,"yPositive",25,.026),"loss":train_logistic([0.0]*n,rows,"yLargeLoss",25,.026),"expected":train_return([0.0]*n,rows,30,.020)}

def update_models(models,rows):
    models["top3"]=train_logistic(models["top3"],rows,"yTop3",8,.020); models["top5"]=train_logistic(models["top5"],rows,"yTop5",8,.020); models["top10"]=train_logistic(models["top10"],rows,"yTop10",8,.020); models["positive"]=train_logistic(models["positive"],rows,"yPositive",8,.019); models["loss"]=train_logistic(models["loss"],rows,"yLargeLoss",8,.019); models["expected"]=train_return(models["expected"],rows,8,.016); return models

def percentile_map(rows,key,reverse=False):
    ordered=sorted(rows,key=lambda r:r[key],reverse=not reverse); n=max(1,len(ordered)-1); return {r["ticker"]:1-i/n for i,r in enumerate(ordered)}

def score_session(rows,models,seen,recipe_name):
    scored=[]
    for r in rows:
        z=dict(r); z["top3"]=prob(models["top3"],r,seen,"yTop3"); z["top5"]=prob(models["top5"],r,seen,"yTop5"); z["top10"]=prob(models["top10"],r,seen,"yTop10"); z["positive"]=prob(models["positive"],r,seen,"yPositive"); z["loss"]=prob(models["loss"],r,seen,"yLargeLoss"); z["expected"]=clip(sum(a*b for a,b in zip(models["expected"],r["x"])),-1.5,1.5); scored.append(z)
    ranks={k:percentile_map(scored,k,reverse=(k=="loss")) for k in ("top3","top5","top10","positive","loss","expected")}; recipe=RECIPES[recipe_name]
    for z in scored:z["score"]=sum(w*ranks[k][z["ticker"]] for k,w in recipe.items())
    return sorted(scored,key=lambda r:(r["score"],r["top5"],r["top10"]),reverse=True)

def basket_return(ranked,size):
    sel=ranked[:size]; return rv(mean([r["nextReturn"] for r in sel])-COST,4),[r["ticker"] for r in sel]

def execution_plan(z):
    c,a=z["close"],z["atr"]; entry_low=c-.08*a; entry_high=c+.08*a; support_stop=z["support"]-.10*a; stop=max(c-1.10*a,min(c-.65*a,support_stop)); rr_target=entry_high+1.30*max(1e-9,entry_high-stop); target=min(c+1.65*a,max(rr_target,min(z["resistance"]-.05*a,c+1.65*a))); rr=(target-entry_high)/max(1e-9,entry_high-stop)
    quality={"turnover":z["turnover20"]>=1_000_000,"volume":z["volumeRatio20"]>=.30,"rsi":z["rsi"]<=88,"gapRisk":abs(z["gapPct"])<=12,"targetAboveEntry":target>entry_high,"riskReward":rr>=1.15}
    return {"entryLow":rv(entry_low,4),"entryHigh":rv(entry_high,4),"stop":rv(stop,4),"target":rv(target,4),"riskReward":rv(rr,2),"executionQualityPct":rv(sum(quality.values())/len(quality)*100,1),"executionEligible":all(quality.values()),"ruleChecks":quality}

def compact_candidate(r,rank):
    z=r["feature"]
    return {"rank":rank,"ticker":r["ticker"],"companyNameAr":r["name"],"v19AlphaScore":rv(r["score"]*100,3),"pTop3Pct":rv(r["top3"]*100,3),"pTop5Pct":rv(r["top5"]*100,3),"pTop10Pct":rv(r["top10"]*100,3),"pNetPositivePct":rv(r["positive"]*100,3),"pLargeLossPct":rv(r["loss"]*100,3),"expectedReturnModelScore":rv(r["expected"],4),"close":rv(z["close"],4),"rsi14":rv(z["rsi"],1),"ret5Pct":rv(z["ret5"],2),"ret20Pct":rv(z["ret20"],2),"relativeStrength20Pct":rv(z["rs20"],2),"volumeRatio20":rv(z["volumeRatio20"],2),"averageTurnover20Egp":rv(z["turnover20"],0),"support":rv(z["support"],4),"resistance":rv(z["resistance"],4),"executionPlan":execution_plan(z)}

def main():
    histories=[norm_hist(p) for p in HISTORY.glob("*.json")]; histories=[h for h in histories if h["ok"] and len(h["rows"])>=FEATURE_WARMUP+3]; by_date=defaultdict(list)
    for h in histories:
        for i in range(FEATURE_WARMUP,len(h["rows"])):
            z=feature(h,i)
            if z:by_date[z["date"]].append(z)
    by_date={d:rows for d,rows in by_date.items() if len(rows)>=MIN_UNIVERSE}; add_market_context(by_date); dates=sorted(by_date); rows_by_date={}
    for i,day in enumerate(dates[:-1]):
        nxt=dates[i+1]; nm={x["ticker"]:x for x in by_date[nxt]}; session=[]
        for z in by_date[day]:
            out=nm.get(z["ticker"])
            if out:session.append({"signalDate":day,"outcomeDate":nxt,"ticker":z["ticker"],"name":z["name"],"feature":z,"nextReturn":pct(out["close"],z["close"]),"x":vector(z)})
        session.sort(key=lambda r:r["nextReturn"],reverse=True); top3={r["ticker"] for r in session[:3]}; top5={r["ticker"] for r in session[:5]}; top10={r["ticker"] for r in session[:10]}
        for r in session:r["yTop3"]=int(r["ticker"] in top3); r["yTop5"]=int(r["ticker"] in top5); r["yTop10"]=int(r["ticker"] in top10); r["yPositive"]=int(r["nextReturn"]>COST); r["yLargeLoss"]=int(r["nextReturn"]<=-2)
        if len(session)>=MIN_UNIVERSE:rows_by_date[day]=session
    signal_dates=sorted(rows_by_date)
    if len(signal_dates)<TRAIN_WARMUP+HOLDOUT+15:raise RuntimeError(f"Need at least {TRAIN_WARMUP+HOLDOUT+15} labeled sessions; got {len(signal_dates)}")
    cut=len(signal_dates)-HOLDOUT; dev_dates=signal_dates[:cut]; holdout_dates=signal_dates[cut:]; warm=[r for d in dev_dates[:TRAIN_WARMUP] for r in rows_by_date[d]]; n=len(warm[0]["x"]); models=init_models(n,warm); seen=list(warm); dev_results={recipe:{size:[] for size in BASKET_SIZES} for recipe in RECIPES}; dev_session_rows=[]
    for day in dev_dates[TRAIN_WARMUP:]:
        session=rows_by_date[day]; record={"signalDate":day,"outcomeDate":session[0]["outcomeDate"],"recipes":{}}
        for recipe in RECIPES:
            ranked=score_session(session,models,seen,recipe); rec={}
            for size in BASKET_SIZES:
                ret,tickers=basket_return(ranked,size); dev_results[recipe][size].append(ret); rec[str(size)]={"netReturnPct":ret,"tickers":tickers}
            record["recipes"][recipe]=rec
        dev_session_rows.append(record); models=update_models(models,session); seen.extend(session)
    candidates=[]
    for recipe in RECIPES:
        for size in BASKET_SIZES:
            metrics=aggregate(dev_results[recipe][size]); candidates.append({"recipe":recipe,"basketSize":size,"metrics":metrics,"selectionObjective":rv(selection_objective(metrics),6)})
    candidates.sort(key=lambda x:x["selectionObjective"],reverse=True); selected=candidates[0]; pre=[r for d in dev_dates for r in rows_by_date[d]]; frozen=init_models(n,pre); recipe=selected["recipe"]; size=selected["basketSize"]; hold=[]; baseline=[]
    for day in holdout_dates:
        session=rows_by_date[day]; ranked=score_session(session,frozen,pre,recipe); ret,tickers=basket_return(ranked,size); hold.append({"signalDate":day,"outcomeDate":session[0]["outcomeDate"],"netReturnPct":ret,"tickers":tickers}); br=score_session(session,frozen,pre,"TOP10_BASELINE"); bret,bt=basket_return(br,size); baseline.append({"signalDate":day,"outcomeDate":session[0]["outcomeDate"],"netReturnPct":bret,"tickers":bt})
    hm=aggregate([x["netReturnPct"] for x in hold]); bm=aggregate([x["netReturnPct"] for x in baseline]); alltrain=[r for d in signal_dates for r in rows_by_date[d]]; final=init_models(n,alltrain); latest=dates[-1]; current_rows=[]
    for z in by_date[latest]:current_rows.append({"signalDate":latest,"outcomeDate":None,"ticker":z["ticker"],"name":z["name"],"feature":z,"nextReturn":0.0,"x":vector(z),"yTop3":0,"yTop5":0,"yTop10":0,"yPositive":0,"yLargeLoss":0})
    current_ranked=score_session(current_rows,final,alltrain,recipe); current=[compact_candidate(r,i) for i,r in enumerate(current_ranked[:12],1)]; champion=rd(V16_RESEARCH,{}).get("blockedWalkForwardMetrics",{}); campavg=finite(champion.get("averageNetReturnPct"),0)
    report={"schemaVersion":"19.1.0-native-challenger-v2","engineId":ENGINE,"generatedAt":datetime.now(timezone.utc).isoformat(),"status":"SHADOW_RESEARCH_ONLY","isolation":{"branch":os.getenv("GITHUB_REF_NAME") or "v19-egx-chat-gpt","v16Untouched":True,"v17Untouched":True},"methodology":{"ranking":"Cross-sectional ensemble of P(Top3), P(Top5), P(Top10), P(net-positive), P(large-loss), and robust expected-return regression.","featureWarmupSessions":FEATURE_WARMUP,"parameterSelection":"Recipe and basket size selected only from development walk-forward sessions.","holdout":"Final 20 sessions frozen; no refit on holdout labels.","fairAlphaComparison":"Selection alpha is measured exactly like V16 research: next-session close-to-close equal-weight return minus 0.60% cost.","executionLayer":"Entry/stop/target and quality gates are reported separately and do not zero-out alpha backtest returns.","automaticPromotion":False},"coverage":{"usableTickerHistories":len(histories),"marketDates":len(dates),"labeledSignalSessions":len(signal_dates),"developmentSessions":len(dev_dates),"developmentOosSessions":len(dev_dates)-TRAIN_WARMUP,"holdoutSessions":len(holdout_dates)},"development":{"selectedRecipe":recipe,"selectedBasketSize":size,"selectedMetrics":selected["metrics"],"selectionObjective":selected["selectionObjective"],"leaderboard":candidates[:12],"recentSessions":dev_session_rows[-12:]},"independentHoldout":{"frozen":True,"labelsNeverUsedForRefit":True,"recipe":recipe,"basketSize":size,"metrics":hm,"results":hold,"internalTop10BaselineSameWindow":{"metrics":bm,"results":baseline}},"championReference":{"engineId":CHAMPION,"publishedBlockedWalkForwardMetrics":champion,"v17ProductionReference":"V17 governance still references V16_9_EQUAL_WEIGHT_BASKET as champion.","holdoutAverageVsPublishedChampionPp":rv(finite(hm["averageNetReturnPct"],0)-campavg,4),"holdoutAverageVsInternalTop10BaselinePp":rv(finite(hm["averageNetReturnPct"],0)-finite(bm["averageNetReturnPct"],0),4)},"current":{"signalDate":latest,"mode":"SHADOW_RESEARCH_ONLY","executionAllowed":False,"selectedRecipe":recipe,"basketSize":size,"candidates":current},"promotion":{"automaticPromotion":False,"promotionAllowed":False,"reason":"Separate V19 v2 challenger gate decides evidence status; explicit review remains mandatory."}}
    wr(OUT,report); print(json.dumps({"engineId":ENGINE,"coverage":report["coverage"],"selected":selected,"holdout":hm,"baseline":bm,"vsChampionPp":report["championReference"]["holdoutAverageVsPublishedChampionPp"],"currentTop5":[x["ticker"] for x in current[:5]]},ensure_ascii=False,indent=2))

if __name__=="__main__":main()
