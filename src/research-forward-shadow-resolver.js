import { sha256 } from './hash.js';
import { verifyForwardShadowLedger } from './research-forward-shadow-ledger.js';
import { verifyForwardResolutionPolicy } from './research-forward-resolution-policy.js';

const TERMINAL=new Set(['TARGET1','TARGET2','STOP','TIMEOUT','NOT_TRIGGERED']);
function validHash(v){return /^[a-f0-9]{64}$/.test(String(v??''))}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v??''))}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function round(v,d=4){return Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null}
function ledgerBody(x){const {ledgerHash,...body}=x;return body}
function snapshotBody(x){const {snapshotHash,generatedAt,...body}=x;return body}

export function verifyResearchSessionSnapshot(snapshot){
  return Boolean(snapshot&&snapshot.schemaVersion==='egx-one-research-session-snapshot-2'&&snapshot.authorityMode==='RESEARCH'&&snapshot.researchOnly===true&&snapshot.productionAuthority===false&&validDate(snapshot.session)&&validHash(snapshot.snapshotHash)&&Array.isArray(snapshot.records)&&sha256(snapshotBody(snapshot))===snapshot.snapshotHash);
}

function validBar(b,session){const o=finite(b?.open),h=finite(b?.high),l=finite(b?.low),c=finite(b?.close),v=finite(b?.volume);return Boolean(b&&b.researchState==='READY_RESEARCH'&&String(b.session)===session&&o>0&&h>0&&l>0&&c>0&&v>=0&&h>=Math.max(o,c)&&l<=Math.min(o,c))}
function barFor(snapshot,ticker){
  const rec=(snapshot.records??[]).find(x=>String(x?.ticker??'').toUpperCase()===String(ticker).toUpperCase());
  if(rec?.state!=='READY_RESEARCH'||!validBar(rec?.authoritativeResearch,snapshot.session))return null;
  const b=rec.authoritativeResearch;return {session:snapshot.session,open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume),rowHash:validHash(b.rowHash)?b.rowHash:null,snapshotHash:snapshot.snapshotHash};
}
function resolutionBody(x){const {resolutionHash,...body}=x;return body}
export function verifyForwardResolution(r){
  if(!r||r.authorityMode!=='RESEARCH'||r.researchOnly!==true||r.productionAuthority!==false||r.automaticOrders!==false||!TERMINAL.has(r.state)||!validDate(r.signalSession)||!validDate(r.terminalSession)||r.terminalSession<=r.signalSession||!r.ticker||!validHash(r.planHash)||!validHash(r.resolutionPolicyHash)||!validHash(r.resolutionHash)||!Array.isArray(r.sourceSessionHashes)||r.sourceSessionHashes.some(x=>!validHash(x)))return false;
  if(r.triggerSession!=null&&(!validDate(r.triggerSession)||r.triggerSession<=r.signalSession||r.triggerSession>r.terminalSession))return false;
  if(r.state==='NOT_TRIGGERED'&&(r.triggerSession!=null||r.fill!=null||r.exit!=null||r.netReturnPct!=null))return false;
  if(r.state!=='NOT_TRIGGERED'&&(!(Number(r.fill)>0)||!(Number(r.exit)>0)||!Number.isFinite(Number(r.rMultiple))||!Number.isFinite(Number(r.netReturnPct))))return false;
  return sha256(resolutionBody(r))===r.resolutionHash;
}

