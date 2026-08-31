import { sha256 } from './hash.js';
const HEX64=/^[0-9a-f]{64}$/i;
function normFields(values){return [...new Set((values??[]).map(x=>String(x).trim().toUpperCase()).filter(Boolean))].sort()}

export function validateSchemaAttestation({admission,extraction,extractedOutput,attestation,requiredSemanticFields=[]}={}){
  const reasons=[];
  if(admission?.state!=='READY_FOR_SCHEMA_VALIDATION') reasons.push('ARTIFACT_NOT_READY_FOR_SCHEMA_VALIDATION');
  if(extraction?.state!=='READY_FOR_SEMANTIC_VALIDATION'||!extraction?.manifest) reasons.push('EXTRACTION_NOT_READY_FOR_SEMANTIC_VALIDATION');
  if(extractedOutput===undefined||extractedOutput===null) reasons.push('EXTRACTED_OUTPUT_REQUIRED');
  if(!attestation||attestation.state!=='VERIFIED') reasons.push('SCHEMA_ATTESTATION_NOT_VERIFIED');
  if(extraction?.manifest?.sourceAdmissionHash!==admission?.admissionHash) reasons.push('EXTRACTION_ADMISSION_HASH_MISMATCH');
  if(extractedOutput!==undefined&&extractedOutput!==null&&extraction?.manifest?.outputHash!==sha256(extractedOutput)) reasons.push('EXTRACTION_OUTPUT_HASH_MISMATCH');
  if(attestation?.sourceAdmissionHash!==admission?.admissionHash) reasons.push('ATTESTATION_ADMISSION_HASH_MISMATCH');
  if(attestation?.extractionManifestHash!==extraction?.manifest?.manifestHash) reasons.push('ATTESTATION_EXTRACTION_HASH_MISMATCH');
  if(attestation?.schemaId!==extraction?.manifest?.schemaId) reasons.push('ATTESTATION_SCHEMA_ID_MISMATCH');
  if(!HEX64.test(String(attestation?.schemaDefinitionHash??''))) reasons.push('INVALID_SCHEMA_DEFINITION_HASH');
  if(!HEX64.test(String(attestation?.verificationEvidenceHash??''))) reasons.push('INVALID_SCHEMA_VERIFICATION_EVIDENCE_HASH');
  const semanticFields=normFields(attestation?.semanticFields),required=normFields(requiredSemanticFields);
  for(const field of required)if(!semanticFields.includes(field))reasons.push(`MISSING_SEMANTIC_FIELD:${field}`);
  const normalized={state:'VERIFIED',sourceAdmissionHash:attestation?.sourceAdmissionHash??null,extractionManifestHash:attestation?.extractionManifestHash??null,schemaId:attestation?.schemaId??null,schemaDefinitionHash:String(attestation?.schemaDefinitionHash??'').toLowerCase(),verificationEvidenceHash:String(attestation?.verificationEvidenceHash??'').toLowerCase(),semanticFields};
  const attestationHash=sha256(normalized);
  if(attestation?.attestationHash&&attestation.attestationHash!==attestationHash) reasons.push('SCHEMA_ATTESTATION_HASH_MISMATCH');
  return Object.freeze({state:reasons.length?'BLOCKED':'READY_FOR_SCOPE_VALIDATION',reasons:[...new Set(reasons)].sort(),attestation:Object.freeze({...normalized,attestationHash}),universeAuthorityEligible:false,ohlcvAuthorityEligible:false});
}
