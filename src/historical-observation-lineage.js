import { sha256,canonicalize } from './hash.js';
import { validateSourceReceipt } from './source-provenance.js';
import { DEFAULT_SOURCE_POLICY } from './acquisition-policy.js';

export const HISTORICAL_LINEAGE_SCHEMA='egx-one-historical-observation-lineage-2';
const NON_RAW_KINDS=new Set(['SEARCH_SNIPPET','SEARCH_RESULT','MANUAL_TRANSCRIPTION']);
const HEX64=/^[0-9a-f]{64}$/i;
const PARSERS=Object.freeze({
  OFFICIAL_EGX_JSON_BAR_V1:{version:'1',sourceIds:new Set(['OFFICIAL_EGX'])},
  LICENSED_EOD_JSON_BAR_V1:{version:'1',sourceIds:new Set(['LICENSED_EOD'])}
});

function validBar(bar){return !!bar?.ticker&&!!bar?.session&&[bar.open,bar.high,bar.low,bar.close].every(v=>Number.isFinite(v)&&v>0)&&bar.high>=Math.max(bar.open,bar.low,bar.close)&&bar.low<=Math.min(bar.open,bar.high,bar.close)&&(bar.volume==null||(Number.isFinite(bar.volume)&&bar.volume>=0))}
function normalizeBar(x){const bar={ticker:String(x?.ticker??''),session:String(x?.session??''),open:Number(x?.open),high:Number(x?.high),low:Number(x?.low),close:Number(x?.close),volume:x?.volume==null?null:Number(x.volume)};return validBar(bar)?bar:null}
function rawObject(rawPayload){if(rawPayload&&typeof rawPayload==='object'&&!Array.isArray(rawPayload))return rawPayload;if(typeof rawPayload==='string'){try{const x=JSON.parse(rawPayload);return x&&typeof x==='object'&&!Array.isArray(x)?x:null}catch{return null}}return null}
export function extractHistoricalBar(rawPayload,{parserId,parserVersion,sourceId}={}){
  const spec=PARSERS[parserId];
  if(!spec||spec.version!==String(parserVersion??'')||!spec.sourceIds.has(sourceId))return{state:'BLOCKED',reasons:['HISTORICAL_PARSER_UNSUPPORTED'],bar:null};
  const raw=rawObject(rawPayload),candidate=raw?.bar??raw;
  const bar=normalizeBar(candidate);
  return bar?{state:'READY',reasons:[],bar}:{state:'BLOCKED',reasons:['HISTORICAL_PARSER_OUTPUT_INVALID'],bar:null};
}
export function historicalBarHash(bar){return sha256({ticker:bar.ticker,session:bar.session,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume??null})}

export function createHistoricalObservationLineage({dataSnapshotId,bar,receipt,rawPayload,parserId,parserVersion,sourcePolicy=DEFAULT_SOURCE_POLICY}){
  if(!dataSnapshotId)throw new Error('HISTORICAL_LINEAGE_SNAPSHOT_REQUIRED');
  if(!validBar(bar))throw new Error('HISTORICAL_LINEAGE_BAR_INVALID');
  const policy=sourcePolicy?.[receipt?.sourceId];
  if(!policy||policy.mayAuthorizeHistoricalProduction!==true)throw new Error('HISTORICAL_SOURCE_NOT_PRODUCTION_AUTHORIZED');
  if(NON_RAW_KINDS.has(String(receipt?.provenanceKind??'').toUpperCase()))throw new Error('HISTORICAL_LINEAGE_NON_RAW_EVIDENCE');
  const checked=validateSourceReceipt(receipt,{policy,rawPayload});
  if(checked.state!=='READY')throw new Error(`HISTORICAL_LINEAGE_RECEIPT_INVALID:${checked.reasons.join('|')}`);
  if(checked.receipt.session!==bar.session)throw new Error('HISTORICAL_LINEAGE_SESSION_MISMATCH');
  const extracted=extractHistoricalBar(rawPayload,{parserId,parserVersion,sourceId:checked.receipt.sourceId});
  if(extracted.state!=='READY')throw new Error(extracted.reasons[0]);
  const normalizedInput=normalizeBar(bar);
  if(canonicalize(extracted.bar)!==canonicalize(normalizedInput))throw new Error('HISTORICAL_LINEAGE_EXTRACTED_BAR_MISMATCH');
  const barHash=historicalBarHash(normalizedInput);
  const extractionProofHash=sha256({sourceContentHash:checked.receipt.contentHash,parserId,parserVersion:String(parserVersion),barHash,extractedBar:extracted.bar});
  const body={schemaVersion:HISTORICAL_LINEAGE_SCHEMA,dataSnapshotId,ticker:normalizedInput.ticker,session:normalizedInput.session,sourceId:checked.receipt.sourceId,sourceClass:checked.receipt.sourceClass,providerGroup:checked.receipt.providerGroup,sourceReceipt:checked.receipt,rawPayload,parserId,parserVersion:String(parserVersion),bar:normalizedInput,barHash,extractionProofHash};
  return{...body,certificateHash:sha256(body)};
}

