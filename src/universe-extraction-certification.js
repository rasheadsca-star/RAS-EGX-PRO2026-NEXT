import { sha256 } from './hash.js';
const HEX64=/^[0-9a-f]{64}$/i;

export function certifyUniverseExtraction({admission,extraction,schemaResult,scopeResult,extractedOutput,universeRows}={}){
  const reasons=[];const manifest=extraction?.manifest??null;const schema=schemaResult?.attestation??null;const scope=scopeResult?.attestation??null;
  if(admission?.state!=='READY_FOR_SCHEMA_VALIDATION') reasons.push('ARTIFACT_NOT_ADMITTED');
  if(extraction?.state!=='READY_FOR_SEMANTIC_VALIDATION'||!manifest) reasons.push('EXTRACTION_NOT_READY_FOR_SEMANTIC_VALIDATION');
  if(schemaResult?.state!=='READY_FOR_SCOPE_VALIDATION'||!schema) reasons.push('SCHEMA_NOT_READY_FOR_SCOPE_VALIDATION');
  if(scopeResult?.state!=='READY_FOR_UNIVERSE_CERTIFICATION'||!scope) reasons.push('SCOPE_NOT_READY_FOR_UNIVERSE_CERTIFICATION');
  if(!Array.isArray(extractedOutput)) reasons.push('EXTRACTED_ROWS_REQUIRED');
  if(!Array.isArray(universeRows)) reasons.push('UNIVERSE_ROWS_REQUIRED');
  const extractionOutputHash=Array.isArray(extractedOutput)?sha256(extractedOutput):null;
  const universeOutputHash=Array.isArray(universeRows)?sha256(universeRows):null;
  if(manifest&&extractionOutputHash&&manifest.outputHash!==extractionOutputHash) reasons.push('EXTRACTION_OUTPUT_HASH_MISMATCH');
  if(manifest&&manifest.sourceAdmissionHash!==admission?.admissionHash) reasons.push('EXTRACTION_ADMISSION_HASH_MISMATCH');
  if(schema&&schema.sourceAdmissionHash!==admission?.admissionHash) reasons.push('SCHEMA_ADMISSION_HASH_MISMATCH');
  if(schema&&schema.extractionManifestHash!==manifest?.manifestHash) reasons.push('SCHEMA_EXTRACTION_HASH_MISMATCH');
  if(scope&&scope.sourceAdmissionHash!==admission?.admissionHash) reasons.push('SCOPE_ADMISSION_HASH_MISMATCH');
  if(scope&&scope.extractionManifestHash!==manifest?.manifestHash) reasons.push('SCOPE_EXTRACTION_HASH_MISMATCH');
  if(scope&&scope.schemaAttestationHash!==schema?.attestationHash) reasons.push('SCOPE_SCHEMA_HASH_MISMATCH');
  if(scope?.scope!=='ALL_LISTED_EQUITIES') reasons.push('SCOPE_NOT_ALL_LISTED_EQUITIES');
  if(scope&&extractionOutputHash!==scope.extractionOutputHash) reasons.push('SCOPE_EXTRACTION_OUTPUT_HASH_MISMATCH');
  if(scope&&universeOutputHash!==scope.universeOutputHash) reasons.push('SCOPE_UNIVERSE_OUTPUT_HASH_MISMATCH');
  if(scope&&Array.isArray(universeRows)&&scope.declaredTotal!==universeRows.length) reasons.push(`SCOPE_ROW_COUNT_MISMATCH:${scope.declaredTotal}:${universeRows.length}`);
  const hashes={sourceAdmissionHash:manifest?.sourceAdmissionHash,sourceContentHash:manifest?.sourceContentHash,extractionManifestHash:manifest?.manifestHash,schemaAttestationHash:schema?.attestationHash,scopeAttestationHash:scope?.attestationHash};
  for(const [name,value] of Object.entries(hashes))if(!HEX64.test(String(value??'')))reasons.push(`INVALID_${name.replace(/[A-Z]/g,m=>'_'+m).toUpperCase()}`);
  if(reasons.length)return Object.freeze({state:'BLOCKED',reasons:[...new Set(reasons)].sort(),certificate:null,universeAuthorityEligible:false,ohlcvAuthorityEligible:false});
  const certificate={certificateKind:'EGX_UNIVERSE_EXTRACTION_CERTIFICATE',...hashes,extractorId:manifest.extractorId,extractorVersion:manifest.extractorVersion,schemaId:manifest.schemaId,scope:'ALL_LISTED_EQUITIES',extractionRowCount:extractedOutput.length,universeRowCount:universeRows.length,extractionOutputHash,universeOutputHash};
  certificate.certificateHash=sha256(certificate);
  return Object.freeze({state:'CERTIFIED_FOR_UNIVERSE_AUTHORITY',reasons:[],certificate:Object.freeze(certificate),universeAuthorityEligible:true,ohlcvAuthorityEligible:false});
}

export function verifyUniverseExtractionCertificate(result,{admission,extraction,schemaResult,scopeResult,extractedOutput,universeRows}={}){
  const reasons=[];const cert=result?.certificate;const manifest=extraction?.manifest;const schema=schemaResult?.attestation;const scope=scopeResult?.attestation;
  if(result?.state!=='CERTIFIED_FOR_UNIVERSE_AUTHORITY'||!cert) reasons.push('CERTIFICATE_NOT_PRESENT');
  if(cert){const {certificateHash,...body}=cert;if(sha256(body)!==certificateHash)reasons.push('CERTIFICATE_HASH_MISMATCH');if(admission&&cert.sourceAdmissionHash!==admission.admissionHash)reasons.push('ADMISSION_MISMATCH');if(manifest&&cert.extractionManifestHash!==manifest.manifestHash)reasons.push('EXTRACTION_MANIFEST_MISMATCH');if(schema&&cert.schemaAttestationHash!==schema.attestationHash)reasons.push('SCHEMA_ATTESTATION_MISMATCH');if(scope&&cert.scopeAttestationHash!==scope.attestationHash)reasons.push('SCOPE_ATTESTATION_MISMATCH');if(Array.isArray(extractedOutput)&&cert.extractionOutputHash!==sha256(extractedOutput))reasons.push('EXTRACTED_ROWS_HASH_MISMATCH');if(Array.isArray(extractedOutput)&&cert.extractionRowCount!==extractedOutput.length)reasons.push('EXTRACTED_ROWS_COUNT_MISMATCH');if(Array.isArray(universeRows)&&cert.universeOutputHash!==sha256(universeRows))reasons.push('UNIVERSE_ROWS_HASH_MISMATCH');if(Array.isArray(universeRows)&&cert.universeRowCount!==universeRows.length)reasons.push('UNIVERSE_ROWS_COUNT_MISMATCH');}
  return {state:reasons.length?'BLOCKED':'READY',reasons:[...new Set(reasons)].sort()};
}
