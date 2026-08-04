#!/usr/bin/env python3
import json, math, os, statistics
from pathlib import Path

ROOT=Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve(); HD=ROOT/'data/history'
OUT=ROOT/'data/research/v16-probabilistic-model-impact.json'; DEC=ROOT/'data/stable/v15-practical-decision.json'
TOPK=10; MIN_UNIVERSE=60; MIN_SIGNALS=50; PRIOR=25; WARMUP=20

def rd(p,d=None):
    try:return json.loads(Path(p).read_text())
    except:return d

def wr(p,x):
    p.parent.mkdir(parents=True,exist_ok=True); t=p.with_suffix(p.suffix+'.tmp'); t.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n'); json.loads(t.read_text()); t.replace(p)
def m(v): return statistics.fmean(v) if v else None
def med(v): return statistics.median(v) if v else None
def r(x,n=4): return round(x,n) if isinstance(x,(int,float)) and math.isfinite(x) else None
def clip(x,a,b): return max(a,min(b,x))
def pct(x,b): return (x/b-1)*100 if b and b>0 else None
def corr(a,b):
    q=[(x,y) for x,y in zip(a,b) if isinstance(x,(int,float)) and isinstance(y,(int,float)) and math.isfinite(x) and math.isfinite(y)]
    if len(q)<3:return None
    ax=m([x for x,_ in q]); ay=m([y for _,y in q]); num=sum((x-ax)*(y-ay) for x,y in q); dx=sum((x-ax)**2 for x,_ in q); dy=sum((y-ay)**2 for _,y in q)
    return num/math.sqrt(dx*dy) if dx>0 and dy>0 else None
def post(h,s,base): return (h+base*PRIOR)/(s+PRIOR)
def sigmoid(z): return 1/(1+math.exp(-clip(z,-35,35)))
def sma(rows,i,n,key='close'):
    if i-n+1<0:return None
    v=[rows[j][key] for j in range(i-n+1,i+1) if rows[j].get(key) is not None]
    return m(v) if len(v)==n else None
def atr(rows,i,n=14):
    if i-n+1<1:return None
    return m([max(rows[j]['high']-rows[j]['low'],abs(rows[j]['high']-rows[j-1]['close']),abs(rows[j]['low']-rows[j-1]['close'])) for j in range(i-n+1,i+1)])
def rsi(rows,i,n=14):
    if i-n<0:return None
    g=l=0
    for j in range(i-n+1,i+1):
        c=rows[j]['close']-rows[j-1]['close']; g+=max(c,0); l+=max(-c,0)
    return 100 if l==0 else 100-100/(1+(g/n)/(l/n))
def norm_hist(p):
    d=rd(p,{}) or {}; src=d.get('sessions') if isinstance(d.get('sessions'),list) else d if isinstance(d,list) else []
    rows=[]
    for z in src:
        try:
            q={k:float(z[k]) for k in ('open','high','low','close')}; q['volume']=float(z.get('volume') or 0); q['date']=str(z.get('date') or z.get('sessionDate') or '')[:10]
            if q['date'] and q['open']>0 and q['close']>0 and q['low']>0 and q['high']>=max(q['open'],q['close']) and q['low']<=min(q['open'],q['close']): rows.append(q)
        except:pass
    rows.sort(key=lambda x:x['date']); ticker=str(d.get('ticker') or p.stem).upper()
    return {'ticker':ticker,'name':d.get('companyNameAr') or d.get('companyNameEn') or ticker,'ok':d.get('symbolVerified') is not False and d.get('staleData') is not True,'rows':rows}
def feat(h,i):
    if i<55:return None
    z=h['rows']; q=z[i]; s10=sma(z,i,10); s20=sma(z,i,20); s50=sma(z,i,50); a=atr(z,i); rr=rsi(z,i); av=sma(z,i-1,20,'volume')
    if not all(isinstance(x,(int,float)) for x in (s10,s20,s50,a,rr,av)) or av<=0:return None
    pr=z[i-20:i]; hi=max(x['high'] for x in pr); lo=min(x['low'] for x in pr); turn=m([x['close']*x['volume'] for x in z[i-19:i+1]])
    f={'ticker':h['ticker'],'name':h['name'],'date':q['date'],'open':q['open'],'close':q['close'],'s10':s10,'s20':s20,'s50':s50,'a14':a,'rsi':rr,'vr':q['volume']/av,'turn':turn,
       'ret1':pct(q['close'],z[i-1]['close']),'ret3':pct(q['close'],z[i-3]['close']),'ret5':pct(q['close'],z[i-5]['close']),'ret10':pct(q['close'],z[i-10]['close']),'ret20':pct(q['close'],z[i-20]['close']),
       'range':(q['close']-lo)/(hi-lo) if hi>lo else .5,'breakout':pct(q['close'],hi),'trend':q['close']>s20>s50,'atrpct':a/q['close']*100}
    if not all(isinstance(f[k],(int,float)) and math.isfinite(f[k]) for k in ('ret1','ret3','ret5','ret10','ret20','range','breakout','atrpct')) or not(.4<=f['atrpct']<=14) or abs(f['ret1'])>30:return None
    return f

