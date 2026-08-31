import { sha256 } from './hash.js';

const HEX64=/^[0-9a-f]{64}$/i;
const REQUIRED_UNIVERSE_FIELDS=Object.freeze(['ticker','isin']);

export function certifyUniverseExtraction(extractionResult,{parsedRows,schemaValidation,scopeValidation}={}){
  const reasons=[];
  const manifest=extractionResult?.manifest??null;
  if(extractionResult?.state!=='READY_FOR_SEMANTIC_VALIDATION'||!manifest) reasons.push('EXTRACTION_NOT_READY_FOR_SEMANTIC_VALIDATION');
  if(!Array.isArray(parsedRows)) reasons.push('PARSED_ROWS_REQUIRED');
  if(schemaValidation?.state!=='VERIFIED') reasons.push('SCHEMA_NOT_VERIFIED');
  if(scopeValidation?.state!=='VERIFIED') reasons.push('SCOPE_NOT_VERIFIED');
  if(scopeValidation?.scope!=='ALL_LISTED_EQUITIES') reasons.push('SCOPE_NOT_ALL_LISTED_EQUITIES');
  const fields=new Set(schemaValidation?.fields??[]);
  for(const field of REQUIRED_UNIVERSE_FIELDS) if(!fields.has(field)) reasons.push(`SCHEMA_MISSING_FIELD:${field}`);
  if(parsedRows&&Number.isInteger(manifest?.rowCount)&&parsedRows.length!==manifest.rowCount) reasons.push(`ROW_COUNT_MISMATCH:${manifest.rowCount}:${parsedRows.length}`);
  const outputHash=Array.isArray(parsedRows)?sha256(parsedRows):null;
  if(manifest?.outputHash&&outputHash&&manifest.outputHash!==outputHash) reasons.push('EXTRACTION_OUTPUT_HASH_MISMATCH');
  if(!HEX64.test(String(manifest?.sourceAdmissionHash??''))) reasons.push('INVALID_SOURCE_ADMISSION_HASH');
  if(!HEX64.test(String(manifest?.sourceContentHash??''))) reasons.push('INVALID_SOURCE_CONTENT_HASH');
  if(reasons.length)return Object.freeze({state:'BLOCKED',reasons:[...new Set(reasons)].sort(),certificate:null,universeAuthorityEligible:false});
  const certificate={
    certificateKind:'EGX_UNIVERSE_EXTRACTION_CERTIFICATE',
    sourceAdmissionHash:manifest.sourceAdmissionHash,
    sourceContentHash:manifest.sourceContentHash,
    extractionManifestHash:manifest.manifestHash,
    extractorId:manifest.extractorId,
    extractorVersion:manifest.extractorVersion,
    schemaId:manifest.schemaId,
    schemaValidationHash:sha256(schemaValidation),
    scopeValidationHash:sha256(scopeValidation),
    scope:'ALL_LISTED_EQUITIES',
    rowCount:parsedRows.length,
    outputHash
  };
  certificate.certificateHash=sha256(certificate);
  return Object.freeze({state:'CERTIFIED_FOR_UNIVERSE_AUTHORITY',reasons:[],certificate:Object.freeze(certificate),universeAuthorityEligible:true,ohlcvAuthorityEligible:false});
}

export function verifyUniverseExtractionCertificate(result,{parsedRows,extractionManifest}={}){
  const reasons=[];const cert=result?.certificate;
  if(result?.state!=='CERTIFIED_FOR_UNIVERSE_AUTHORITY'||!cert) reasons.push('CERTIFICATE_NOT_PRESENT');
  if(cert){
    const {certificateHash,...body}=cert;
    if(sha256(body)!==certificateHash) reasons.push('CERTIFICATE_HASH_MISMATCH');
    if(extractionManifest&&cert.extractionManifestHash!==extractionManifest.manifestHash) reasons.push('EXTRACTION_MANIFEST_MISMATCH');
    if(Array.isArray(parsedRows)&&cert.outputHash!==sha256(parsedRows)) reasons.push('PARSED_ROWS_HASH_MISMATCH');
    if(Array.isArray(parsedRows)&&cert.rowCount!==parsedRows.length) reasons.push('PARSED_ROWS_COUNT_MISMATCH');
  }
  return {state:reasons.length?'BLOCKED':'READY',reasons:[...new Set(reasons)].sort()};
}
