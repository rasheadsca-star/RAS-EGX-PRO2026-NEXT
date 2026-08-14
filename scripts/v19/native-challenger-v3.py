#!/usr/bin/env python3
import json, os, runpy
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
V2=runpy.run_path(str(ROOT/'scripts/v19/native-challenger-v2.py'),run_name='v19_v3_base')
OUT=ROOT/'data/v19/native-challenger-v3.json'; ENGINE='V19_CHAT_GPT_NATIVE_CHALLENGER_V3'; CHAMPION='V16_9_EQUAL_WEIGHT_BASKET'
RECIPES=V2['RECIPES']; SIZES=V2['BASKET_SIZES']; COST=V2['COST']; MIN_UNIVERSE=V2['MIN_UNIVERSE']; FEATURE_WARMUP=V2['FEATURE_WARMUP']; TRAIN_WARMUP=V2['TRAIN_WARMUP']; HOLDOUT=V2['HOLDOUT']
rd=V2['rd']; wr=V2['wr']; norm_hist=V2['norm_hist']; feature=V2['feature']; add_market_context=V2['add_market_context']; vector=V2['vector']; init_models=V2['init_models']; update_models=V2['update_models']; score_session=V2['score_session']; basket_return=V2['basket_return']; aggregate=V2['aggregate']; objective=V2['selection_objective']; compact=V2['compact_candidate']; rv=V2['rv']; finite=V2['finite']; pct=V2['pct']
EXPERTS=[(r,s) for r in RECIPES for s in SIZES]; BASE=('TOP10_BASELINE',4); META_WARMUP=8

def fresh_state():return {f'{r}|{s}':{'mean':0.0,'down':0.0,'win':0.5,'count':0} for r,s in EXPERTS}
def ekey(e):return f'{e[0]}|{e[1]}'
def update_state(state,returns,alpha):
    for e,val in returns.items():
        st=state[ekey(e)]; neg=max(0.0,-val); win=1.0 if val>0 else 0.0
        if st['count']==0:st['mean']=val;st['down']=neg;st['win']=win
        else:st['mean']=(1-alpha)*st['mean']+alpha*val;st['down']=(1-alpha)*st['down']+alpha*neg;st['win']=(1-alpha)*st['win']+alpha*win
        st['count']+=1

def expert_score(st,risk):return st['mean']-risk*st['down']+.08*(st['win']-.5)
def choose(state,risk,margin):
    base=state[ekey(BASE)]; best=max(EXPERTS,key=lambda e:expert_score(state[ekey(e)],risk));
    return best if expert_score(state[ekey(best)],risk)>=expert_score(base,risk)+margin else BASE

def simulate_meta(records,alpha,risk,margin,warmup=META_WARMUP):
    state=fresh_state(); chosen=[]
    for i,rec in enumerate(records):
        if i>=warmup:
            e=choose(state,risk,margin); chosen.append({'signalDate':rec['signalDate'],'expert':ekey(e),'netReturnPct':rec['returns'][e],'tickers':rec['tickers'][e]})
        update_state(state,rec['returns'],alpha)
    return chosen,state

def build_rows():
    histories=[norm_hist(p) for p in (ROOT/'data/history').glob('*.json')]; histories=[h for h in histories if h['ok'] and len(h['rows'])>=FEATURE_WARMUP+3]; by_date=defaultdict(list)
    for h in histories:
        for i in range(FEATURE_WARMUP,len(h['rows'])):
            z=feature(h,i)
            if z:by_date[z['date']].append(z)
    by_date={d:r for d,r in by_date.items() if len(r)>=MIN_UNIVERSE};add_market_context(by_date);dates=sorted(by_date);rows_by_date={}
    for i,day in enumerate(dates[:-1]):
        nxt=dates[i+1];nm={x['ticker']:x for x in by_date[nxt]};sess=[]
        for z in by_date[day]:
            out=nm.get(z['ticker'])
            if out:sess.append({'signalDate':day,'outcomeDate':nxt,'ticker':z['ticker'],'name':z['name'],'feature':z,'nextReturn':pct(out['close'],z['close']),'x':vector(z)})
        sess.sort(key=lambda r:r['nextReturn'],reverse=True);t3={r['ticker'] for r in sess[:3]};t5={r['ticker'] for r in sess[:5]};t10={r['ticker'] for r in sess[:10]}
        for r in sess:r['yTop3']=int(r['ticker'] in t3);r['yTop5']=int(r['ticker'] in t5);r['yTop10']=int(r['ticker'] in t10);r['yPositive']=int(r['nextReturn']>COST);r['yLargeLoss']=int(r['nextReturn']<=-2)
        if len(sess)>=MIN_UNIVERSE:rows_by_date[day]=sess
    return histories,by_date,dates,rows_by_date

def record_for(day,session,models,seen):
    returns={};tickers={}
    for recipe in RECIPES:
        ranked=score_session(session,models,seen,recipe)
        for size in SIZES:
            ret,tt=basket_return(ranked,size);returns[(recipe,size)]=ret;tickers[(recipe,size)]=tt
    return {'signalDate':day,'outcomeDate':session[0]['outcomeDate'],'returns':returns,'tickers':tickers}