MODELS=[
 ('BREAKOUT_CONTINUATION','اختراق مع استمرار وسيولة',lambda f:f['trend'] and f['breakout']>=-.5 and f['vr']>=1.05 and f['ret5']>=1 and f['ret20']>=4 and f['rs20']>=1 and 52<=f['rsi']<=80),
 ('MOMENTUM_ACCELERATION','تسارع زخم نسبي',lambda f:f['close']>f['s10']>f['s20']>f['s50'] and f['ret3']>.8 and f['ret10']>3 and f['ret20']>5 and f['rs20']>2 and f['vr']>=.8 and 50<=f['rsi']<=78),
 ('TREND_RESUMPTION','استئناف الاتجاه بعد هدوء',lambda f:f['trend'] and f['close']>f['s10'] and f['ret1']>0 and f['ret5']>-1 and f['ret20']>5 and f['rs20']>1 and f['vr']>=.7 and f['range']>=.55 and 48<=f['rsi']<=72),
 ('LIQUID_LEADERS','قيادات سائلة قوية نسبيًا',lambda f:f['trend'] and f['ret5']>0 and f['ret20']>3 and f['rs20']>2 and f['vr']>=.75 and f['turn']>=5e6 and 50<=f['rsi']<=76),
 ('HOT_MOMENTUM','استمرار زخم ساخن',lambda f:f['ret5']>=8 and f['ret20']>=12 and f['rs20']>=7 and f['vr']>=.8 and 76<=f['rsi']<=90 and f['turn']>=1e6),
 ('PRE_BREAKOUT_ACCUMULATION','تجميع قبل الاختراق',lambda f:f['trend'] and f['ret5']>=1 and f['ret20']>=0 and f['rs20']>=-3 and f['vr']>=1.2 and f['range']>=.55 and -7<=f['breakout']<=2 and 50<=f['rsi']<=74),
 ('REVERSAL_CONFIRMATION','انعكاس مبكر مؤكد بالحجم',lambda f:not f['trend'] and f['ret1']>=1.5 and f['ret3']>0 and f['ret5']<=8 and 28<=f['rsi']<=58 and f['vr']>=1.2 and f['close']>f['open'] and f['close']>f['s10'])]

def flags(f): return [1 if fn(f) else 0 for _,_,fn in MODELS]
def vector(f,fl):
    pair=[fl[i]*fl[j] for i in range(7) for j in range(i+1,7)]
    cont=[clip(f['ret1']/10,-1,1),clip(f['ret3']/20,-1,1),clip(f['ret5']/30,-1,1),clip(f['ret20']/80,-1,1),clip(f['rs20']/50,-1,1),clip(math.log(max(f['vr'],.125),2)/4,-1,1),clip((f['rsi']-55)/35,-1,1),clip(f['breakout']/15,-1,1),clip((f['range']-.5)*2,-1,1),clip((math.log10(max(f['turn'],1))-6.5)/2.5,-1,1),1 if f['trend'] else 0,clip(f['atrpct']/8,0,1),sum(fl)/7]
    return [1]+fl+pair+cont
NAMES=['INTERCEPT']+[f'MODEL:{x[0]}' for x in MODELS]+[f'PAIR:{MODELS[i][0]}&{MODELS[j][0]}' for i in range(7) for j in range(i+1,7)]+['RET1','RET3','RET5','RET20','RS20','VOLUME_RATIO','RSI','BREAKOUT','RANGE','TURNOVER','TREND','ATR','MODEL_COUNT']
def update(w,rows,epochs=10,lr=.025,l2=.015):
    pos=max(1,sum(x['y'] for x in rows)); pw=clip((len(rows)-pos)/pos,1,12)
    for _ in range(epochs):
        g=[0.0]*len(w)
        for x in rows:
            p=sigmoid(sum(a*b for a,b in zip(w,x['x']))); e=(p-x['y'])*(pw if x['y'] else 1)
            for i,v in enumerate(x['x']):g[i]+=e*v
        for i in range(len(w)):w[i]-=lr*(g[i]/len(rows)+(0 if i==0 else l2*w[i]))
    return w
def pred(w,x): return sigmoid(sum(a*b for a,b in zip(w,x['x'])))

