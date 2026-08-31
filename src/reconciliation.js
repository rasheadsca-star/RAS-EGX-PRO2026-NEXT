import { sha256 } from './hash.js';
import { observationBarHash,verifyMarketObservationCertificate } from './market-observation-certification.js';

const DEFAULT_PRIORITY={OFFICIAL_EXCHANGE:100,LICENSED_EOD:95,PUBLIC_MARKET:70,REFERENCE_ONLY:20};
function valid(o){return o&&o.ticker&&o.session&&o.sourceId&&[o.open,o.high,o.low,o.close].every(v=>Number.isFinite(v)&&v>0)&&o.high>=o.open&&o.high>=o.close&&o.high>=o.low&&o.low<=o.open&&o.low<=o.close&&(o.volume==null||(Number.isFinite(o.volume)&&o.volume>=0))}
function pct(a,b){return a&&b?Math.abs(a/b-1)*100:Infinity}

export function reconcileObservations(observations,{maxCloseConflictPct=1,requireCrossCheck=true,priority=DEFAULT_PRIORITY,preferredPrimarySourceId=null}={}){
  if(!Array.isArray(observations)||observations.length===0)return{status:'SOURCE_UNAVAILABLE',reasons:['NO_OBSERVATIONS'],authoritative:null,sourceManifest:null};
  const bad=observations.filter(o=>!valid(o));
  if(bad.length)return{status:'BLOCKED',reasons:bad.map(o=>`INVALID_SOURCE_ROW:${o?.sourceId??'UNKNOWN'}`),authoritative:null,sourceManifest:null};
  const tickers=new Set(observations.map(o=>o.ticker)),sessions=new Set(observations.map(o=>o.session));
  if(tickers.size!==1||sessions.size!==1)return{status:'BLOCKED',reasons:['MIXED_TICKER_OR_SESSION'],authoritative:null,sourceManifest:null};
  if(preferredPrimarySourceId&&!observations.some(o=>o.sourceId===preferredPrimarySourceId))return{status:'BLOCKED',reasons:['PREFERRED_PRIMARY_SOURCE_MISSING'],authoritative:null,sourceManifest:null};
  const ordered=[...observations].sort((a,b)=>{
    if(preferredPrimarySourceId){if(a.sourceId===preferredPrimarySourceId&&b.sourceId!==preferredPrimarySourceId)return-1;if(b.sourceId===preferredPrimarySourceId&&a.sourceId!==preferredPrimarySourceId)return 1}
    return(priority[b.sourceClass]??0)-(priority[a.sourceClass]??0)||a.sourceId.localeCompare(b.sourceId)
  });
  const primary=ordered[0];
  const conflicts=ordered.slice(1).map(o=>({sourceId:o.sourceId,closeConflictPct:pct(o.close,primary.close),openConflictPct:pct(o.open,primary.open),highConflictPct:pct(o.high,primary.high),lowConflictPct:pct(o.low,primary.low)}));
  const material=conflicts.filter(c=>c.closeConflictPct>maxCloseConflictPct);
  const sourceManifest={ticker:primary.ticker,session:primary.session,primarySource:primary.sourceId,primaryClass:primary.sourceClass,sources:ordered.map(o=>({sourceId:o.sourceId,sourceClass:o.sourceClass,capturedAt:o.capturedAt??null,rowHash:sha256(o)})),conflicts};
  sourceManifest.manifestHash=sha256(sourceManifest);
  if(material.length)return{status:'DATA_CONFLICT',reasons:material.map(c=>`CLOSE_CONFLICT:${c.sourceId}:${c.closeConflictPct.toFixed(4)}%`),authoritative:null,sourceManifest};
  if(requireCrossCheck&&ordered.length<2)return{status:'SOURCE_UNAVAILABLE',reasons:['CROSS_CHECK_REQUIRED'],authoritative:null,sourceManifest};
  return{status:'READY',reasons:[],authoritative:{...primary},sourceManifest};
}

export function reconcileCertifiedObservations(entries,{acquisitionPlan,maxCloseConflictPct=1,priority=DEFAULT_PRIORITY}={}){
  if(!Array.isArray(entries)||!entries.length)return{status:'SOURCE_UNAVAILABLE',reasons:['NO_CERTIFIED_OBSERVATIONS'],authoritative:null,sourceManifest:null};
  if(acquisitionPlan?.state!=='READY')return{status:'BLOCKED',reasons:['ACQUISITION_PLAN_NOT_READY'],authoritative:null,sourceManifest:null};
  const reasons=[],observations=[];let primarySeen=false,crossSeen=false;const certificateHashes=[];
  for(const entry of entries){
    const o=entry?.observation,r=entry?.runtimeReceipt;
    if(!o||!r){reasons.push('CERTIFIED_ENTRY_INCOMPLETE');continue}
    const role=o.sourceId===acquisitionPlan.primary?'PRIMARY':(acquisitionPlan.crossChecks??[]).includes(o.sourceId)?'CROSSCHECK':null;
    if(!role){reasons.push(`SOURCE_NOT_IN_ACQUISITION_PLAN:${o.sourceId}`);continue}
    const v=verifyMarketObservationCertificate(r,{ticker:o.ticker,session:o.session,sourceId:o.sourceId,expectedBarHash:observationBarHash(o),acquisitionPlan});
    if(v.state!=='READY'){reasons.push(...v.reasons.map(x=>`${o.sourceId}:${x}`));continue}
    if(r.observationCertificate.role!==role)reasons.push(`${o.sourceId}:ROLE_MISMATCH`);
    if(role==='PRIMARY')primarySeen=true;else crossSeen=true;
    certificateHashes.push(r.observationCertificateHash);observations.push({...o});
  }
  if(!primarySeen)reasons.push('CERTIFIED_PRIMARY_MISSING');
  if(!crossSeen)reasons.push('CERTIFIED_CROSSCHECK_MISSING');
  if(reasons.length)return{status:'BLOCKED',reasons:[...new Set(reasons)].sort(),authoritative:null,sourceManifest:null};
  const result=reconcileObservations(observations,{maxCloseConflictPct,requireCrossCheck:true,priority,preferredPrimarySourceId:acquisitionPlan.primary});
  if(!result.sourceManifest)return result;
  if(result.status==='READY'&&result.authoritative?.sourceId!==acquisitionPlan.primary)return{status:'BLOCKED',reasons:['CERTIFIED_PRIMARY_NOT_AUTHORITATIVE'],authoritative:null,sourceManifest:result.sourceManifest};
  const primaryEntry=entries.find(x=>x?.observation?.sourceId===acquisitionPlan.primary);
  const crossEntries=entries.filter(x=>(acquisitionPlan.crossChecks??[]).includes(x?.observation?.sourceId));
  const sourceManifest={...result.sourceManifest,mode:'CERTIFIED_PRODUCTION',acquisitionPlanHash:sha256(acquisitionPlan),authoritativeBarHash:result.authoritative?observationBarHash(result.authoritative):null,primaryObservationCertificateHash:primaryEntry?.runtimeReceipt?.observationCertificateHash??null,crossCheckObservationCertificateHashes:crossEntries.map(x=>x.runtimeReceipt?.observationCertificateHash).filter(Boolean).sort(),observationCertificateHashes:[...new Set(certificateHashes)].sort()};
  delete sourceManifest.manifestHash;
  sourceManifest.manifestHash=sha256(sourceManifest);
  return{...result,sourceManifest};
}
