import { sha256 } from './hash.js';
import { assertResearchOnly,stampResearchRecord } from './research-source-policy.js';

const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const LATEST_CONFLICT_RE=/^latest_close_conflict(?::|=)/i;

function tickerOf(value){return String(value??'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9._-]/g,'')}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function uniqueStrings(values){return [...new Set((values??[]).filter(Boolean).map(v=>String(v)))].sort()}

function normalizeSession(row){
  const session=String(row?.session??row?.date??'').slice(0,10);
  const open=finite(row?.open),high=finite(row?.high),low=finite(row?.low),close=finite(row?.close),volume=row?.volume==null?null:finite(row.volume);
  const reasons=[];
  if(!DATE_RE.test(session)) reasons.push('INVALID_SESSION_DATE');
  for(const [name,value] of [['open',open],['high',high],['low',low],['close',close]]) if(!(value>0)) reasons.push(`INVALID_${name.toUpperCase()}`);
  if(high!=null&&open!=null&&high<open) reasons.push('HIGH_LT_OPEN');
  if(high!=null&&close!=null&&high<close) reasons.push('HIGH_LT_CLOSE');
  if(low!=null&&open!=null&&low>open) reasons.push('LOW_GT_OPEN');
  if(low!=null&&close!=null&&low>close) reasons.push('LOW_GT_CLOSE');
  if(high!=null&&low!=null&&high<low) reasons.push('HIGH_LT_LOW');
  if(volume!=null&&volume<0) reasons.push('INVALID_VOLUME');
  return {session,open,high,low,close,adjustedClose:finite(row?.adjustedClose),volume,currency:row?.currency??'EGP',originalPrimarySource:row?.primarySource??null,originalValidationStatus:row?.validationStatus??null,originalConfidence:row?.confidence??null,originalWarnings:uniqueStrings(row?.warnings),originalSourceUrls:row?.sourceUrls??null,reasons};
}

export function importLegacyHistoryFile(legacy,{legacyCommit,sourcePath,sourceFileHash,importedAt=null}={}){
  const reasons=[];
  const ticker=tickerOf(legacy?.ticker??legacy?.symbol??sourcePath?.split('/').pop()?.replace(/\.json$/i,''));
  if(!ticker) reasons.push('MISSING_TICKER');
  if(!legacyCommit||!/^[0-9a-f]{40}$/i.test(String(legacyCommit))) reasons.push('INVALID_LEGACY_COMMIT');
  if(!sourcePath) reasons.push('MISSING_SOURCE_PATH');
  if(!sourceFileHash||!/^[0-9a-f]{64}$/i.test(String(sourceFileHash))) reasons.push('INVALID_SOURCE_FILE_HASH');
  const sourceSessions=Array.isArray(legacy?.sessions)?legacy.sessions:(Array.isArray(legacy?.bars)?legacy.bars:[]);
  if(!sourceSessions.length) reasons.push('NO_LEGACY_SESSIONS');
  if(reasons.length) return {state:'BLOCKED',reasons,dataset:null};

  const normalized=sourceSessions.map(normalizeSession).sort((a,b)=>a.session.localeCompare(b.session));
  const seen=new Set();
  const duplicate=[];
  for(const row of normalized){if(row.session&&seen.has(row.session))duplicate.push(row.session);seen.add(row.session)}
  if(duplicate.length) return {state:'BLOCKED',reasons:[...new Set(duplicate)].sort().map(x=>`DUPLICATE_SESSION:${x}`),dataset:null};

  const legacyWarnings=uniqueStrings(legacy?.warnings);
  const latestConflict=legacyWarnings.find(x=>LATEST_CONFLICT_RE.test(x))??null;
  const latestSession=normalized.at(-1)?.session??null;
  const identityUnverified=legacy?.symbolVerified===false||legacy?.identityVerified===false;
  const datasetWarnings=uniqueStrings([
    ...legacyWarnings,
    legacy?.staleData===true?'LEGACY_STALE_DATA_FLAG':null,
    legacy?.updateFailed===true?'LEGACY_UPDATE_FAILED_FLAG':null,
    identityUnverified?'LEGACY_SYMBOL_IDENTITY_UNVERIFIED':null,
    legacy?.officiallyVerifiedLatestSession===false?'LEGACY_LATEST_SESSION_NOT_OFFICIALLY_VERIFIED':null
  ]);

  const sessions=normalized.map(row=>{
    const quarantineReasons=[...row.reasons];
    if(identityUnverified) quarantineReasons.push('IDENTITY_UNVERIFIED');
    if(latestConflict&&row.session===latestSession) quarantineReasons.push(`CROSS_SOURCE_CONFLICT:${latestConflict}`);
    const researchState=quarantineReasons.length?'QUARANTINED_RESEARCH':'READY_RESEARCH';
    const stamped=stampResearchRecord({ticker,session:row.session,open:row.open,high:row.high,low:row.low,close:row.close,adjustedClose:row.adjustedClose,volume:row.volume,currency:row.currency,researchState,quarantineReasons:uniqueStrings(quarantineReasons),legacyEvidence:{primarySource:row.originalPrimarySource,validationStatus:row.originalValidationStatus,confidence:row.originalConfidence,warnings:row.originalWarnings,sourceUrls:row.originalSourceUrls}}, {sourceId:'LEGACY_IMPORT'});
    assertResearchOnly(stamped);
    return stamped;
  });

  const stableDataset={
    schemaVersion:'egx-one-research-history-1',
    ticker,
    companyNameAr:legacy?.companyNameAr??null,
    companyNameEn:legacy?.companyNameEn??null,
    authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,
    provenance:{sourceId:'LEGACY_IMPORT',sourceClass:'LEGACY_IMPORT',legacyCommit:String(legacyCommit).toLowerCase(),sourcePath:String(sourcePath),sourceFileHash:String(sourceFileHash).toLowerCase(),legacySchemaVersion:legacy?.schemaVersion??null,legacyGeneratedAt:legacy?.generatedAt??null,legacyPrimarySource:legacy?.primarySource??null,legacyVerificationSources:uniqueStrings(legacy?.verificationSources)},
    metadata:{availableSessions:sessions.length,firstSession:sessions[0]?.session??null,lastSession:sessions.at(-1)?.session??null,readyResearchSessions:sessions.filter(x=>x.researchState==='READY_RESEARCH').length,quarantinedResearchSessions:sessions.filter(x=>x.researchState==='QUARANTINED_RESEARCH').length,legacyHistoryStatus:legacy?.historyStatus??null,warnings:datasetWarnings},
    sessions
  };
  const datasetHash=sha256(stableDataset);
  const dataset=Object.freeze({...stableDataset,datasetHash,importedAt:importedAt??legacy?.generatedAt??null});
  return {state:'IMPORTED_RESEARCH',reasons:[],dataset};
}

export function verifyResearchHistoryDataset(dataset){
  const reasons=[];
  if(dataset?.schemaVersion!=='egx-one-research-history-1') reasons.push('INVALID_SCHEMA_VERSION');
  if(dataset?.authorityMode!=='RESEARCH'||dataset?.researchOnly!==true||dataset?.productionAuthority!==false) reasons.push('RESEARCH_AUTHORITY_BOUNDARY_VIOLATION');
  const {datasetHash,importedAt,...stable}=dataset??{};
  if(!/^[0-9a-f]{64}$/i.test(String(datasetHash??''))||sha256(stable)!==datasetHash) reasons.push('DATASET_HASH_MISMATCH');
  const sessions=Array.isArray(dataset?.sessions)?dataset.sessions:[];
  let prior='';const seen=new Set();
  for(const row of sessions){
    try{assertResearchOnly(row)}catch{reasons.push(`ROW_AUTHORITY_VIOLATION:${row?.session??'UNKNOWN'}`)}
    if(!DATE_RE.test(String(row?.session??'')))reasons.push(`INVALID_SESSION:${row?.session??'UNKNOWN'}`);
    if(seen.has(row?.session))reasons.push(`DUPLICATE_SESSION:${row.session}`);seen.add(row?.session);
    if(prior&&row.session<=prior)reasons.push(`NON_MONOTONIC_SESSION:${row.session}`);prior=row?.session??prior;
  }
  return {state:reasons.length?'BLOCKED':'READY',reasons:[...new Set(reasons)].sort()};
}
