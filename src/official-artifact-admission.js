import { sha256 } from './hash.js';
import { validateSourceReceipt } from './source-provenance.js';
import { DEFAULT_SOURCE_POLICY } from './acquisition-policy.js';

const DIRECT_KINDS=new Set(['OFFICIAL_DIRECT_FILE','OFFICIAL_DIRECT_PAGE']);
const ARTIFACT_KINDS=new Set(['DAILY_BULLETIN_PDF','LISTED_SECURITIES_PDF','LISTED_SECURITIES_CSV','OFFICIAL_MARKET_JSON','OFFICIAL_MARKET_HTML']);
const MIME_BY_KIND=Object.freeze({
  DAILY_BULLETIN_PDF:new Set(['application/pdf']),
  LISTED_SECURITIES_PDF:new Set(['application/pdf']),
  LISTED_SECURITIES_CSV:new Set(['text/csv','application/csv','text/plain']),
  OFFICIAL_MARKET_JSON:new Set(['application/json','text/json']),
  OFFICIAL_MARKET_HTML:new Set(['text/html','application/xhtml+xml'])
});
function asBytes(rawBytes){if(Buffer.isBuffer(rawBytes))return rawBytes;if(rawBytes instanceof Uint8Array)return Buffer.from(rawBytes);return null}
function magicMatches(kind,bytes){if(kind.endsWith('_PDF'))return bytes.subarray(0,5).toString('ascii')==='%PDF-';if(kind==='OFFICIAL_MARKET_JSON'){try{JSON.parse(bytes.toString('utf8'));return true}catch{return false}}if(kind==='OFFICIAL_MARKET_HTML')return /<!doctype html|<html[\s>]/i.test(bytes.subarray(0,512).toString('utf8'));return true}

export function admitOfficialArtifact({artifact,rawBytes,sourceReceipt,calendarEntry=null,decisionTime=null}={}){
  const reasons=[];const bytes=asBytes(rawBytes);
  if(!artifact?.artifactKind||!ARTIFACT_KINDS.has(artifact.artifactKind)) reasons.push('INVALID_ARTIFACT_KIND');
  if(!artifact?.mimeType) reasons.push('MISSING_MIME_TYPE');
  const allowed=MIME_BY_KIND[artifact?.artifactKind];if(allowed&&artifact?.mimeType&&!allowed.has(artifact.mimeType))reasons.push('MIME_KIND_MISMATCH');
  if(!bytes) reasons.push('RAW_ARTIFACT_BYTES_REQUIRED');
  if(bytes&&artifact?.byteLength!==undefined&&artifact.byteLength!==bytes.length) reasons.push('BYTE_LENGTH_MISMATCH');
  if(bytes&&artifact?.artifactKind&&!magicMatches(artifact.artifactKind,bytes)) reasons.push('ARTIFACT_SIGNATURE_MISMATCH');
  const contentHash=bytes?sha256(bytes):null;
  if(artifact?.contentHash&&contentHash&&String(artifact.contentHash).toLowerCase()!==contentHash) reasons.push('ARTIFACT_CONTENT_HASH_MISMATCH');
  if(!sourceReceipt) reasons.push('MISSING_SOURCE_RECEIPT');
  let receiptResult=null;
  if(sourceReceipt&&bytes){
    receiptResult=validateSourceReceipt(sourceReceipt,{policy:DEFAULT_SOURCE_POLICY.OFFICIAL_EGX,calendarEntry,decisionTime,rawPayload:bytes});
    if(receiptResult.state!=='READY') reasons.push(...receiptResult.reasons.map(x=>`SOURCE_RECEIPT:${x}`));
    if(!DIRECT_KINDS.has(String(sourceReceipt.provenanceKind??'').toUpperCase())) reasons.push('SOURCE_NOT_DIRECT_OFFICIAL_CONTENT');
    if(artifact?.sourceUrl&&sourceReceipt.sourceUrl!==artifact.sourceUrl) reasons.push('ARTIFACT_RECEIPT_URL_MISMATCH');
    if(artifact?.session&&sourceReceipt.session!==artifact.session) reasons.push('ARTIFACT_RECEIPT_SESSION_MISMATCH');
  }
  const normalized={artifactKind:artifact?.artifactKind??null,mimeType:artifact?.mimeType??null,sourceUrl:artifact?.sourceUrl??sourceReceipt?.sourceUrl??null,session:artifact?.session??sourceReceipt?.session??null,byteLength:bytes?.length??null,contentHash,sourceReceiptHash:receiptResult?.receipt?.receiptHash??null};
  const admissionHash=sha256(normalized);
  return Object.freeze({state:reasons.length?'BLOCKED':'READY_FOR_SCHEMA_VALIDATION',reasons:[...new Set(reasons)].sort(),...normalized,admissionHash,schemaVerified:false,scopeVerified:false,universeAuthorityEligible:false,ohlcvAuthorityEligible:false});
}

export function bindExtractionManifest(admission,{extractorId,extractorVersion,schemaId,rowCount,outputHash,sourceAdmissionHash}={}){
  const reasons=[];
  if(admission?.state!=='READY_FOR_SCHEMA_VALIDATION') reasons.push('ARTIFACT_NOT_ADMITTED');
  if(!extractorId) reasons.push('MISSING_EXTRACTOR_ID');
  if(!extractorVersion) reasons.push('MISSING_EXTRACTOR_VERSION');
  if(!schemaId) reasons.push('MISSING_SCHEMA_ID');
  if(!Number.isInteger(rowCount)||rowCount<0) reasons.push('INVALID_ROW_COUNT');
  if(!/^[0-9a-f]{64}$/i.test(String(outputHash??''))) reasons.push('INVALID_OUTPUT_HASH');
  if(sourceAdmissionHash!==admission?.admissionHash) reasons.push('ADMISSION_HASH_MISMATCH');
  if(reasons.length)return Object.freeze({state:'BLOCKED',reasons:[...new Set(reasons)].sort(),manifest:null});
  const manifest={sourceAdmissionHash,sourceContentHash:admission.contentHash,extractorId,extractorVersion,schemaId,rowCount,outputHash:String(outputHash).toLowerCase()};
  manifest.manifestHash=sha256(manifest);
  return Object.freeze({state:'READY_FOR_SEMANTIC_VALIDATION',reasons:[],manifest:Object.freeze(manifest),universeAuthorityEligible:false,ohlcvAuthorityEligible:false});
}