def main():
    histories,by_date,dates,rows_by_date=build_rows();signals=sorted(rows_by_date)
    if len(signals)<TRAIN_WARMUP+HOLDOUT+20:raise RuntimeError(f'Insufficient sessions {len(signals)}')
    cut=len(signals)-HOLDOUT;dev=signals[:cut];hold=signals[cut:];warm=[r for d in dev[:TRAIN_WARMUP] for r in rows_by_date[d]];n=len(warm[0]['x']);models=init_models(n,warm);seen=list(warm);dev_records=[]
    for day in dev[TRAIN_WARMUP:]:
        sess=rows_by_date[day];dev_records.append(record_for(day,sess,models,seen));models=update_models(models,sess);seen.extend(sess)
    meta=[]
    for alpha in (.12,.20,.32,.45):
        for risk in (0.0,.15,.30,.50):
            for margin in (0.0,.08,.18,.30):
                chosen,_=simulate_meta(dev_records,alpha,risk,margin);m=aggregate([x['netReturnPct'] for x in chosen]);meta.append({'alpha':alpha,'riskPenalty':risk,'baselineGuardMargin':margin,'metrics':m,'objective':rv(objective(m),6)})
    meta.sort(key=lambda x:x['objective'],reverse=True);selected=meta[0];pre=[r for d in dev for r in rows_by_date[d]];frozen=init_models(n,pre);hold_records=[record_for(day,rows_by_date[day],frozen,pre) for day in hold]
    _,state=simulate_meta(dev_records,selected['alpha'],selected['riskPenalty'],selected['baselineGuardMargin']);chosen=[];baseline=[]
    for rec in hold_records:
        e=choose(state,selected['riskPenalty'],selected['baselineGuardMargin']);chosen.append({'signalDate':rec['signalDate'],'outcomeDate':rec['outcomeDate'],'expert':ekey(e),'netReturnPct':rec['returns'][e],'tickers':rec['tickers'][e]});baseline.append({'signalDate':rec['signalDate'],'outcomeDate':rec['outcomeDate'],'netReturnPct':rec['returns'][BASE],'tickers':rec['tickers'][BASE]});update_state(state,rec['returns'],selected['alpha'])
    hm=aggregate([x['netReturnPct'] for x in chosen]);bm=aggregate([x['netReturnPct'] for x in baseline]);champ=rd(ROOT/'data/research/v16-v169-basket-engine.json',{}).get('blockedWalkForwardMetrics',{});alltrain=[r for d in signals for r in rows_by_date[d]];final=init_models(n,alltrain);current_expert=choose(state,selected['riskPenalty'],selected['baselineGuardMargin']);latest=dates[-1];current_rows=[]
    for z in by_date[latest]:current_rows.append({'signalDate':latest,'outcomeDate':None,'ticker':z['ticker'],'name':z['name'],'feature':z,'nextReturn':0.0,'x':vector(z),'yTop3':0,'yTop5':0,'yTop10':0,'yPositive':0,'yLargeLoss':0})
    cr=score_session(current_rows,final,alltrain,current_expert[0]);current=[compact(r,i) for i,r in enumerate(cr[:12],1)]
    report={'schemaVersion':'19.2.0-native-challenger-v3','engineId':ENGINE,'generatedAt':datetime.now(timezone.utc).isoformat(),'status':'SHADOW_RESEARCH_ONLY','isolation':{'branch':os.getenv('GITHUB_REF_NAME') or 'v19-egx-chat-gpt','v16Untouched':True,'v17Untouched':True},'methodology':{'core':'V19 v2 multi-target alpha models','metaSelector':'Adaptive expert selection across recipe x basket-size experts using only prior realized sessions','baselineGuard':'Fallback to TOP10_BASELINE|4 unless trailing expert edge clears a development-selected margin','parameterSelection':'EWMA alpha, downside penalty and guard margin selected on development prequential evidence only','holdout':'Same 20-session benchmark used for v2 robustness; sequential meta updates use only outcomes after each prediction','transactionCostPct':COST,'automaticPromotion':False},'coverage':{'usableTickerHistories':len(histories),'labeledSignalSessions':len(signals),'developmentOosSessions':len(dev_records),'metaEvaluationSessions':max(0,len(dev_records)-META_WARMUP),'holdoutSessions':len(hold)},'development':{'selectedMetaPolicy':selected,'leaderboard':meta[:12]},'holdoutBenchmark':{'reusedAfterV2':True,'countsAsFreshIndependentHoldout':False,'metrics':hm,'results':chosen,'internalTop10BaselineSameWindow':{'metrics':bm,'results':baseline}},'championReference':{'engineId':CHAMPION,'publishedBlockedWalkForwardMetrics':champ,'v17ProductionReference':'V17 currently governs V16_9_EQUAL_WEIGHT_BASKET','averageVsChampionPp':rv(finite(hm['averageNetReturnPct'],0)-finite(champ.get('averageNetReturnPct'),0),4),'averageVsInternalTop10Pp':rv(finite(hm['averageNetReturnPct'],0)-finite(bm['averageNetReturnPct'],0),4)},'current':{'signalDate':latest,'mode':'SHADOW_RESEARCH_ONLY','executionAllowed':False,'selectedExpert':ekey(current_expert),'basketSize':current_expert[1],'candidates':current},'promotion':{'automaticPromotion':False,'promotionAllowed':False,'freshIndependentEvidenceRequired':True}}
    wr(OUT,report);print(json.dumps({'engineId':ENGINE,'selectedMeta':selected,'holdout':hm,'baseline':bm,'vsChampionPp':report['championReference']['averageVsChampionPp'],'vsBaselinePp':report['championReference']['averageVsInternalTop10Pp'],'currentExpert':ekey(current_expert),'currentTop5':[x['ticker'] for x in current[:5]]},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
