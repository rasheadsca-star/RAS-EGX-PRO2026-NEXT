import { reconcileCertifiedObservations } from './reconciliation.js';
import { sha256,canonicalize } from './hash.js';

export const CERTIFIED_RECONCILIATION_SCHEMA='egx-one-certified-reconciliation-envelope-1';

function finiteBar(o){return o&&o.ticker&&o.session&&[o.open,o.high,o.low,o.close].every(v=>Number.isFinite(v)&&v>0)&&(o.volume==null||(Number.isFinite(o.volume)&&o.volume>=0))}

export function createCertifiedReconciliationEnvelope({entries,acquisitionPlan,maxCloseConflictPct=1}){
  const result=reconcileCertifiedObservations(entries,{acquisitionPlan,maxCloseConflictPct});
  if(result.status!=='READY'||!result.authoritative||!result.sourceManifest)throw new Error(`CERTIFIED_RECONCILIATION_NOT_READY:${result.reasons?.join('|')??result.status}`);
  const body={schemaVersion:CERTIFIED_RECONCILIATION_SCHEMA,acquisitionPlan,maxCloseConflictPct,entries,authoritative:result.authoritative,sourceManifest:result.sourceManifest};
  return{...body,envelopeHash:sha256(body)};
}

export function verifyCertifiedReconciliationEnvelope(envelope){
  const reasons=[];
  if(!envelope||envelope.schemaVersion!==CERTIFIED_RECONCILIATION_SCHEMA)return{state:'BLOCKED',reasons:['RECONCILIATION_ENVELOPE_SCHEMA_INVALID']};
  const body={...envelope};delete body.envelopeHash;
  if(!/^[0-9a-f]{64}$/i.test(String(envelope.envelopeHash??''))||sha256(body)!==envelope.envelopeHash)reasons.push('RECONCILIATION_ENVELOPE_HASH_INVALID');
  if(!finiteBar(envelope.authoritative))reasons.push('RECONCILIATION_ENVELOPE_AUTHORITATIVE_BAR_INVALID');
  let rebuilt=null;
  try{rebuilt=reconcileCertifiedObservations(envelope.entries,{acquisitionPlan:envelope.acquisitionPlan,maxCloseConflictPct:envelope.maxCloseConflictPct})}catch{reasons.push('RECONCILIATION_ENVELOPE_REBUILD_FAILED')}
  if(!rebuilt||rebuilt.status!=='READY'||!rebuilt.authoritative||!rebuilt.sourceManifest)reasons.push('RECONCILIATION_ENVELOPE_NOT_CERTIFIED_READY');
  if(rebuilt?.authoritative&&canonicalize(rebuilt.authoritative)!==canonicalize(envelope.authoritative))reasons.push('RECONCILIATION_ENVELOPE_AUTHORITATIVE_MISMATCH');
  if(rebuilt?.sourceManifest&&canonicalize(rebuilt.sourceManifest)!==canonicalize(envelope.sourceManifest))reasons.push('RECONCILIATION_ENVELOPE_SOURCE_MANIFEST_MISMATCH');
  return reasons.length?{state:'BLOCKED',reasons:[...new Set(reasons)].sort()}:{state:'READY',reasons:[],authoritative:rebuilt.authoritative,sourceManifest:rebuilt.sourceManifest,envelopeHash:envelope.envelopeHash};
}

export function reconciliationEnvelopeMatchesRow(envelope,{reconciliationManifestHash,sourceManifestHash,ticker,session,primarySourceId,primaryObservationCertificateHash,bar=null}={}){
  const verified=verifyCertifiedReconciliationEnvelope(envelope);if(verified.state!=='READY')return false;
  const sm=verified.sourceManifest,a=verified.authoritative;
  if(sm.manifestHash!==reconciliationManifestHash||sha256(sm)!==sourceManifestHash||sm.ticker!==ticker||sm.session!==session||sm.primarySource!==primarySourceId||sm.primaryObservationCertificateHash!==primaryObservationCertificateHash)return false;
  if(a.ticker!==ticker||a.session!==session||a.sourceId!==primarySourceId)return false;
  if(bar){for(const k of ['open','high','low','close'])if(Number(a[k])!==Number(bar[k]))return false;if((a.volume??null)!==(bar.volume??null))return false}
  return true;
}