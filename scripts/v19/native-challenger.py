#!/usr/bin/env python3
import json, math, os, runpy, statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
BASE=runpy.run_path(str(ROOT/'scripts/research/v16-two-stage-predictor.py'),run_name='v19_base')
norm_hist=BASE['norm_hist']; base_feature=BASE['base_feature']; augment_feature=BASE['augment_feature']
extended_flags=BASE['extended_flags']; extended_vector=BASE['extended_vector']; train=BASE['train']
calibrated_probability=BASE['calibrated_probability']; rv=BASE['round_value']
HISTORY=ROOT/'data/history'; OUT=ROOT/'data/v19/native-challenger.json'; REPLAY=ROOT/'data/v19/recorded-session-replay.json'
V16LIVE=ROOT/'data/stable/v16-v169-live-evaluation.json'; V16RESEARCH=ROOT/'data/research/v16-v169-basket-engine.json'
V17LEDGER=ROOT/'data/v17/ledger.json'; V17TRACK=ROOT/'data/v17/recommendation-track-record.json'
ENGINE='V19_CHAT_GPT_NATIVE_CHALLENGER'; CHAMPION='V16_9_EQUAL_WEIGHT_BASKET'; COST=.60
MIN_UNIVERSE=60; WARMUP=20; HOLDOUT=20; SIZES=(3,4,5); LOOKBACK=8; BLOCK=5

def rd(p,d=None):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:return {} if d is None else d

def wr(p,v):
    p.parent.mkdir(parents=True,exist_ok=True); t=Path(str(p)+'.tmp'); t.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); json.loads(t.read_text(encoding='utf-8')); t.replace(p)

def f(v,d=None):
    try:
        x=float(v); return x if math.isfinite(x) else d
    except Exception:return d

def clip(x,a,b):return max(a,min(b,x))
def pct(a,b):return ((a/b)-1)*100 if b else 0
def mean(xs):
    xs=[f(x) for x in xs]; xs=[x for x in xs if x is not None]; return statistics.fmean(xs) if xs else 0

def agg(xs):
    xs=[f(x) for x in xs]; xs=[x for x in xs if x is not None]; gains=sum(max(0,x) for x in xs); losses=abs(sum(min(0,x) for x in xs)); eq=peak=1.; dd=0.
    for x in xs: eq*=1+x/100; peak=max(peak,eq); dd=min(dd,(eq/peak-1)*100)
    return {'sessions':len(xs),'averageNetReturnPct':rv(mean(xs),4),'medianNetReturnPct':rv(statistics.median(xs) if xs else 0,4),'sessionWinRatePct':rv(sum(x>0 for x in xs)/max(1,len(xs))*100,3),'profitFactor':rv(gains/losses,3) if losses else None,'compoundedNetReturnPct':rv((eq-1)*100,3),'maximumDrawdownPct':rv(dd,3),'bestSessionPct':rv(max(xs) if xs else 0,3),'worstSessionPct':rv(min(xs) if xs else 0,3)}

def objective(m):return f(m.get('averageNetReturnPct'),-5)+.15*math.log(max(f(m.get('profitFactor'),.1),.1))+.002*f(m.get('sessionWinRatePct'),0)+.01*max(f(m.get('maximumDrawdownPct'),-100),-20)

def sr(feature,row):
    p=(row['high']+row['low']+row['close'])/3; s1=2*p-row['high']; r1=2*p-row['low']; s2=p-(row['high']-row['low']); r2=p+(row['high']-row['low']); c=feature['close']; atr=feature['a14']
    lo=[x for x in (s2,s1,p) if x<c]; hi=[x for x in (p,r1,r2) if x>c]; sup=max(lo) if lo else c-atr; res=min(hi) if hi else c+1.5*atr
    feature.update({'pivot':p,'support':sup,'resistance':res,'distSupportAtr':(c-sup)/atr,'distResistanceAtr':(res-c)/atr,'rawRiskReward':((res-c)/atr)/max(.15,(c-sup)/atr)})

def add_context(by_date):
    for rows in by_date.values():
        m1=statistics.median(x['ret1'] for x in rows); m5=statistics.median(x['ret5'] for x in rows); m20=statistics.median(x['ret20'] for x in rows); breadth=sum(x['ret1']>0 for x in rows)/len(rows)
        for x in rows:x.update({'rs20':x['ret20']-m20,'marketRet1':m1,'marketRet5':m5,'marketRet20':m20,'breadth':breadth})

