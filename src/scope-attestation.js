import { sha256 } from './hash.js';
const HEX64=/^[0-9a-f]{64}$/i;

export function validateUniverseScopeAttestation({admission,extraction,schemaResult,extractedOutput,attestation}={}){
  const reasons=[];
  const schema=schemaResult?.attestation??null;
  if(admission?.state!=='READY_FOR_SCHEMA_VALIDATION') reasons.push('ARTIFACT_NOT_ADMITTED');
  if(extraction?.state!=='READY_FOR_SEMANTIC_VALIDATION'||!extraction?.manifest) reasons.push('EXTRACTION_NOT_READY');
  if(schemaResult?.state!=='READY_FOR_SCOPE_VALIDATION'||!schema) reasons.push('SCHEMA_NOT_READY_FOR_SCOPE_VALIDATION');
  if(!Array.isArray(extractedOutput)) reasons.push('EXTRACTED_ROWS_REQUIRED');
  if(!attestation||attestation.state!=='VERIFIED') reasons.push('SCOPE_ATTESTATION_NOT_VERIFIED');
  if(attestation?.scope!=='ALL_LISTED_EQUITIES') reasons.push('SCOPE_NOT_ALL_LISTED_EQUITIES');
  if(!Number.isInteger(attestation?.declaredTotal)||attestation.declaredTotal<0) reasons.push('INVALID_DECLARED_TOTAL');
  if(Array.isArray(extractedOutput)&&Number.isInteger(attestation?.declaredTotal)&&attestation.declaredTotal!==extractedOutput.length) reasons.push(`DECLARED_TOTAL_MISMATCH:${attestation.declaredTotal}:${extractedOutput.length}`);
  if(extraction?.manifest?.sourceAdmissionHash!==admission?.admissionHash) reasons.push('EXTRACTION_ADMISSION_HASH_MISMATCH');
  if(schema?.sourceAdmissionHash!==admission?.admissionHash) reasons.push('SCHEMA_ADMISSION_HASH_MISMATCH');
  if(schema?.extractionManifestHash!==extraction?.manifest?.manifestHash) reasons.push('SCHEMA_EXTRACTION_HASH_MISMATCH');
  if(attestation?.sourceAdmissionHash!==admission?.admissionHash) reasons.push('SCOPE_ADMISSION_HASH_MISMATCH');
  if(attestation?.extractionManifestHash!==extraction?.manifest?.manifestHash) reasons.push('SCOPE_EXTRACTION_HASH_MISMATCH');
  if(attestation?.schemaAttestationHash!==schema?.attestationHash) reasons.push('SCOPE_SCHEMA_HASH_MISMATCH');
  if(!String(attestation?.evidenceLocator??'').trim()) reasons.push('MISSING_SCOPE_EVIDENCE_LOCATOR');
  if(!HEX64.test(String(attestation?.scopeDefinitionHash??''))) reasons.push('INVALID_SCOPE_DEFINITION_HASH');
  if(!HEX64.test(String(attestation?.verificationEvidenceHash??''))) reasons.push('INVALID_SCOPE_VERIFICATION_EVIDENCE_HASH');
  const normalized={state:'VERIFIED',scope:'ALL_LISTED_EQUITIES',declaredTotal:attestation?.declaredTotal??null,evidenceLocator:String(attestation?.evidenceLocator??'').trim(),sourceAdmissionHash:attestation?.sourceAdmissionHash??null,extractionManifestHash:attestation?.extractionManifestHash??null,schemaAttestationHash:attestation?.schemaAttestationHash??null,scopeDefinitionHash:String(attestation?.scopeDefinitionHash??'').toLowerCase(),verificationEvidenceHash:String(attestation?.verificationEvidenceHash??'').toLowerCase(),outputHash:Array.isArray(extractedOutput)?sha256(extractedOutput):null};
  const attestationHash=sha256(normalized);
  if(attestation?.attestationHash&&attestation.attestationHash!==attestationHash) reasons.push('SCOPE_ATTESTATION_HASH_MISMATCH');
  return Object.freeze({state:reasons.length?'BLOCKED':'READY_FOR_UNIVERSE_CERTIFICATION',reasons:[...new Set(reasons)].sort(),attestation:Object.freeze({...normalized,attestationHash}),universeAuthorityEligible:false,ohlcvAuthorityEligible:false});
}
