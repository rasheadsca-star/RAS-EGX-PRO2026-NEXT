#!/usr/bin/env python3
import json, sys
from collections import Counter
from pathlib import Path
from statistics import mean

ROOT=Path(__file__).resolve().parents[2]; sys.path.insert(0,str(ROOT))
from scripts.v18.core import *

MODEL_ID='softmax-geometry-aware-2'
FEATURE_VERSION='v18-features-2'

def _load_universe(files):
    stocks=[]
    for f in files:
        try: stock=json.loads(f.read_text())
        except Exception: continue
        stocks.append((f,stock))
    return stocks

def _market_session(stocks):
    dates=[]
    for _,stock in stocks:
        if stock.get('symbolVerified') is not True: continue
        clean=[r for r in (stock.get('sessions') or []) if valid_session(r)]
        if clean: dates.append(max(r['date'] for r in clean))
    return max(dates) if dates else None

def main():
    files=sorted((ROOT/'data/history').glob('*.json')); stocks=_load_universe(files); market_session=_market_session(stocks)
    gates=[]; events=[]; stock_by_ticker={}
    for f,stock in stocks:
        gate=data_gate(stock,required_last_session=market_session); gates.append({k:v for k,v in gate.items() if k!='rows'})
        if gate['ticker']: stock_by_ticker[gate['ticker']]=stock
        if gate['status']!='READY': continue
        rows=gate['rows']
        for i in range(20,len(rows)-5):
            lab=label_event(rows,i)
            if lab: events.append({'ticker':gate['ticker'],'date':rows[i]['date'],'x':features(rows,i),'event':lab})
    events.sort(key=lambda x:(x['date'],x['ticker'])); split=max(1,int(len(events)*.8)); train,test=events[:split],events[split:]
    xtr,xte,means,scales=standardize([e['x'] for e in train],[e['x'] for e in test]); ytr=[LABELS.index(e['event']['label']) for e in train]; yte=[LABELS.index(e['event']['label']) for e in test]
    model=Softmax(len(xtr[0])).fit(xtr,ytr); probs=[model.predict(x) for x in xte]
    latest=[]
    for g in gates:
        if g['status']!='READY': continue
        stock=stock_by_ticker[g['ticker']]; rows=[r for r in stock['sessions'] if valid_session(r)]; i=len(rows)-1
        raw=features(rows,i); x=[(v-means[j])/scales[j] for j,v in enumerate(raw)]; p=model.predict(x); geom=geometry(rows,i)
        peers=[e['event'] for e in train if e['ticker']==g['ticker']][-30:] or [e['event'] for e in train[-500:]]
        latest.append(recommendation(g['ticker'],rows[i]['date'],geom,p,mean(e['mfe'] for e in peers),mean(e['mae'] for e in peers),mean(e['held'] for e in peers),data_quality=min(1,g['validSessions']/120)))
    latest.sort(key=lambda r:r['expectedValue'],reverse=True)
    artifact={
        'schemaVersion':'18.0.0',
        'engineVersion':'V18.0.0-shadow',
        'mode':'RESEARCH_SHADOW_ONLY',
        'generatedFromCommit':__import__('subprocess').check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'dataset':{
            'files':len(files),
            'ready':sum(g['status']=='READY' for g in gates),
            'blocked':sum(g['status']!='READY' for g in gates),
            'requiredLastSession':market_session,
            'events':len(events),
            'train':len(train),
            'test':len(test),
            'labels':Counter(e['event']['label'] for e in events)
        },
        'validation':{
            'method':'chronological-80-20 runtime fit; formal purged walk-forward is stored in data/v18/walk-forward-validation.json',
            'brier':round(brier(probs,yte),6),
            'accuracy':round(sum(max(range(4),key=lambda k:p[k])==y for p,y in zip(probs,yte))/len(yte),6)
        },
        'model':{
            'id':MODEL_ID,
            'recommendationModelVersion':MODEL_ID,
            'featureVersion':FEATURE_VERSION,
            'weights':model.w,
            'means':means,
            'scales':scales
        },
        'recommendations':latest,
        'dataReadiness':gates,
        'disclosures':['Research decision-support system.','Not an automatic trading system.','No guaranteed performance.','Probability estimates are conditional on available data.']
    }
    rec_versions=sorted({r.get('modelVersion') for r in latest if r.get('modelVersion')})
    if rec_versions and rec_versions != [MODEL_ID]: raise ValueError(f'MODEL_LINEAGE_MISMATCH:{rec_versions}')
    if any(r.get('signalDate')!=market_session for r in latest): raise ValueError('STALE_RECOMMENDATION_SESSION')
    artifact['artifactHash']=canonical_hash(artifact); out=ROOT/'data/v18'; out.mkdir(exist_ok=True); (out/'current.json').write_text(json.dumps(artifact,ensure_ascii=False,indent=2)+'\n'); print(json.dumps({'artifact':str(out/'current.json'),'hash':artifact['artifactHash'],'dataset':artifact['dataset'],'validation':artifact['validation'],'modelId':MODEL_ID},ensure_ascii=False,indent=2))
if __name__=='__main__': main()
