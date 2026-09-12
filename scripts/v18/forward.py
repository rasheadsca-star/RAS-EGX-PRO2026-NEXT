#!/usr/bin/env python3
import json, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]; sys.path.insert(0,str(ROOT))
from scripts.v18.core import canonical_hash

EXECUTION_POLICY_VERSION='18.1-forward-execution-1'

def _source_session_evidence(current, selections, session):
    by_ticker={r.get('ticker'):r for r in current.get('dataReadiness',[]) if r.get('ticker')}
    dates={s.get('ticker'):(by_ticker.get(s.get('ticker')) or {}).get('lastSession') for s in selections}
    aligned=bool(selections) and bool(session) and all(d==session for d in dates.values())
    return {
        'requiredSession':session,
        'selectedLastSessions':dates,
        'allSelectionsAligned':aligned,
        'contract':'Every frozen selection must have lastSession equal to the frozen signal session.'
    }

def _execution_contract(current, selections):
    candidates=[s.get('ticker') for s in selections if s.get('decision')=='BUY_CANDIDATE']
    weight=round(100.0/len(candidates),6) if candidates else 0.0
    rec_versions=sorted({s.get('modelVersion') for s in selections if s.get('modelVersion')})
    return {
        'executionPolicy':{
            'version':EXECUTION_POLICY_VERSION,
            'entry':'NEXT_SESSION_OPEN_INSIDE_FROZEN_ENTRY_RANGE',
            'maxHoldingSessions':1,
            'exit':'TARGET_OR_STOP_OR_NEXT_SESSION_CLOSE',
            'sameSessionTargetStop':'CONSERVATIVE_STOP_FIRST',
            'transactionCostPct':0.6,
        },
        'portfolioAllocationPolicy':{
            'method':'EQUAL_WEIGHT_BUY_CANDIDATES',
            'maxPositions':5,
            'cashIfNoBuyCandidates':True,
            'candidateTickers':candidates,
            'weightPctPerCandidate':weight,
            'ordersEnabled':False,
        },
        'modelLineage':{
            'engineModelId':(current.get('model') or {}).get('id'),
            'recommendationModelVersions':rec_versions,
            'relationship':'Recommendation modelVersion is the frozen recommendation-contract namespace produced by the engine model id.',
            'explicitlyLinked':bool((current.get('model') or {}).get('id')) and bool(rec_versions),
        },
    }

def _signal_id(current):
    recommendations=current.get('recommendations',[])
    session=max((r.get('signalDate') or '' for r in recommendations),default='')
    return session, f'{session}:V18_SHADOW:V18.0.0'

def freeze(current, ledger):
    recommendations=current.get('recommendations',[]); session, signal_id=_signal_id(current)
    eligible=[r for r in recommendations if r.get('decision') not in ('VETO','DATA_BLOCKED')]
    eligible.sort(key=lambda r:(r.get('pTargetBeforeStop',0),r.get('expectedValue',-99)),reverse=True)
    selections=[{k:r.get(k) for k in ('ticker','decision','entryLow','entryHigh','stop','target','pTargetBeforeStop','pStopBeforeTarget','pTimeExit','pNoEntry','expectedValue','targetRealistic','stopRealistic','modelVersion','featureVersion')} for r in eligible[:5]]
    source_evidence=_source_session_evidence(current,selections,session)
    if not source_evidence['allSelectionsAligned']:
        raise ValueError('SOURCE_SESSION_ALIGNMENT_REQUIRED')
    contract=_execution_contract(current,selections)
    payload={
        'signalId':signal_id,
        'arm':'V18_SHADOW',
        'sessionDate':session,
        'status':'FROZEN_PENDING_FUTURE_OUTCOME',
        'portfolioDecision':'NO_TRADE' if not any(r.get('decision')=='BUY_CANDIDATE' for r in recommendations) else 'SHADOW_CANDIDATES_ONLY',
        'productionAuthority':False,
        'automaticOrders':False,
        'selectionPolicy':'Top five non-veto opportunities by pre-outcome target probability; no orders.',
        'selections':selections,
        'vetoCount':sum(r.get('decision')=='VETO' for r in recommendations),
        'sourceArtifactHash':current.get('artifactHash'),
        'sourceSessionEvidence':source_evidence,
        **contract,
    }
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

def _verify_snapshot_file(snapshot):
    out=ROOT/'data/v18/forward'/f"{snapshot['signalId'].replace(':','_')}.json"
    if not out.exists() or json.loads(out.read_text()).get('snapshotHash')!=snapshot.get('snapshotHash'):
        raise ValueError('FORWARD_SNAPSHOT_MISMATCH')
    return out

def main():
    path=ROOT/'data/v18/forward-ledger.json'
    if '--verify' in sys.argv:
        ledger=json.loads(path.read_text())
        if not verify_ledger(ledger): raise ValueError('INVALID_FORWARD_HASH_CHAIN')
        for snapshot in ledger.get('entries',[]): _verify_snapshot_file(snapshot)
        print(json.dumps({'verified':True,'entries':len(ledger.get('entries',[])),'ledgerHash':ledger['ledgerHash']},indent=2)); return
    current=json.loads((ROOT/'data/v18/current.json').read_text())
    ledger=json.loads(path.read_text()) if path.exists() else {'schemaVersion':'18.0.0-forward-append-only','entries':[]}
    if not verify_ledger(ledger) and ledger.get('entries'):
        raise ValueError('INVALID_FORWARD_HASH_CHAIN')
    session, signal_id=_signal_id(current)
    old=next((e for e in ledger.get('entries',[]) if e.get('signalId')==signal_id),None)
    if old:
        out=_verify_snapshot_file(old)
        print(json.dumps({'snapshot':str(out),'signalId':signal_id,'snapshotHash':old['snapshotHash'],'ledgerHash':ledger['ledgerHash'],'portfolioDecision':old.get('portfolioDecision'),'alreadyFrozen':True,'sessionDate':session},indent=2)); return
    snapshot,ledger=freeze(current,ledger); path.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
    out=ROOT/'data/v18/forward'/f"{snapshot['signalId'].replace(':','_')}.json"; out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists() and json.loads(out.read_text()).get('snapshotHash')!=snapshot['snapshotHash']: raise ValueError('IMMUTABLE_SNAPSHOT_FILE_CONFLICT')
    out.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2)+'\n'); print(json.dumps({'snapshot':str(out),'signalId':snapshot['signalId'],'snapshotHash':snapshot['snapshotHash'],'ledgerHash':ledger['ledgerHash'],'portfolioDecision':snapshot['portfolioDecision'],'executionPolicyVersion':EXECUTION_POLICY_VERSION,'alreadyFrozen':False},indent=2))
if __name__=='__main__': main()