def main():
    hs=[norm_hist(p) for p in HD.glob('*.json')]; hs=[h for h in hs if h['ok'] and len(h['rows'])>=60]
    bd={}
    for h in hs:
        for i in range(55,len(h['rows'])):
            f=feat(h,i)
            if f:bd.setdefault(f['date'],[]).append(f)
    dates=sorted(k for k,v in bd.items() if len(v)>=MIN_UNIVERSE)
    for d in dates:
        mm=med([x['ret20'] for x in bd[d]])
        for x in bd[d]:x['rs20']=x['ret20']-mm
    if len(dates)-1<MIN_SIGNALS:raise RuntimeError(f'need {MIN_SIGNALS}, found {len(dates)-1}')
    rows=[]; bydate={}
    for di,d in enumerate(dates[:-1]):
        nd=dates[di+1]; nm={x['ticker']:x for x in bd[nd]}; q=[]
        for f in bd[d]:
            if f['ticker'] not in nm:continue
            rt=pct(nm[f['ticker']]['close'],f['close']); fl=flags(f); mask=sum(v<<i for i,v in enumerate(fl)); q.append({'signal':d,'outcome':nd,'ticker':f['ticker'],'name':f['name'],'f':f,'ret':rt,'flags':fl,'mask':mask,'x':vector(f,fl)})
        q.sort(key=lambda x:x['ret'],reverse=True); top={x['ticker'] for x in q[:TOPK]}
        for rank,x in enumerate(q,1):x['y']=1 if x['ticker'] in top else 0;x['rank']=rank
        rows+=q;bydate[d]=q
    base=sum(x['y'] for x in rows)/len(rows)
    single=[]
    for i,(mid,lab,_) in enumerate(MODELS):
        q=[x for x in rows if x['flags'][i]]; hit=sum(x['y'] for x in q); pp=post(hit,len(q),base)
        single.append({'id':mid,'labelAr':lab,'signals':len(q),'hits':hit,'posteriorProbabilityPct':r(pp*100,3),'lift':r(pp/base,4),'phiTop10':r(corr([x['flags'][i] for x in rows],[x['y'] for x in rows]),5),'correlationNextReturn':r(corr([x['flags'][i] for x in rows],[x['ret'] for x in rows]),5),'averageNextReturnPct':r(m([x['ret'] for x in q]),4)})
    pairs=[]
    for i in range(7):
      for j in range(i+1,7):
        q=[x for x in rows if x['flags'][i] and x['flags'][j]]; hit=sum(x['y'] for x in q); pp=post(hit,len(q),base)
        pairs.append({'models':[MODELS[i][0],MODELS[j][0]],'signals':len(q),'hits':hit,'posteriorProbabilityPct':r(pp*100,3),'lift':r(pp/base,4),'averageNextReturnPct':r(m([x['ret'] for x in q]),4),'signalCorrelation':r(corr([x['flags'][i] for x in rows],[x['flags'][j] for x in rows]),5)})
    pairs.sort(key=lambda x:(x['lift'],x['signals']),reverse=True)
    masks={}
    for x in rows:
        z=masks.setdefault(x['mask'],{'signals':0,'hits':0,'ret':[],'flags':x['flags']});z['signals']+=1;z['hits']+=x['y'];z['ret'].append(x['ret'])
    combos=[]
    for mask,z in masks.items():
        if z['signals']<8:continue
        pp=post(z['hits'],z['signals'],base);combos.append({'mask':mask,'models':[MODELS[i][0] for i,v in enumerate(z['flags']) if v],'signals':z['signals'],'hits':z['hits'],'posteriorProbabilityPct':r(pp*100,3),'lift':r(pp/base,4),'averageNextReturnPct':r(m(z['ret']),4)})
    combos.sort(key=lambda x:(x['lift'],x['signals']),reverse=True)
    sd=dates[:-1]; warm=[x for d in sd[:WARMUP] for x in bydate[d]]; w=update([0.0]*len(NAMES),warm,30,.03)
    ses=[]
    for d in sd[WARMUP:]:
        q=bydate[d]; sc=sorted([(pred(w,x),x) for x in q],reverse=True,key=lambda z:z[0]);
        def km(k):
            z=[x for _,x in sc[:k]];return {'hits':sum(x['y'] for x in z),'averageNextReturnPct':r(m([x['ret'] for x in z]),4)}
        ses.append({'signalDate':d,'outcomeDate':q[0]['outcome'],'top5':km(5),'top10':km(10),'top20':km(20),'brier':r(m([(pred(w,x)-x['y'])**2 for x in q]),6)})
        w=update(w,q,10,.022)
    wf={'evaluatedSessions':len(ses),'averageTop5Hits':r(m([x['top5']['hits'] for x in ses]),4),'averageTop10Hits':r(m([x['top10']['hits'] for x in ses]),4),'precisionAt10Pct':r(m([x['top10']['hits']/10 for x in ses])*100,3),'averageNextReturnTop5Pct':r(m([x['top5']['averageNextReturnPct'] for x in ses]),4),'averageNextReturnTop10Pct':r(m([x['top10']['averageNextReturnPct'] for x in ses]),4),'brierScore':r(m([x['brier'] for x in ses]),6)}
    final=update([0.0]*len(NAMES),rows,50,.028); pos=sum(max(0,final[1+i]) for i in range(7))
    weights=[]
    for i,(mid,lab,_) in enumerate(MODELS):weights.append({'id':mid,'labelAr':lab,'coefficient':r(final[1+i],6),'oddsMultiplier':r(math.exp(final[1+i]),4),'normalizedPositiveWeightPct':r(max(0,final[1+i])/pos*100 if pos else 0,3),'bayesianLift':next(x['lift'] for x in single if x['id']==mid)})
    weights.sort(key=lambda x:x['normalizedPositiveWeightPct'],reverse=True)
    latest=dates[-1]; cur=[]
    for f in bd[latest]:
        fl=flags(f); x={'x':vector(f,fl)}; cur.append({'ticker':f['ticker'],'companyNameAr':f['name'],'prob':pred(final,x),'modelCount':sum(fl),'matchedModels':[MODELS[i][0] for i,v in enumerate(fl) if v],'close':f['close'],'ret1Pct':f['ret1'],'ret5Pct':f['ret5'],'ret20Pct':f['ret20'],'relativeStrength20Pct':f['rs20'],'volumeRatio20':f['vr'],'rsi14':f['rsi'],'breakoutPct':f['breakout'],'turnover':f['turn']})
    cur.sort(key=lambda x:x['prob'],reverse=True); recommended={x.get('ticker') for x in (rd(DEC,{}) or {}).get('recommendations',[])}
    tom=[]
    for i,x in enumerate(cur[:15],1):tom.append({'rank':i,'ticker':x['ticker'],'companyNameAr':x['companyNameAr'],'probabilityTop10Pct':r(x['prob']*100,3),'liftVsBase':r(x['prob']/base,3),'modelCount':x['modelCount'],'matchedModels':x['matchedModels'],'close':r(x['close'],4),'ret1Pct':r(x['ret1Pct'],2),'ret5Pct':r(x['ret5Pct'],2),'ret20Pct':r(x['ret20Pct'],2),'relativeStrength20Pct':r(x['relativeStrength20Pct'],2),'volumeRatio20':r(x['volumeRatio20'],2),'rsi14':r(x['rsi14'],1),'breakoutPct':r(x['breakoutPct'],2),'averageTurnover20Egp':r(x['turnover'],0),'band':'CORE_RESEARCH' if i<=3 else 'RESERVE_RESEARCH' if i<=7 else 'WATCH_RESEARCH','currentScannerRecommendation':x['ticker'] in recommended})
    matrix=[{'model':MODELS[i][0],'correlations':{MODELS[j][0]:r(corr([x['flags'][i] for x in rows],[x['flags'][j] for x in rows]),5) for j in range(7)}} for i in range(7)]
    out={'schemaVersion':'16.4.0-research','generatedAt':__import__('datetime').datetime.utcnow().isoformat()+'Z','methodology':{'outcome':'Top 10 close-to-close gainers in next session','signalSessions':len(sd),'firstSignalSession':sd[0],'lastHistoricalSignalSession':sd[-1],'latestPredictionSession':latest,'noFutureLeakage':True,'bayesianPriorStrength':PRIOR,'walkForwardWarmupSessions':WARMUP,'noteAr':'بحث احتمالي وليس ضمانًا للربح أو أمر شراء.'},'dataset':{'histories':len(hs),'usableDates':len(dates),'labeledRows':len(rows),'baseProbabilityPct':r(base*100,3)},'singleModelImpact':sorted(single,key=lambda x:x['lift'],reverse=True),'jointModelImpact':{'topPairs':pairs[:21],'topExactCombinations':combos[:20],'signalCorrelationMatrix':matrix},'probabilisticWeights':weights,'walkForwardValidation':{'metrics':wf,'recentSessions':ses[-15:]},'tomorrowPredictions':tom}
    wr(OUT,out); print(json.dumps({'signalSessions':len(sd),'baseProbabilityPct':out['dataset']['baseProbabilityPct'],'walkForward':wf,'topTomorrow':tom[:10]},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
