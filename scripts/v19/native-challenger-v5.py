#!/usr/bin/env python3
import json, math, os, runpy
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve();V2=runpy.run_path(str(ROOT/'scripts/v19/native-challenger-v2.py'),run_name='v19_v5_base')
OUT=ROOT/'data/v19/native-challenger-v5.json';ENGINE='V19_CHAT_GPT_NATIVE_CHALLENGER_V5';CHAMPION='V16_9_EQUAL_WEIGHT_BASKET';COST=V2['COST'];MIN_UNIVERSE=V2['MIN_UNIVERSE'];FW=V2['FEATURE_WARMUP'];TW=V2['TRAIN_WARMUP'];HOLDOUT=V2['HOLDOUT']
norm_hist=V2['norm_hist'];feature=V2['feature'];add_market_context=V2['add_market_context'];vector=V2['vector'];init_models=V2['init_models'];update_models=V2['update_models'];score_session=V2['score_session'];aggregate=V2['aggregate'];objective=V2['selection_objective'];compact=V2['compact_candidate'];rd=V2['rd'];wr=V2['wr'];rv=V2['rv'];finite=V2['finite'];pct=V2['pct']
POOLS=(5,8,12); POS_W=(0.0,.15,.30,.50); SAFE_W=(0.0,.15,.30,.50); VOL_W=(0.0,.10,.20); SIZES=(3,4); M5=(-999,-1.0,0.0,1.0); BREADTH=(0.0,.45,.50)

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

def pct_rank(pool,key,reverse=False):
 ordered=sorted(pool,key=lambda r:r[key],reverse=not reverse);n=max(1,len(ordered)-1);return {r['ticker']:1-i/n for i,r in enumerate(ordered)}
def vol_rank(pool):
 ordered=sorted(pool,key=lambda r:r['feature']['atrPct']);n=max(1,len(ordered)-1);return {r['ticker']:1-i/n for i,r in enumerate(ordered)}

def pid(pool,pw,sw,vw,size,m5,b):return f'K{pool}|P{pw:.2f}|S{sw:.2f}|V{vw:.2f}|N{size}|M{m5:.1f}|B{b:.2f}'
def parse_pid(x):
 p=x.split('|');return int(p[0][1:]),float(p[1][1:]),float(p[2][1:]),float(p[3][1:]),int(p[4][1:]),float(p[5][1:]),float(p[6][1:])
def policies():return [pid(k,p,s,v,n,m,b) for k in POOLS for p in POS_W for s in SAFE_W for v in VOL_W for n in SIZES for m in M5 for b in BREADTH]

def apply(ranked,policy):
 k,pw,sw,vw,n,m5,b=parse_pid(policy);z0=ranked[0]['feature']
 if z0['market5']<m5 or z0['breadth']<b:return 0.0,[],[],True
 pool=ranked[:k];ar={r['ticker']:1-i/max(1,k-1) for i,r in enumerate(pool)};pr=pct_rank(pool,'positive');sr=pct_rank(pool,'loss',reverse=True);vr=vol_rank(pool)
 rescored=sorted(pool,key=lambda r:(ar[r['ticker']]+pw*pr[r['ticker']]+sw*sr[r['ticker']]+vw*vr[r['ticker']],r['top10']),reverse=True);sel=rescored[:n]
 ret=rv(sum(r['nextReturn'] for r in sel)/n-COST,4);return ret,[r['ticker'] for r in sel],[rv((ar[r['ticker']]+pw*pr[r['ticker']]+sw*sr[r['ticker']]+vw*vr[r['ticker']])*100,2) for r in sel],False

