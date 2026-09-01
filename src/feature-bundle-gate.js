import { sha256, canonicalize } from './hash.js';
import { verifyHistoricalObservationLineage } from './historical-observation-lineage.js';

const BLOCKING_PRIORITY=['DATA_CONFLICT','CORPORATE_ACTION_REVIEW','SOURCE_UNAVAILABLE','STALE','BLOCKED'];
const HEX64=/^[0-9a-f]{64}$/i;

export function buildProductionFeatureInputLineage({ticker,signalSession,productionSnapshotId,normalizedDataVersion,currentObservationCertificateHash,requiredHistorySessions=[],historicalLineageCertificates=[]}={}){
  const reasons=[];
  if(!ticker)reasons.push('PRODUCTION_FEATURE_TICKER_REQUIRED');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(signalSession??'')))reasons.push('PRODUCTION_FEATURE_SIGNAL_SESSION_INVALID');
  if(!productionSnapshotId)reasons.push('PRODUCTION_FEATURE_SNAPSHOT_REQUIRED');
  if(!HEX64.test(String(normalizedDataVersion??'')))reasons.push('PRODUCTION_FEATURE_NORMALIZED_DATA_VERSION_INVALID');
  if(!HEX64.test(String(currentObservationCertificateHash??'')))reasons.push('PRODUCTION_FEATURE_CURRENT_OBSERVATION_CERTIFICATE_INVALID');
  const required=[...new Set((requiredHistorySessions??[]).map(String))].sort();
  if(required.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)||x>=String(signalSession??'')))reasons.push('PRODUCTION_FEATURE_HISTORY_SESSION_SET_INVALID');
  const entries=[];const seen=new Set();
  for(const certificate of historicalLineageCertificates??[]){
    const verified=verifyHistoricalObservationLineage(certificate);
    if(verified.state!=='READY'){reasons.push('PRODUCTION_FEATURE_HISTORY_CERTIFICATE_INVALID');continue}
    if(certificate.ticker!==ticker){reasons.push('PRODUCTION_FEATURE_HISTORY_TICKER_MISMATCH');continue}
    if(certificate.dataSnapshotId!==productionSnapshotId){reasons.push('PRODUCTION_FEATURE_HISTORY_SNAPSHOT_MISMATCH');continue}
    if(certificate.session>=signalSession){reasons.push('PRODUCTION_FEATURE_HISTORY_LOOKAHEAD');continue}
    if(seen.has(certificate.session)){reasons.push('PRODUCTION_FEATURE_HISTORY_DUPLICATE_SESSION');continue}
    seen.add(certificate.session);
    entries.push({session:certificate.session,certificateHash:certificate.certificateHash,barHash:certificate.barHash,sourceId:certificate.sourceId,sourceClass:certificate.sourceClass,sourceReceiptHash:certificate.sourceReceipt?.receiptHash??null});
  }
  entries.sort((a,b)=>a.session.localeCompare(b.session));
  const actual=entries.map(x=>x.session);
  if(canonicalize(actual)!==canonicalize(required))reasons.push('PRODUCTION_FEATURE_HISTORY_COVERAGE_MISMATCH');
  if(reasons.length)return{state:'BLOCKED',reasons:[...new Set(reasons)].sort(),historicalLineageManifestHash:null,inputLineageHash:null,manifest:null};
  const historicalManifest={ticker,signalSession,productionSnapshotId,requiredHistorySessions:required,certificates:entries};
  const historicalLineageManifestHash=sha256(historicalManifest);
  const manifest={ticker,signalSession,productionSnapshotId,normalizedDataVersion,currentObservationCertificateHash,historicalLineageManifestHash};
  return{state:'READY',reasons:[],historicalLineageManifestHash,inputLineageHash:sha256(manifest),manifest};
}