def xvec(feature,variant):
    flags=extended_flags(feature); x=list(extended_vector(feature,flags))
    if variant in ('LIQ_SR','FULL'):x += [clip(feature['distSupportAtr']/3,-1.5,1.5),clip(feature['distResistanceAtr']/3,-1.5,1.5),clip(feature['rawRiskReward']/4,-1.5,1.5)]
    if variant=='FULL':x += [clip(feature['marketRet1']/6,-1.5,1.5),clip(feature['marketRet5']/15,-1.5,1.5),clip(feature['marketRet20']/30,-1.5,1.5),feature['breadth']*2-1]
    return x

def plan(feature):
    c=feature['close']; a=feature['a14']; sup=feature['support']; res=feature['resistance']; el=c-.10*a; eh=c+.05*a; stop=max(c-1.25*a,min(el-.55*a,sup-.10*a)); target=min(c+1.8*a,res-.05*a); rr=(target-eh)/max(1e-9,eh-stop)
    rules={'turnover':feature['turn']>=1_000_000,'volume':feature['vr']>=.35,'rsi':feature['rsi']<=82,'ret5':feature['ret5']<=30,'ret20':feature['ret20']<=80,'breakout':feature['breakout']<=8,'targetAboveEntry':target>eh,'rr115':rr>=1.15}
    return {'entryLow':el,'entryHigh':eh,'stop':stop,'target':target,'riskReward':rr,'rules':rules,'executionEligible':all(rules.values())}

def score(rows,weights,seen,variant):
    out=[]; key='x'+variant
    for row in rows:
        pt=calibrated_probability(weights['top'],row,seen,'yTop10',key); pp=calibrated_probability(weights['pos'],row,seen,'yPositive',key); pl=calibrated_probability(weights['loss'],row,seen,'yLargeLoss',key); opp=max(0,pt*pp*(1-pl))**(1/3)
        z=dict(row); z.update({'pTop10':pt,'pPositive':pp,'pLargeLoss':pl,'opportunityScore':opp,'plan':plan(row['feature'])}); out.append(z)
    return sorted(out,key=lambda r:(r['opportunityScore'],r['pTop10']),reverse=True)

def sim(c):
    p=c['plan']; o=c['outcome']; op=f(o['open']); hi=f(o['high']); lo=f(o['low']); cl=f(o['close'])
    if not p['executionEligible']:return {'entered':False,'state':'RESEARCH_ONLY_RULES_NOT_PASSED','netReturnPct':0}
    if op<p['entryLow'] or op>p['entryHigh']:return {'entered':False,'state':'NOT_ENTERED_OPEN_OUTSIDE_RANGE','netReturnPct':0}
    t=hi>=p['target']; s=lo<=p['stop']; amb=t and s
    if amb or s:ex=p['stop']; st='AMBIGUOUS_TREATED_AS_STOP' if amb else 'STOP_TOUCHED'
    elif t:ex=p['target']; st='TARGET_TOUCHED'
    else:ex=cl; st='CLOSED_AT_SESSION_END'
    gross=(ex/op-1)*100
    return {'entered':True,'state':st,'entryPrice':rv(op,4),'exitPrice':rv(ex,4),'targetTouched':t,'stopTouched':s,'ambiguousSameSession':amb,'grossReturnPct':rv(gross,4),'netReturnPct':rv(gross-COST,4)}

def basket(scored,size):
    sel=[r for r in scored if r['plan']['executionEligible']][:size]; members=[]; ret=0
    for c in sel:
        s=sim(c); ret += f(s.get('netReturnPct'),0)/size; members.append({'ticker':c['ticker'],**s})
    return rv(ret,4),members,[x['ticker'] for x in sel]