def main():
 hs,bd,dates,rb=build_rows();signals=sorted(rb)
 if len(signals)<TW+HOLDOUT+30:raise RuntimeError(f'Insufficient sessions {len(signals)}')
 cut=len(signals)-HOLDOUT;dev=signals[:cut];hold=signals[cut:];warm=[r for d in dev[:TW] for r in rb[d]];n=len(warm[0]['x']);models=init_models(n,warm);seen=list(warm);pols=policies();records=[]
 for day in dev[TW:]:
  sess=rb[day];ranked=score_session(sess,models,seen,'TOP10_BASELINE');returns={};tickers={};cash={}
  for p in pols:
   rr,tt,_,cc=apply(ranked,p);returns[p]=rr;tickers[p]=tt;cash[p]=cc
  records.append({'signalDate':day,'outcomeDate':sess[0]['outcomeDate'],'returns':returns,'tickers':tickers,'cash':cash});models=update_models(models,sess);seen.extend(sess)
 split=max(25,len(records)-20);selrec=records[:split];valrec=records[split:];board=[]
 for p in pols:
  ms=aggregate([x['returns'][p] for x in selrec]);mv=aggregate([x['returns'][p] for x in valrec]);cashS=sum(x['cash'][p] for x in selrec);cashV=sum(x['cash'][p] for x in valrec);bothPositive=finite(ms['averageNetReturnPct'],-9)>0 and finite(mv['averageNetReturnPct'],-9)>0
  robust=min(objective(ms),objective(mv))+.35*min(finite(ms['averageNetReturnPct'],-9),finite(mv['averageNetReturnPct'],-9))+.10*(1 if bothPositive else -1)
  board.append({'policy':p,'selectionMetrics':ms,'validationMetrics':mv,'cashSessionsSelection':cashS,'cashSessionsValidation':cashV,'bothSegmentsPositive':bothPositive,'robustObjective':rv(robust,6)})
 board.sort(key=lambda x:(x['bothSegmentsPositive'],x['robustObjective']),reverse=True);selected=board[0]['policy'];baseline=pid(4,0,0,0,4,-999,0);pre=[r for d in dev for r in rb[d]];frozen=init_models(n,pre);hres=[];bres=[]
 for day in hold:
  sess=rb[day];ranked=score_session(sess,frozen,pre,'TOP10_BASELINE');rr,tt,ss,cc=apply(ranked,selected);br,bt,_,bc=apply(ranked,baseline);hres.append({'signalDate':day,'outcomeDate':sess[0]['outcomeDate'],'netReturnPct':rr,'tickers':tt,'rescueScores':ss,'cash':cc});bres.append({'signalDate':day,'outcomeDate':sess[0]['outcomeDate'],'netReturnPct':br,'tickers':bt,'cash':bc})
 hm=aggregate([x['netReturnPct'] for x in hres]);bm=aggregate([x['netReturnPct'] for x in bres]);champ=rd(ROOT/'data/research/v16-v169-basket-engine.json',{}).get('blockedWalkForwardMetrics',{});alltrain=[r for d in signals for r in rb[d]];final=init_models(n,alltrain);latest=dates[-1];curr=[]
 for z in bd[latest]:curr.append({'signalDate':latest,'outcomeDate':None,'ticker':z['ticker'],'name':z['name'],'feature':z,'nextReturn':0,'x':vector(z),'yTop3':0,'yTop5':0,'yTop10':0,'yPositive':0,'yLargeLoss':0})
 ranked=score_session(curr,final,alltrain,'TOP10_BASELINE');_,ct,cs,cash=apply(ranked,selected);compact_rows=[]
 for i,r in enumerate(ranked[:15],1):
  c=compact(r,i);c['selectedByV5Policy']=r['ticker'] in ct;c['rescueScore']=cs[ct.index(r['ticker'])] if r['ticker'] in ct else None;compact_rows.append(c)
 report={'schemaVersion':'19.4.0-native-challenger-v5','engineId':ENGINE,'generatedAt':datetime.now(timezone.utc).isoformat(),'status':'SHADOW_RESEARCH_ONLY','isolation':{'branch':os.getenv('GITHUB_REF_NAME') or 'v19-egx-chat-gpt','v16Untouched':True,'v17Untouched':True},'methodology':{'ranking':'V19 v2 TOP10 alpha is the anchor. Within top-K, defensive rescue adds P(net-positive), inverse P(large-loss), and inverse volatility percentiles.','regimeGate':'Market 5-session median return and breadth thresholds may keep the session in cash; cash return is 0 and still counts as a non-winning session.','policySelection':'First development segment + last 20-session development validation; policy is selected before benchmark evaluation.','holdout':'Latest 20-session benchmark reused after prior iterations and explicitly not fresh independent evidence.','transactionCostPct':COST,'automaticPromotion':False},'coverage':{'usableTickerHistories':len(hs),'labeledSignalSessions':len(signals),'developmentOosSessions':len(records),'policySelectionSessions':len(selrec),'policyValidationSessions':len(valrec),'holdoutSessions':len(hold)},'development':{'selectedPolicy':selected,'selectedPolicyEvidence':board[0],'leaderboard':board[:20]},'holdoutBenchmark':{'reusedAfterV2':True,'countsAsFreshIndependentHoldout':False,'metrics':hm,'results':hres,'internalTop10EqualWeight4':{'metrics':bm,'results':bres}},'championReference':{'engineId':CHAMPION,'publishedBlockedWalkForwardMetrics':champ,'v17ProductionReference':'V17 currently governs V16_9_EQUAL_WEIGHT_BASKET','averageVsChampionPp':rv(finite(hm['averageNetReturnPct'],0)-finite(champ.get('averageNetReturnPct'),0),4),'averageVsInternalTop10Pp':rv(finite(hm['averageNetReturnPct'],0)-finite(bm['averageNetReturnPct'],0),4)},'current':{'signalDate':latest,'mode':'SHADOW_RESEARCH_ONLY','executionAllowed':False,'selectedPolicy':selected,'cash':cash,'selectedTickers':ct,'candidates':compact_rows},'promotion':{'automaticPromotion':False,'promotionAllowed':False,'freshIndependentEvidenceRequired':True}}
 wr(OUT,report);print(json.dumps({'engineId':ENGINE,'selectedPolicy':selected,'development':board[0],'holdout':hm,'baseline':bm,'vsChampionPp':report['championReference']['averageVsChampionPp'],'vsBaselinePp':report['championReference']['averageVsInternalTop10Pp'],'currentTickers':ct,'cash':cash},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