export function evaluateForwardPlan({entry,plan,policy,sessionSnapshots=[]}={}){
  if(!verifyForwardResolutionPolicy(policy))throw new Error('FORWARD_RESOLUTION_POLICY_INVALID');
  if(policy.strategySnapshotHash!==entry?.sourceStrategySnapshotHash||!policy.sourcePlanHashes.includes(plan?.planHash))throw new Error('FORWARD_RESOLUTION_POLICY_LINEAGE_MISMATCH');
  if(!(plan.stop<plan.entryLow&&plan.entryLow<=plan.entryHigh&&plan.entryHigh<plan.target1&&plan.target1<plan.target2))throw new Error('FORWARD_RESOLUTION_PLAN_GEOMETRY_INVALID');
  const snaps=[...sessionSnapshots].filter(s=>String(s?.session)>String(entry.signalSession)).sort((a,b)=>String(a.session).localeCompare(String(b.session)));
  for(const s of snaps)if(!verifyResearchSessionSnapshot(s))throw new Error(`FORWARD_SESSION_SNAPSHOT_INVALID:${s?.session??'UNKNOWN'}`);
  const horizon=Math.max(1,Number(plan.horizonSessions)||0),expiry=Math.max(1,Number(plan.entryExpirySessions)||0),used=[];let triggerSession=null,fill=null,risk=null;
  for(let i=0;i<Math.min(snaps.length,horizon);i++){
    const snap=snaps[i],bar=barFor(snap,plan.ticker);
    if(!bar)return {state:'PENDING_EVIDENCE_GAP',signalSession:entry.signalSession,ticker:plan.ticker,missingSession:snap.session,observedSessions:used.map(x=>x.session)};
    used.push(bar);
    if(triggerSession==null){
      if(i<expiry&&bar.low<=Number(plan.entryHigh)&&bar.high>=Number(plan.entryLow)){triggerSession=bar.session;fill=Number(plan.entryHigh);risk=fill-Number(plan.stop);if(!(risk>0))throw new Error('FORWARD_RESOLUTION_RISK_INVALID')}
      else if(i===expiry-1){return makeResolution({entry,plan,policy,state:'NOT_TRIGGERED',triggerSession:null,terminalSession:bar.session,fill:null,exit:null,rMultiple:null,netReturnPct:null,used})}
    }
    if(triggerSession!=null){
      const stopHit=bar.low<=Number(plan.stop),t2Hit=bar.high>=Number(plan.target2),t1Hit=bar.high>=Number(plan.target1),costR=(fill*(Number(policy.costAssumptionBps)/10000))/risk;
      if(stopHit)return makeResolution({entry,plan,policy,state:'STOP',triggerSession,terminalSession:bar.session,fill,exit:Number(plan.stop),rMultiple:round(-1-costR),netReturnPct:round((Number(plan.stop)/fill-1)*100-Number(policy.costAssumptionBps)/100),used});
      if(t2Hit)return makeResolution({entry,plan,policy,state:'TARGET2',triggerSession,terminalSession:bar.session,fill,exit:Number(plan.target2),rMultiple:round((Number(plan.target2)-fill)/risk-costR),netReturnPct:round((Number(plan.target2)/fill-1)*100-Number(policy.costAssumptionBps)/100),used});
      if(t1Hit)return makeResolution({entry,plan,policy,state:'TARGET1',triggerSession,terminalSession:bar.session,fill,exit:Number(plan.target1),rMultiple:round((Number(plan.target1)-fill)/risk-costR),netReturnPct:round((Number(plan.target1)/fill-1)*100-Number(policy.costAssumptionBps)/100),used});
      if(i===horizon-1)return makeResolution({entry,plan,policy,state:'TIMEOUT',triggerSession,terminalSession:bar.session,fill,exit:bar.close,rMultiple:round((bar.close-fill)/risk-costR),netReturnPct:round((bar.close/fill-1)*100-Number(policy.costAssumptionBps)/100),used});
    }
  }
  return {state:'PENDING_AWAITING_FUTURE_SESSION',signalSession:entry.signalSession,ticker:plan.ticker,observedSessions:used.map(x=>x.session),requiredHorizonSessions:horizon,entryExpirySessions:expiry};
}

function makeResolution({entry,plan,policy,state,triggerSession,terminalSession,fill,exit,rMultiple,netReturnPct,used}){
  const body={schemaVersion:'egx-one-forward-resolution-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,evidenceGrade:'FORWARD_SHADOW_FROZEN',evidenceClass:'FUTURE_READY_RESEARCH_SESSION_SNAPSHOTS_ONLY',sameBarAmbiguity:'STOP_FIRST',signalSession:String(entry.signalSession),ticker:String(plan.ticker).toUpperCase(),planHash:String(plan.planHash),state,triggerSession,terminalSession,fill:round(fill),exit:round(exit),rMultiple:round(rMultiple),netReturnPct:round(netReturnPct),resolutionPolicyHash:String(policy.policyHash),sourceSessionHashes:used.map(x=>x.snapshotHash)};
  return Object.freeze({...body,resolutionHash:sha256(body)});
}

export function resolveForwardShadowLedger({ledger,policies=[],sessionSnapshots=[]}={}){
  if(!verifyForwardShadowLedger(ledger))throw new Error('FORWARD_LEDGER_INVALID_BEFORE_RESOLUTION');
  const policyMap=new Map(policies.filter(verifyForwardResolutionPolicy).map(p=>[p.strategySnapshotHash,p])),existing=new Set((ledger.resolutions??[]).map(r=>`${r.signalSession}:${r.ticker}:${r.planHash}`));
  for(const r of ledger.resolutions??[])if(!verifyForwardResolution(r))throw new Error(`EXISTING_FORWARD_RESOLUTION_INVALID:${r?.ticker??'UNKNOWN'}`);
  const added=[],pending=[];
  for(const entry of ledger.entries??[]){
    const policy=policyMap.get(entry.sourceStrategySnapshotHash);if(!policy){pending.push({signalSession:entry.signalSession,state:'PENDING_POLICY_MISSING'});continue}
    for(const plan of entry.plans??[]){const key=`${entry.signalSession}:${plan.ticker}:${plan.planHash}`;if(existing.has(key))continue;const outcome=evaluateForwardPlan({entry,plan,policy,sessionSnapshots});if(TERMINAL.has(outcome.state)){added.push(outcome);existing.add(key)}else pending.push(outcome)}
  }
  if(!added.length)return {ledger,added,pending};
  const body={...ledgerBody(ledger),resolutions:[...(ledger.resolutions??[]),...added]};const next=Object.freeze({...body,ledgerHash:sha256(body)});
  if(!verifyForwardShadowLedger(next))throw new Error('FORWARD_LEDGER_INVALID_AFTER_RESOLUTION');
  return {ledger:next,added,pending};
}
