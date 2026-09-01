import { sha256 } from './hash.js';

function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v??''))}
function validHash(v){return /^[a-f0-9]{64}$/.test(String(v??''))}
function stablePlan(r){return {ticker:String(r.ticker).toUpperCase(),decision:String(r.decision),qualityScore:Number(r.qualityScore),entryLow:Number(r.entryLow),entryHigh:Number(r.entryHigh),stop:Number(r.stop),target1:Number(r.target1),target2:Number(r.target2),netRiskReward:Number(r.netRiskReward),entryExpirySessions:Number(r.entryExpirySessions),horizonSessions:Number(r.horizonSessions),planHash:String(r.planHash)}}
function ledgerBody(x){const {ledgerHash,...body}=x;return body}
function hashBound(x,key){if(!x||!validHash(x[key]))return false;const {[key]:claimed,...body}=x;return sha256(body)===claimed}

export function createForwardShadowLedger({startAfterSession}={}){
  if(!validDate(startAfterSession))throw new Error('SHADOW_LEDGER_START_SESSION_REQUIRED');const body={schemaVersion:'egx-one-forward-shadow-ledger-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,evidenceState:'FORWARD_SHADOW_PENDING_ONLY',forwardEvidence:false,startAfterSession:String(startAfterSession),entries:[],resolutions:[]};return Object.freeze({...body,ledgerHash:sha256(body)});
}

export function appendPublicationToForwardShadowLedger(ledger,{publication,regime}={}){
  if(!verifyForwardShadowLedger(ledger))throw new Error('SHADOW_LEDGER_INVALID');if(publication?.authorityMode!=='RESEARCH'||publication?.researchOnly!==true||publication?.productionAuthority!==false||publication?.automaticOrders!==false||!validDate(publication?.signalSession)||!hashBound(publication,'publicationHash'))throw new Error('SHADOW_PUBLICATION_INVALID');if(regime?.authorityMode!=='RESEARCH'||regime?.productionAuthority!==false||regime?.session!==publication.signalSession||!hashBound(regime,'regimeHash'))throw new Error('SHADOW_REGIME_INVALID');if(String(publication.signalSession)<=String(ledger.startAfterSession))return ledger;
  const existing=ledger.entries.find(x=>x.signalSession===publication.signalSession);if(existing){if(existing.publicationHash!==publication.publicationHash)throw new Error('SHADOW_SESSION_ALREADY_FROZEN_WITH_DIFFERENT_PUBLICATION');return ledger}
  const previousEntryHash=ledger.entries.at(-1)?.entryHash??null,base={signalSession:String(publication.signalSession),publicationHash:String(publication.publicationHash),sourceStrategySnapshotHash:String(publication.sourceStrategySnapshotHash),strategyId:String(publication.strategyId),regimeHash:String(regime.regimeHash),regime:String(regime.regime),previousEntryHash,captureClass:'HASH_BOUND_RESEARCH_PUBLICATION_BEFORE_FUTURE_RESOLUTION',resolutionState:'PENDING',plans:(publication.recommendations??[]).map(stablePlan)},entry=Object.freeze({...base,entryHash:sha256(base)}),body={...ledgerBody(ledger),entries:[...ledger.entries,entry]};return Object.freeze({...body,ledgerHash:sha256(body)});
}

export function verifyForwardShadowLedger(ledger){
  if(!ledger||ledger.schemaVersion!=='egx-one-forward-shadow-ledger-1'||ledger.authorityMode!=='RESEARCH'||ledger.researchOnly!==true||ledger.productionAuthority!==false||ledger.automaticOrders!==false||ledger.forwardEvidence!==false||!validDate(ledger.startAfterSession)||!Array.isArray(ledger.entries)||!Array.isArray(ledger.resolutions)||!validHash(ledger.ledgerHash))return false;if(sha256(ledgerBody(ledger))!==ledger.ledgerHash)return false;let prev=null;const seen=new Set();for(const e of ledger.entries){if(!validDate(e.signalSession)||e.signalSession<=ledger.startAfterSession||seen.has(e.signalSession)||e.previousEntryHash!==prev||!validHash(e.publicationHash)||!validHash(e.regimeHash)||!validHash(e.entryHash))return false;const {entryHash,...base}=e;if(sha256(base)!==entryHash)return false;for(const p of e.plans??[]){if(!p.ticker||!['BUY_CANDIDATE','WAIT_FOR_ENTRY'].includes(p.decision)||!validHash(p.planHash)||!(p.stop<p.entryLow&&p.entryLow<=p.entryHigh&&p.entryHigh<p.target1&&p.target1<p.target2))return false}seen.add(e.signalSession);prev=e.entryHash}return true;
}
