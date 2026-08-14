#!/usr/bin/env python3
import json, math, os, runpy
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve();V2=runpy.run_path(str(ROOT/'scripts/v19/native-challenger-v2.py'),run_name='v19_v4_base')
OUT=ROOT/'data/v19/native-challenger-v4.json';ENGINE='V19_CHAT_GPT_NATIVE_CHALLENGER_V4';CHAMPION='V16_9_EQUAL_WEIGHT_BASKET';COST=V2['COST'];MIN_UNIVERSE=V2['MIN_UNIVERSE'];FW=V2['FEATURE_WARMUP'];TW=V2['TRAIN_WARMUP'];HOLDOUT=V2['HOLDOUT']
norm_hist=V2['norm_hist'];feature=V2['feature'];add_market_context=V2['add_market_context'];vector=V2['vector'];init_models=V2['init_models'];update_models=V2['update_models'];score_session=V2['score_session'];aggregate=V2['aggregate'];objective=V2['selection_objective'];compact=V2['compact_candidate'];rd=V2['rd'];wr=V2['wr'];rv=V2['rv'];finite=V2['finite'];pct=V2['pct']
SIZES=(3,4,5);WEIGHTS=('EQUAL','INV_VOL_SQRT','INV_VOL','CONF_INV_VOL_SQRT');SAFETY=(0.0,.10,.20,.30,.40);RSI=(None,88,84);ATR=(None,10,8)

def build_rows():
 hs=[norm_hist(p) for p in (ROOT/'data/history').glob('*.json')];hs=[h for h in hs if h['ok'] and len(h['rows'])>=FW+3];bd=defaultdict(list)
 for h in hs:
  for i in range(FW,len(h['rows'])):
   z=feature(h,i)
   if z:bd[z['date']].append(z)
 bd={d:r for d,r in bd.items() if len(r)>=MIN_UNIVERSE};add_market_context(bd);dates=sorted(bd);rb={}
 for i,d in enumerate(dates[:-1]):
  nd=dates[i+1];nm={x['ticker']:x for x in bd[nd]};q=[]
  for z in bd[d]:
   o=nm.get(z['ticker'])
   if o:q.append({'signalDate':d,'outcomeDate':nd,'ticker':z['ticker'],'name':z['name'],'feature':z,'nextReturn':pct(o['close'],z['close']),'x':vector(z)})
  q.sort(key=lambda r:r['nextReturn'],reverse=True);t3={r['ticker'] for r in q[:3]};t5={r['ticker'] for r in q[:5]};t10={r['ticker'] for r in q[:10]}
  for r in q:r['yTop3']=int(r['ticker'] in t3);r['yTop5']=int(r['ticker'] in t5);r['yTop10']=int(r['ticker'] in t10);r['yPositive']=int(r['nextReturn']>COST);r['yLargeLoss']=int(r['nextReturn']<=-2)
  if len(q)>=MIN_UNIVERSE:rb[d]=q
 return hs,bd,dates,rb

def safety_map(ranked):
 ordered=sorted(ranked,key=lambda r:r['loss']);n=max(1,len(ordered)-1);return {r['ticker']:1-i/n for i,r in enumerate(ordered)}

def eligible(r,safety,rsi_cap,atr_cap):
 z=r['feature'];return r['_safety']>=safety and (rsi_cap is None or z['rsi']<=rsi_cap) and (atr_cap is None or z['atrPct']<=atr_cap)

def weights_for(sel,mode):
 raw=[]
 for r in sel:
  atr=max(.25,r['feature']['atrPct'])
  if mode=='EQUAL':w=1.0
  elif mode=='INV_VOL_SQRT':w=1/math.sqrt(atr)
  elif mode=='INV_VOL':w=1/atr
  else:w=max(.01,r['top10'])/math.sqrt(atr)
  raw.append(w)
 s=sum(raw) or 1;w=[x/s for x in raw]
 if max(w)>0.45:
  w=[min(x,.45) for x in w];s=sum(w);w=[x/s for x in w]
 return w

def policy_id(safety,rsi_cap,atr_cap,mode,size):return f'S{safety:.2f}|R{rsi_cap or 0}|A{atr_cap or 0}|{mode}|N{size}'
def parse_policy(pid):
 p=pid.split('|');return float(p[0][1:]),(float(p[1][1:]) or None),(float(p[2][1:]) or None),p[3],int(p[4][1:])

def apply_policy(ranked,pid):
 safety,rsi_cap,atr_cap,mode,size=parse_policy(pid);sm=safety_map(ranked)
 for r in ranked:r['_safety']=sm[r['ticker']]
 sel=[r for r in ranked if eligible(r,safety,rsi_cap,atr_cap)][:size]
 if len(sel)<size:sel=ranked[:size]
 ww=weights_for(sel,mode);gross=sum(w*r['nextReturn'] for w,r in zip(ww,sel));return rv(gross-COST,4),[r['ticker'] for r in sel],[rv(w*100,2) for w in ww]

def all_policies():
 return [policy_id(s,r,a,w,n) for s in SAFETY for r in RSI for a in ATR for w in WEIGHTS for n in SIZES]

def record(day,sess,models,seen,policies):
 ranked=score_session(sess,models,seen,'TOP10_BASELINE');ret={};ticks={}
 for p in policies:
  rr,tt,_=apply_policy(ranked,p);ret[p]=rr;ticks[p]=tt
 return {'signalDate':day,'outcomeDate':sess[0]['outcomeDate'],'returns':ret,'tickers':ticks}

