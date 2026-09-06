#!/usr/bin/env python3
import json, math, sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, median

ROOT=Path(__file__).resolve().parents[2]; sys.path.insert(0,str(ROOT))
from scripts.v18.core import *

def load_events():
    sector_map=json.loads((ROOT/'config/egx-sector-map.json').read_text()).get('symbolToSector',{})
    events=[]
    for f in sorted((ROOT/'data/history').glob('*.json')):
        try: stock=json.loads(f.read_text())
        except Exception: continue
        gate=data_gate(stock)
        if gate['status']!='READY': continue
        rows=gate['rows']
        for i in range(20,len(rows)-5):
            outcome=label_event(rows,i)
            if outcome: events.append({'ticker':gate['ticker'],'sector':sector_map.get(gate['ticker'],'UNCLASSIFIED'),'date':rows[i]['date'],'x':features(rows,i),'outcome':outcome})
    events.sort(key=lambda e:(e['date'],e['ticker']))
    by_date=defaultdict(list)
    for e in events: by_date[e['date']].append(e['x'][2])
    for e in events:
        market=median(by_date[e['date']]); e['regime']='BULLISH' if market>.02 else 'BEARISH' if market<-.02 else 'SIDEWAYS'
    return events

def empirical(train):
    counts=Counter(LABELS.index(e['outcome']['label']) for e in train); n=len(train)
    return [(counts[k]+1)/(n+len(LABELS)) for k in range(len(LABELS))]

def momentum_baseline(test, prior):
    result=[]
    for e in test:
        target=max(.01,min(.95,prior[0]+.15*math.tanh(e['x'][2]*10)))
        other=1-target; denom=max(1e-12,1-prior[0])
        result.append([target]+[other*prior[k]/denom for k in range(1,len(LABELS))])
    return result

def metrics(rows, probs, costs=.006):
    ys=[LABELS.index(r['outcome']['label']) for r in rows]
    returns=[r['outcome']['grossReturn']-(0 if r['outcome']['label']=='NO_ENTRY' else costs) for r in rows]
    target_rank=sorted(range(len(rows)),key=lambda i:probs[i][0],reverse=True)
    coverage=[]
    for fraction in (.05,.10,.20,.50,1.0):
        idx=target_rank[:max(1,int(len(rows)*fraction))]
        coverage.append({'coverage':fraction,'count':len(idx),'targetRate':mean(ys[i]==0 for i in idx),'meanNetReturn':mean(returns[i] for i in idx)})
    return {'count':len(rows),'accuracy':mean(max(range(4),key=lambda k:p[k])==y for p,y in zip(probs,ys)),'brier':brier(probs,ys),'logLoss':log_loss(probs,ys),'targetECE':target_ece(probs,ys),'targetRate':mean(y==0 for y in ys),'stopRate':mean(y==1 for y in ys),'meanNetReturnAll':mean(returns),'accuracyCoverage':coverage}

def walk_forward(events, minimum_train_dates=45, test_dates=10, embargo_dates=5):
    dates=sorted({e['date'] for e in events}); predictions=[]; folds=[]
    for start in range(minimum_train_dates,len(dates),test_dates):
        test_set=set(dates[start:start+test_dates]); train_dates=set(dates[:max(0,start-embargo_dates)])
        train=[e for e in events if e['date'] in train_dates]; test=[e for e in events if e['date'] in test_set]
        if len(train)<500 or not test: continue
        xtr,xte,_,_=standardize([e['x'] for e in train],[e['x'] for e in test])
        model=Softmax(len(xtr[0])).fit(xtr,[LABELS.index(e['outcome']['label']) for e in train],epochs=90)
        model_probs=[model.predict(x) for x in xte]; base=empirical(train); base_probs=[base]*len(test); mom_probs=momentum_baseline(test,base)
        predictions.extend(zip(test,model_probs,base_probs,mom_probs)); folds.append({'trainThrough':max(train_dates),'embargoFrom':dates[max(0,start-embargo_dates)],'embargoThrough':dates[start-1],'testFrom':min(test_set),'testThrough':max(test_set),'trainEvents':len(train),'testEvents':len(test),'overlap':False})
    rows=[x[0] for x in predictions]; model_probs=[x[1] for x in predictions]; base_probs=[x[2] for x in predictions]; mom_probs=[x[3] for x in predictions]
    return rows,model_probs,base_probs,mom_probs,folds

def slices(rows,probs,key):
    groups=defaultdict(list)
    for i,r in enumerate(rows): groups[r[key]].append(i)
    return {k:metrics([rows[i] for i in idx],[probs[i] for i in idx]) for k,idx in groups.items() if len(idx)>=30}

def main():
    events=load_events(); rows,probs,base_probs,mom_probs,folds=walk_forward(events)
    model=metrics(rows,probs); baseline=metrics(rows,base_probs); momentum=metrics(rows,mom_probs)
    baseline['accuracyCoverage']=None; baseline['selectiveRankingAvailable']=False
    costs={str(c):metrics(rows,probs,c)['accuracyCoverage'] for c in (.004,.006,.008,.01)}
    report={'schemaVersion':'18.0.0-purged-walk-forward-2','mode':'RESEARCH_SHADOW_ONLY','protocol':{'expandingWindow':True,'testBlockSessions':10,'embargoSessions':5,'randomSplit':False},'events':len(events),'evaluatedEvents':len(rows),'folds':folds,'model':model,'baselines':{'empiricalPrior':baseline,'simpleMomentum':momentum},'comparison':{'brierImprovementVsPrior':baseline['brier']-model['brier'],'brierImprovementVsMomentum':momentum['brier']-model['brier'],'logLossImprovementVsPrior':baseline['logLoss']-model['logLoss'],'logLossImprovementVsMomentum':momentum['logLoss']-model['logLoss'],'accuracyImprovementVsPrior':model['accuracy']-baseline['accuracy'],'accuracyImprovementVsMomentum':model['accuracy']-momentum['accuracy']},'costSensitivity':costs,'regimeSlices':slices(rows,probs,'regime'),'sectorSlices':slices(rows,probs,'sector')}
    reasons=['NO_BLIND_HOLDOUT','NO_FRESH_FORWARD_COHORTS']
    if min(report['comparison']['brierImprovementVsPrior'],report['comparison']['brierImprovementVsMomentum'])<=0: reasons.append('NO_BRIER_EDGE_VS_BASELINES')
    if min(report['comparison']['logLossImprovementVsPrior'],report['comparison']['logLossImprovementVsMomentum'])<=0: reasons.append('NO_LOG_LOSS_EDGE_VS_BASELINES')
    report['formalGate']={'pass':False,'status':'MORE_EVIDENCE_REQUIRED','reasons':reasons}
    report['artifactHash']=canonical_hash(report); out=ROOT/'data/v18/walk-forward-validation.json'; out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'artifact':str(out),'hash':report['artifactHash'],'folds':len(folds),'evaluatedEvents':len(rows),'model':model,'baselines':report['baselines'],'comparison':report['comparison'],'gate':report['formalGate']},ensure_ascii=False,indent=2))
if __name__=='__main__': main()