def compact(c,rank):
    q=c['feature']; p=c['plan']; return {'rank':rank,'ticker':c['ticker'],'companyNameAr':c['name'],'opportunityScore':rv(c['opportunityScore']*100,3),'probabilityTop10Pct':rv(c['pTop10']*100,3),'probabilityNetPositivePct':rv(c['pPositive']*100,3),'probabilityLargeLossPct':rv(c['pLargeLoss']*100,3),'executionEligible':p['executionEligible'],'executionQualityScore':rv(sum(p['rules'].values())/len(p['rules'])*100,1),'entryLow':rv(p['entryLow'],4),'entryHigh':rv(p['entryHigh'],4),'stop':rv(p['stop'],4),'target':rv(p['target'],4),'riskReward':rv(p['riskReward'],2),'close':rv(q['close'],4),'rsi14':rv(q['rsi'],1),'relativeStrength20Pct':rv(q['rs20'],2),'volumeRatio20':rv(q['vr'],2),'averageTurnover20Egp':rv(q['turn'],0),'support':rv(q['support'],4),'resistance':rv(q['resistance'],4),'regime':{'marketRet5Pct':rv(q['marketRet5'],2),'marketRet20Pct':rv(q['marketRet20'],2),'breadthPositivePct':rv(q['breadth']*100,1)},'ruleChecks':p['rules']}

def recorded():
    d=defaultdict(set); orig=defaultdict(lambda:{'V16':[],'V17':[]})
    for s in rd(V16LIVE,{'sessions':[]}).get('sessions',[]):
        day=s.get('signalDate')
        if day:d[day].add('V16_EXACT_METHOD_LIVE'); orig[day]['V16']=[m.get('ticker') for m in s.get('members',[]) if m.get('ticker')]
    for e in rd(V17LEDGER,{'entries':[]}).get('entries',[]):
        day=e.get('sessionDate')
        if day:d[day].add('V17_NATIVE_LEDGER'); orig[day]['V17']=[m.get('ticker') for m in e.get('recommendations',[]) if m.get('ticker')]
    tr=rd(V17TRACK,{})
    for s in tr.get('exactMethodRecordedSessions',{}).get('sessions',[]):
        if s.get('signalDate'):d[s['signalDate']].add('V17_TRACK_EXACT_METHOD_REFERENCE')
    for e in tr.get('nativeV17',{}).get('entries',[]):
        if e.get('signalDate'):d[e['signalDate']].add('V17_TRACK_NATIVE_REFERENCE')
    return d,orig

