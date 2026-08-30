#!/usr/bin/env python3
import json, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]; sys.path.insert(0,str(ROOT))
from scripts.v18.core import canonical_hash

def freeze(current, ledger):
    recommendations=current.get('recommendations',[]); session=max((r.get('signalDate') or '' for r in recommendations),default='')
    eligible=[r for r in recommendations if r.get('decision') not in ('VETO','DATA_BLOCKED')]
    eligible.sort(key=lambda r:(r.get('pTargetBeforeStop',0),r.get('expectedValue',-99)),reverse=True)
    selections=[{k:r.get(k) for k in ('ticker','decision','entryLow','entryHigh','stop','target','pTargetBeforeStop','pStopBeforeTarget','pTimeExit','pNoEntry','expectedValue','targetRealistic','stopRealistic','modelVersion','featureVersion')} for r in eligible[:5]]
    payload={'signalId':f'{session}:V18_SHADOW:V18.0.0','arm':'V18_SHADOW','sessionDate':session,'status':'FROZEN_PENDING_FUTURE_OUTCOME','portfolioDecision':'NO_TRADE' if not any(r.get('decision')=='BUY_CANDIDATE' for r in recommendations) else 'SHADOW_CANDIDATES_ONLY','productionAuthority':False,'automaticOrders':False,'selectionPolicy':'Top five non-veto opportunities by pre-outcome target probability; no orders.','selections':selections,'vetoCount':sum(r.get('decision')=='VETO' for r in recommendations),'sourceArtifactHash':current.get('artifactHash')}
    payload['snapshotHash']=canonical_hash(payload)
    entries=ledger.setdefault('entries',[]); old=next((e for e in entries if e.get('signalId')==payload['signalId']),None)
    if old and old.get('snapshotHash')!=payload['snapshotHash']: raise ValueError('IMMUTABLE_FORWARD_CONFLICT')
    if not old: entries.append(payload)
    ledger['schemaVersion']='18.0.0-forward-append-only'; ledger['ledgerHash']=canonical_hash(entries)
    return payload,ledger

def verify_ledger(ledger):
    entries=ledger.get('entries',[])
    if ledger.get('ledgerHash')!=canonical_hash(entries): return False
    for entry in entries:
        body={k:v for k,v in entry.items() if k!='snapshotHash'}
        if entry.get('snapshotHash')!=canonical_hash(body): return False
    return True

def main():
    path=ROOT/'data/v18/forward-ledger.json'
    if '--verify' in sys.argv:
        ledger=json.loads(path.read_text())
        if not verify_ledger(ledger): raise ValueError('INVALID_FORWARD_HASH_CHAIN')
        for snapshot in ledger.get('entries',[]):
            out=ROOT/'data/v18/forward'/f"{snapshot['signalId'].replace(':','_')}.json"
            if not out.exists() or json.loads(out.read_text()).get('snapshotHash')!=snapshot.get('snapshotHash'): raise ValueError('FORWARD_SNAPSHOT_MISMATCH')
        print(json.dumps({'verified':True,'entries':len(ledger.get('entries',[])),'ledgerHash':ledger['ledgerHash']},indent=2)); return
    current=json.loads((ROOT/'data/v18/current.json').read_text())
    ledger=json.loads(path.read_text()) if path.exists() else {'schemaVersion':'18.0.0-forward-append-only','entries':[]}
    snapshot,ledger=freeze(current,ledger); path.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
    out=ROOT/'data/v18/forward'/f"{snapshot['signalId'].replace(':','_')}.json"; out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists() and json.loads(out.read_text()).get('snapshotHash')!=snapshot['snapshotHash']: raise ValueError('IMMUTABLE_SNAPSHOT_FILE_CONFLICT')
    out.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2)+'\n'); print(json.dumps({'snapshot':str(out),'signalId':snapshot['signalId'],'snapshotHash':snapshot['snapshotHash'],'ledgerHash':ledger['ledgerHash'],'portfolioDecision':snapshot['portfolioDecision']},indent=2))
if __name__=='__main__': main()