def main():
 hs,bd,dates,rb=build_rows();signals=sorted(rb)
 if len(signals)<TW+HOLDOUT+30:raise RuntimeError(f'Insufficient sessions {len(signals)}')
 cut=len(signals)-HOLDOUT;dev=signals[:cut];hold=signals[cut:];warm=[r for d in dev[:TW] for r in rb[d]];n=len(warm[0]['x']);models=init_models(n,warm);seen=list(warm);policies=all_policies();records=[]
 for day in dev[TW:]:
  sess=rb[day];records.append(record(day,sess,models,seen,policies));models=update_models(models,sess);seen.extend(sess)
 split=max(20,len(records)-20);selection=records[:split];validation=records[split:];board=[]
 for p in policies:
  ms=aggregate([x['returns'][p] for x in selection]);mv=aggregate([x['returns'][p] for x in validation]);robust=min(objective(ms),objective(mv))+.20*min(finite(ms['averageNetReturnPct'],-9),finite(mv['averageNetReturnPct'],-9));board.append({'policy':p,'selectionMetrics':ms,'validationMetrics':mv,'robustObjective':rv(robust,6)})
 board.sort(key=lambda x:x['robustObjective'],reverse=True);selected=board[0]['policy'];baseline=policy_id(0,None,None,'EQUAL',4);pre=[r for d in dev for r in rb[d]];frozen=init_models(n,pre);hres=[];bres=[]
 for day in hold:
  sess=rb[day];ranked=score_session(sess,frozen,pre,'TOP10_BASELINE');rr,tt,ww=apply_policy(ranked,selected);br,bt,bw=apply_policy(ranked,baseline);hres.append({'signalDate':day,'outcomeDate':sess[0]['outcomeDate'],'netReturnPct':rr,'tickers':tt,'weightsPct':ww});bres.append({'signalDate':day,'outcomeDate':sess[0]['outcomeDate'],'netReturnPct':br,'tickers':bt,'weightsPct':bw})
 hm=aggregate([x['netReturnPct'] for x in hres]);bm=aggregate([x['netReturnPct'] for x in bres]);champ=rd(ROOT/'data/research/v16-v169-basket-engine.json',{}).get('blockedWalkForwardMetrics',{});alltrain=[r for d in signals for r in rb[d]];final=init_models(n,alltrain);latest=dates[-1];curr=[]
 for z in bd[latest]:curr.append({'signalDate':latest,'outcomeDate':None,'ticker':z['ticker'],'name':z['name'],'feature':z,'nextReturn':0,'x':vector(z),'yTop3':0,'yTop5':0,'yTop10':0,'yPositive':0,'yLargeLoss':0})
 ranked=score_session(curr,final,alltrain,'TOP10_BASELINE');_,ct,cw=apply_policy(ranked,selected);compact_rows=[]
 for i,r in enumerate(ranked[:15],1):
  c=compact(r,i);c['selectedByRiskPolicy']=r['ticker'] in ct;c['portfolioWeightPct']=cw[ct.index(r['ticker'])] if r['ticker'] in ct else 0;compact_rows.append(c)
 report={'schemaVersion':'19.3.0-native-challenger-v4','engineId':ENGINE,'generatedAt':datetime.now(timezone.utc).isoformat(),'status':'SHADOW_RESEARCH_ONLY','isolation':{'branch':os.getenv('GITHUB_REF_NAME') or 'v19-egx-chat-gpt','v16Untouched':True,'v17Untouched':True},'methodology':{'ranking':'Preserve V19 v2 TOP10 alpha ranking; optimize only risk veto and portfolio weighting.','policySearch':'Safety percentile x RSI cap x ATR cap x weighting x basket size.','policySelection':'First development segment selects; last 20 development sessions validate; robust objective maximizes the weaker segment.','holdout':'Latest 20-session benchmark reused after v2; not fresh independent evidence.','transactionCostPct':COST,'automaticPromotion':False},'coverage':{'usableTickerHistories':len(hs),'labeledSignalSessions':len(signals),'developmentOosSessions':len(records),'policySelectionSessions':len(selection),'policyValidationSessions':len(validation),'holdoutSessions':len(hold)},'development':{'selectedPolicy':selected,'selectedPolicyEvidence':board[0],'leaderboard':board[:15]},'holdoutBenchmark':{'reusedAfterV2':True,'countsAsFreshIndependentHoldout':False,'metrics':hm,'results':hres,'internalTop10EqualWeight4':{'metrics':bm,'results':bres}},'championReference':{'engineId':CHAMPION,'publishedBlockedWalkForwardMetrics':champ,'v17ProductionReference':'V17 currently governs V16_9_EQUAL_WEIGHT_BASKET','averageVsChampionPp':rv(finite(hm['averageNetReturnPct'],0)-finite(champ.get('averageNetReturnPct'),0),4),'averageVsInternalTop10Pp':rv(finite(hm['averageNetReturnPct'],0)-finite(bm['averageNetReturnPct'],0),4)},'current':{'signalDate':latest,'mode':'SHADOW_RESEARCH_ONLY','executionAllowed':False,'selectedPolicy':selected,'selectedTickers':ct,'weightsPct':cw,'candidates':compact_rows},'promotion':{'automaticPromotion':False,'promotionAllowed':False,'freshIndependentEvidenceRequired':True}}
 wr(OUT,report);print(json.dumps({'engineId':ENGINE,'selectedPolicy':selected,'selection':board[0]['selectionMetrics'],'validation':board[0]['validationMetrics'],'holdout':hm,'baseline':bm,'vsChampionPp':report['championReference']['averageVsChampionPp'],'vsBaselinePp':report['championReference']['averageVsInternalTop10Pp'],'current':list(zip(ct,cw))},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