def main():
    histories=[norm_hist(p) for p in HISTORY.glob('*.json')]; histories=[h for h in histories if h['ok'] and len(h['rows'])>=60]; by_date=defaultdict(list); ohlc={}
    for h in histories:
        for i in range(55,len(h['rows'])):
            z=base_feature(h,i)
            if z:
                z=augment_feature(h,i,z); sr(z,h['rows'][i]); by_date[z['date']].append(z); ohlc[(z['ticker'],z['date'])]=h['rows'][i]
    by_date={d:r for d,r in by_date.items() if len(r)>=MIN_UNIVERSE}; add_context(by_date); dates=sorted(by_date)
    rows_by_date={}; labeled=[]
    for di,day in enumerate(dates[:-1]):
        nxt=dates[di+1]; omap={x['ticker']:x for x in by_date[nxt]}; sess=[]
        for z in by_date[day]:
            out=omap.get(z['ticker']); oo=ohlc.get((z['ticker'],nxt))
            if not out or not oo:continue
            row={'signalDate':day,'outcomeDate':nxt,'ticker':z['ticker'],'name':z['name'],'feature':z,'outcome':oo,'nextReturn':pct(out['close'],z['close'])}
            for v in ('CORE','LIQ_SR','FULL'):row['x'+v]=xvec(z,v)
            sess.append(row)
        sess.sort(key=lambda r:r['nextReturn'],reverse=True); top={x['ticker'] for x in sess[:10]}
        for r in sess:r['yTop10']=int(r['ticker'] in top); r['yPositive']=int(r['nextReturn']>COST); r['yLargeLoss']=int(r['nextReturn']<=-2)
        if len(sess)>=MIN_UNIVERSE:rows_by_date[day]=sess; labeled.extend(sess)
    sig=sorted(rows_by_date)
    if len(sig)<WARMUP+HOLDOUT+1:raise RuntimeError(f'Need >={WARMUP+HOLDOUT+1} labeled sessions, got {len(sig)}')
    cut=len(sig)-HOLDOUT; dev=sig[:cut]; hold=sig[cut:]; ablation={}; full_sessions=[]; snaps={}
    for variant in ('CORE','LIQ_SR','FULL'):
        warm=[r for d in dev[:WARMUP] for r in rows_by_date[d]]; key='x'+variant; n=len(warm[0][key]); weights={'top':train([0]*n,warm,'yTop10',key,30,.03),'pos':train([0]*n,warm,'yPositive',key,24,.026),'loss':train([0]*n,warm,'yLargeLoss',key,24,.026)}; seen=list(warm); returns=[]
        for day in dev[WARMUP:]:
            sess=rows_by_date[day]; ranked=score(sess,weights,seen,variant); r4,_,_=basket(ranked,4); returns.append(r4)
            if variant=='FULL':
                rec={'signalDate':day,'outcomeDate':sess[0]['outcomeDate']}
                for size in SIZES:
                    rr,mm,tt=basket(ranked,size); rec[f'basket{size}NetPct']=rr; rec[f'basket{size}Tickers']=tt; rec[f'basket{size}Members']=mm
                full_sessions.append(rec); snaps[day]=[compact(x,i) for i,x in enumerate(ranked[:12],1)]
            weights['top']=train(weights['top'],sess,'yTop10',key,8,.021); weights['pos']=train(weights['pos'],sess,'yPositive',key,8,.021); weights['loss']=train(weights['loss'],sess,'yLargeLoss',key,8,.021); seen.extend(sess)
        ablation[variant]={'featureMode':variant,'developmentTop4Metrics':agg(returns),'developmentSessions':len(returns)}
    blocked=[]; usage={str(s):0 for s in SIZES}
    for start in range(LOOKBACK,len(full_sessions),BLOCK):
        val=full_sessions[max(0,start-LOOKBACK):start]; choices=sorted([(objective(agg([x[f'basket{s}NetPct'] for x in val])),s,agg([x[f'basket{s}NetPct'] for x in val])) for s in SIZES],reverse=True); chosen=choices[0][1]
        for x in full_sessions[start:start+BLOCK]:blocked.append({'signalDate':x['signalDate'],'outcomeDate':x['outcomeDate'],'basketSize':chosen,'tickers':x[f'basket{chosen}Tickers'],'netReturnPct':x[f'basket{chosen}NetPct'],'validationMetrics':choices[0][2]}); usage[str(chosen)]+=1
    bmetrics=agg([x['netReturnPct'] for x in blocked]); pre=[r for d in dev for r in rows_by_date[d]]; key='xFULL'; n=len(pre[0][key]); frozen={'top':train([0]*n,pre,'yTop10',key,55,.028),'pos':train([0]*n,pre,'yPositive',key,45,.025),'loss':train([0]*n,pre,'yLargeLoss',key,45,.025)}
    tail=full_sessions[-LOOKBACK:]; hc=sorted([(objective(agg([x[f'basket{s}NetPct'] for x in tail])),s,agg([x[f'basket{s}NetPct'] for x in tail])) for s in SIZES],reverse=True); hsize=hc[0][1]; hres=[]
    for day in hold:
        ranked=score(rows_by_date[day],frozen,pre,'FULL'); rr,mm,tt=basket(ranked,hsize); hres.append({'signalDate':day,'outcomeDate':rows_by_date[day][0]['outcomeDate'],'basketSize':hsize,'tickers':tt,'netReturnPct':rr,'members':mm}); snaps[day]=[compact(x,i) for i,x in enumerate(ranked[:12],1)]
    hmetrics=agg([x['netReturnPct'] for x in hres])
    alltrain=[r for d in sig for r in rows_by_date[d]]; latest=dates[-1]; curr=[]
    for z in by_date[latest]:curr.append({'signalDate':latest,'ticker':z['ticker'],'name':z['name'],'feature':z,'xFULL':xvec(z,'FULL'),'yTop10':0,'yPositive':0,'yLargeLoss':0})
    n=len(alltrain[0]['xFULL']); cw={'top':train([0]*n,alltrain,'yTop10','xFULL',55,.028),'pos':train([0]*n,alltrain,'yPositive','xFULL',45,.025),'loss':train([0]*n,alltrain,'yLargeLoss','xFULL',45,.025)}; current=[compact(x,i) for i,x in enumerate(score(curr,cw,alltrain,'FULL')[:12],1)]
    days,orig=recorded(); replay=[]
    for day in sorted(days):
        snap=snaps.get(day)
        if snap is None and day in rows_by_date:
            prior=[d for d in sig if d<day]
            if len(prior)>=WARMUP:
                pr=[r for d in prior for r in rows_by_date[d]]; n=len(pr[0]['xFULL']); lw={'top':train([0]*n,pr,'yTop10','xFULL',45,.028),'pos':train([0]*n,pr,'yPositive','xFULL',38,.025),'loss':train([0]*n,pr,'yLargeLoss','xFULL',38,.025)}; snap=[compact(x,i) for i,x in enumerate(score(rows_by_date[day],lw,pr,'FULL')[:12],1)]
        top=[x['ticker'] for x in (snap or [])[:5]]; replay.append({'signalDate':day,'recordedSources':sorted(days[day]),'originalV16Tickers':orig[day]['V16'],'originalV17Tickers':orig[day]['V17'],'v19ReplayAvailable':snap is not None,'v19Top5':top,'v19Top12':snap or [],'overlapV16Top5':len(set(top)&set(orig[day]['V16'])),'overlapV17Top5':len(set(top)&set(orig[day]['V17'])),'evidenceClass':'RETROACTIVE_AS_OF_DATE_REPLAY_NOT_LIVE_V19_EVIDENCE'})
    champ=rd(V16RESEARCH,{}).get('blockedWalkForwardMetrics',{}); generated=datetime.now(timezone.utc).isoformat(); report={'schemaVersion':'19.0.0-native-challenger-1','engineId':ENGINE,'generatedAt':generated,'status':'SHADOW_RESEARCH_ONLY','isolation':{'branch':os.getenv('GITHUB_REF_NAME') or 'v19-egx-chat-gpt','writesOnlyUnder':['scripts/v19','data/v19','docs/v19','.github/workflows/v19-egx-chat-gpt.yml'],'v16Untouched':True,'v17Untouched':True},'methodology':{'goal':'Quality-adjusted executable opportunity ranking, not probability-only ranking.','probabilityModels':['P_TOP10_NEXT_SESSION','P_NET_POSITIVE_AFTER_COST','P_LARGE_LOSS'],'opportunityScore':'GEOMETRIC_MEAN(P_TOP10,P_NET_POSITIVE,1-P_LARGE_LOSS)','factorModes':['CORE','LIQ_SR','FULL'],'supportResistance':'CLASSIC_PIVOT_FROM_SIGNAL_SESSION_OHLC','execution':'OPEN_MUST_BE_INSIDE_ENTRY_RANGE; SAME_SESSION_TARGET_AND_STOP_IS_STOP; NO_INTRADAY_SEQUENCE_INVENTED','portfolio':'Equal-weight slots; unfilled/noneligible slots remain cash; size chosen from prior validation only.','transactionCostPct':COST,'automaticPromotion':False},'coverage':{'usableTickerHistories':len(histories),'marketDates':len(dates),'labeledSignalSessions':len(sig),'developmentSessions':len(dev),'independentHoldoutSessions':len(hold)},'ablation':ablation,'developmentBlockedWalkForward':{'metrics':bmetrics,'basketSizeUsage':usage,'recentSessions':blocked[-20:]},'independentHoldout':{'frozen':True,'labelsNeverUsedForRefit':True,'sessions':len(hres),'basketSize':hsize,'selectionEvidence':hc[0][2],'metrics':hmetrics,'results':hres},'championReference':{'engineId':CHAMPION,'metrics':champ,'averageNetReturnImprovementPctPoints':rv(f(hmetrics.get('averageNetReturnPct'),0)-f(champ.get('averageNetReturnPct'),0),4)},'current':{'signalDate':latest,'mode':'SHADOW_RESEARCH_ONLY','executionAllowed':False,'candidates':current},'recordedReplaySummary':{'sessionsRequested':len(days),'sessionsReplayed':sum(x['v19ReplayAvailable'] for x in replay),'sources':sorted({s for v in days.values() for s in v}),'disclosure':'Recorded V16/V17 dates replayed as-of-date; research evidence only.'},'promotion':{'automaticPromotion':False,'promotionAllowed':False,'reason':'Separate challenger gate and explicit release review required.'}}
    wr(OUT,report); wr(REPLAY,{'schemaVersion':'19.0.0-recorded-session-replay-1','generatedAt':generated,'engineId':ENGINE,'policy':{'v16AndV17LedgersReadOnly':True,'asOfDateOnly':True,'futureLeakageForbidden':True,'countsAsLiveEvidence':False},'sessions':replay}); print(json.dumps({'engineId':ENGINE,'coverage':report['coverage'],'development':bmetrics,'holdout':hmetrics,'replay':report['recordedReplaySummary'],'currentTop5':[x['ticker'] for x in current[:5]]},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