export function verifyHistoricalObservationLineage(certificate,{sourcePolicy=DEFAULT_SOURCE_POLICY}={}){
  const reasons=[];
  if(!certificate||certificate.schemaVersion!==HISTORICAL_LINEAGE_SCHEMA)return{state:'BLOCKED',reasons:['HISTORICAL_LINEAGE_SCHEMA_INVALID']};
  const policy=sourcePolicy?.[certificate.sourceId];
  if(!policy||policy.mayAuthorizeHistoricalProduction!==true)reasons.push('HISTORICAL_SOURCE_NOT_PRODUCTION_AUTHORIZED');
  if(policy&&certificate.sourceClass!==policy.sourceClass)reasons.push('HISTORICAL_SOURCE_CLASS_MISMATCH');
  if(policy&&certificate.providerGroup!==policy.providerGroup)reasons.push('HISTORICAL_PROVIDER_GROUP_MISMATCH');
  if(NON_RAW_KINDS.has(String(certificate.sourceReceipt?.provenanceKind??'').toUpperCase()))reasons.push('HISTORICAL_LINEAGE_NON_RAW_EVIDENCE');
  if(!validBar(certificate.bar))reasons.push('HISTORICAL_LINEAGE_BAR_INVALID');
  if(certificate.ticker!==certificate.bar?.ticker||certificate.session!==certificate.bar?.session)reasons.push('HISTORICAL_LINEAGE_BAR_IDENTITY_MISMATCH');
  const checked=validateSourceReceipt(certificate.sourceReceipt,{policy,rawPayload:certificate.rawPayload});
  if(checked.state!=='READY')reasons.push(...checked.reasons.map(x=>`HISTORICAL_RECEIPT:${x}`));
  if(checked.receipt?.session!==certificate.session)reasons.push('HISTORICAL_LINEAGE_SESSION_MISMATCH');
  const extracted=extractHistoricalBar(certificate.rawPayload,{parserId:certificate.parserId,parserVersion:certificate.parserVersion,sourceId:certificate.sourceId});
  if(extracted.state!=='READY')reasons.push(...extracted.reasons);
  else if(canonicalize(extracted.bar)!==canonicalize(certificate.bar))reasons.push('HISTORICAL_LINEAGE_EXTRACTED_BAR_MISMATCH');
  const barHash=validBar(certificate.bar)?historicalBarHash(certificate.bar):null;
  if(barHash!==certificate.barHash)reasons.push('HISTORICAL_LINEAGE_BAR_HASH_MISMATCH');
  const extractionProofHash=barHash&&extracted.state==='READY'?sha256({sourceContentHash:certificate.sourceReceipt?.contentHash,parserId:certificate.parserId,parserVersion:String(certificate.parserVersion),barHash,extractedBar:extracted.bar}):null;
  if(extractionProofHash!==certificate.extractionProofHash)reasons.push('HISTORICAL_LINEAGE_EXTRACTION_PROOF_INVALID');
  const body={...certificate};delete body.certificateHash;
  if(!HEX64.test(String(certificate.certificateHash??''))||sha256(body)!==certificate.certificateHash)reasons.push('HISTORICAL_LINEAGE_CERTIFICATE_HASH_INVALID');
  return reasons.length?{state:'BLOCKED',reasons:[...new Set(reasons)].sort()}:{state:'READY',reasons:[],certificateHash:certificate.certificateHash,barHash};
}

export function historicalLineageMatchesBar(certificate,{dataSnapshotId,ticker,session,open,high,low,close,volume=null}={}){
  const v=verifyHistoricalObservationLineage(certificate);if(v.state!=='READY')return false;
  if(certificate.dataSnapshotId!==dataSnapshotId||certificate.ticker!==ticker||certificate.session!==session)return false;
  return canonicalize(certificate.bar)===canonicalize({ticker,session,open:Number(open),high:Number(high),low:Number(low),close:Number(close),volume:volume==null?null:Number(volume)});
}