export function validateFeatureBundle(bundle,{signalSession,decisionCutoff,requiredGroups=['TECHNICAL','LIQUIDITY','CORPORATE_ACTIONS'],currentSessionGroups=['TECHNICAL','LIQUIDITY'],maxAgeDays={},authorityMode='RESEARCH',ticker=null,productionSnapshotId=null,normalizedDataVersion=null,currentObservationCertificateHash=null,requiredHistorySessions=[],historicalLineageCertificates=[],lineageBoundGroups=['TECHNICAL','LIQUIDITY']}={}){
  if(!signalSession||!decisionCutoff) throw new Error('FEATURE_GATE_CONTEXT_REQUIRED');
  const cutoff=Date.parse(decisionCutoff); if(!Number.isFinite(cutoff)) throw new Error('INVALID_DECISION_CUTOFF');
  const mode=String(authorityMode??'RESEARCH').toUpperCase();
  if(!['RESEARCH','CERTIFIED_PRODUCTION'].includes(mode))throw new Error('INVALID_FEATURE_AUTHORITY_MODE');
  const reasons=[]; const normalized=[]; let state='READY';
  const requiredUpper=requiredGroups.map(x=>String(x).toUpperCase());
  const currentUpper=currentSessionGroups.map(x=>String(x).toUpperCase());
  const lineageUpper=lineageBoundGroups.map(x=>String(x).toUpperCase());
  let productionLineage=null;
  if(mode==='CERTIFIED_PRODUCTION'){
    if(requiredUpper.some(x=>lineageUpper.includes(x))&&!(requiredHistorySessions??[]).length){reasons.push('PRODUCTION_FEATURE_HISTORY_SESSIONS_REQUIRED');state=pickState(state,'BLOCKED')}
    productionLineage=buildProductionFeatureInputLineage({ticker,signalSession,productionSnapshotId,normalizedDataVersion,currentObservationCertificateHash,requiredHistorySessions,historicalLineageCertificates});
    if(productionLineage.state!=='READY'){for(const reason of productionLineage.reasons)reasons.push(reason);state=pickState(state,'BLOCKED')}
  }
  const byName=new Map((bundle?.groups??[]).map(g=>[String(g.name??'').toUpperCase(),g]));
  for(const nameRaw of requiredGroups){
    const name=String(nameRaw).toUpperCase(); const g=byName.get(name);
    if(!g){reasons.push(`${name}:MISSING`);state=pickState(state,'SOURCE_UNAVAILABLE');continue}
    const groupState=String(g.state??'BLOCKED').toUpperCase();
    if(groupState!=='READY'){reasons.push(`${name}:STATE:${groupState}`);state=pickState(state,BLOCKING_PRIORITY.includes(groupState)?groupState:'BLOCKED')}
    if(!g.sourceVersion){reasons.push(`${name}:MISSING_SOURCE_VERSION`);state=pickState(state,'BLOCKED')}
    if(!g.featureVersion){reasons.push(`${name}:MISSING_FEATURE_VERSION`);state=pickState(state,'BLOCKED')}
    const available=Date.parse(g.availableAt);if(!Number.isFinite(available)){reasons.push(`${name}:INVALID_AVAILABLE_AT`);state=pickState(state,'BLOCKED')}
    else if(available>cutoff){reasons.push(`${name}:LOOKAHEAD_AVAILABLE_AT:${g.availableAt}`);state=pickState(state,'BLOCKED')}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(g.asOfSession??''))){reasons.push(`${name}:INVALID_AS_OF_SESSION`);state=pickState(state,'BLOCKED')}
    else {
      if(g.asOfSession>signalSession){reasons.push(`${name}:LOOKAHEAD_SESSION:${g.asOfSession}`);state=pickState(state,'BLOCKED')}
      if(currentUpper.includes(name)&&g.asOfSession!==signalSession){reasons.push(`${name}:STALE_DEPENDENT_FEATURE:${g.asOfSession}`);state=pickState(state,'STALE')}
    }
    if(mode==='CERTIFIED_PRODUCTION'&&lineageUpper.includes(name)){
      if(g.sourceVersion!==normalizedDataVersion){reasons.push(`${name}:PRODUCTION_SOURCE_VERSION_MISMATCH`);state=pickState(state,'BLOCKED')}
      if(!HEX64.test(String(g.payloadHash??''))){reasons.push(`${name}:PRODUCTION_PAYLOAD_HASH_REQUIRED`);state=pickState(state,'BLOCKED')}
      if(!productionLineage?.inputLineageHash||g.inputLineageHash!==productionLineage.inputLineageHash){reasons.push(`${name}:PRODUCTION_INPUT_LINEAGE_MISMATCH`);state=pickState(state,'BLOCKED')}
    }
    const max=maxAgeDays[name];
    if(Number.isFinite(max)&&max>=0&&Number.isFinite(available)){
      const signalEnd=Date.parse(`${signalSession}T23:59:59Z`);const age=(signalEnd-available)/86400000;
      if(age>max){reasons.push(`${name}:FEATURE_TOO_OLD_DAYS:${age.toFixed(1)}>${max}`);state=pickState(state,'STALE')}
    }
    normalized.push({name,state:groupState,asOfSession:g.asOfSession??null,availableAt:g.availableAt??null,sourceVersion:g.sourceVersion??null,featureVersion:g.featureVersion??null,payloadHash:g.payloadHash??null,inputLineageHash:g.inputLineageHash??null});
  }
  normalized.sort((a,b)=>a.name.localeCompare(b.name));
  const manifest={authorityMode:mode,signalSession,decisionCutoff,ticker:mode==='CERTIFIED_PRODUCTION'?ticker:null,productionSnapshotId:mode==='CERTIFIED_PRODUCTION'?productionSnapshotId:null,normalizedDataVersion:mode==='CERTIFIED_PRODUCTION'?normalizedDataVersion:null,productionInputLineageHash:mode==='CERTIFIED_PRODUCTION'?productionLineage?.inputLineageHash??null:null,groups:normalized};
  return Object.freeze({state,ready:state==='READY',reasons:[...new Set(reasons)].sort(),manifestHash:sha256(manifest),manifest,productionLineage});
}

function pickState(current,next){
  const rank={READY:0,STALE:1,SOURCE_UNAVAILABLE:2,CORPORATE_ACTION_REVIEW:3,DATA_CONFLICT:4,BLOCKED:5};
  return (rank[next]??5)>(rank[current]??0)?next:current;
}
