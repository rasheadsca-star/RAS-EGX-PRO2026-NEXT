import { sha256 } from './hash.js';
import { validateSourceReceipt } from './source-provenance.js';
import { DEFAULT_SOURCE_POLICY } from './acquisition-policy.js';

const HEX64=/^[0-9a-f]{64}$/i;
function httpsUrl(v){try{const u=new URL(v);return u.protocol==='https:'?u:null}catch{return null}}

export function buildLicensedEodPrivateIntake({
  provider,
  providerGroup='LICENSED_EOD_VENDOR',
  sourceUrl,
  capturedAt,
  session,
  provenanceKind='API_RAW_JSON',
  rawPayload,
  licenseDocumentPayload,
  entitlementConfirmed=false,
  permittedApplicationUseConfirmed=false
}={}){
  const reasons=[];
  if(!String(provider??'').trim()) reasons.push('PROVIDER_REQUIRED');
  if(!httpsUrl(sourceUrl)) reasons.push('HTTPS_VENDOR_SOURCE_URL_REQUIRED');
  if(!capturedAt||!Number.isFinite(Date.parse(capturedAt))) reasons.push('VALID_CAPTURE_TIME_REQUIRED');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(session??''))) reasons.push('SESSION_REQUIRED');
  if(rawPayload===undefined||rawPayload===null) reasons.push('RAW_DATASET_BYTES_REQUIRED');
  if(licenseDocumentPayload===undefined||licenseDocumentPayload===null) reasons.push('LICENSE_DOCUMENT_BYTES_REQUIRED');
  if(entitlementConfirmed!==true) reasons.push('ENTITLEMENT_CONFIRMATION_REQUIRED');
  if(permittedApplicationUseConfirmed!==true) reasons.push('PERMITTED_APPLICATION_USE_CONFIRMATION_REQUIRED');

  const contentHash=rawPayload===undefined||rawPayload===null?null:sha256(rawPayload);
  const licenseReceiptHash=licenseDocumentPayload===undefined||licenseDocumentPayload===null?null:sha256(licenseDocumentPayload);
  const datasetReceipt={
    sourceId:'LICENSED_EOD',
    sourceClass:'LICENSED_EOD',
    providerGroup,
    sourceUrl:sourceUrl??null,
    capturedAt:capturedAt??null,
    session:session??null,
    provenanceKind,
    contentHash
  };
  const receiptCheck=contentHash?validateSourceReceipt(datasetReceipt,{policy:DEFAULT_SOURCE_POLICY.LICENSED_EOD,rawPayload}):{state:'BLOCKED',reasons:['RAW_DATASET_BYTES_REQUIRED'],receipt:null};
  if(receiptCheck.state!=='READY') reasons.push(...receiptCheck.reasons.map(x=>`DATASET_RECEIPT:${x}`));
  if(licenseReceiptHash&&!HEX64.test(licenseReceiptHash)) reasons.push('LICENSE_HASH_INVALID');

  const ready=reasons.length===0;
  return Object.freeze({
    schemaVersion:'licensed-eod-private-intake-1',
    state:ready?'RAW_PRIVATE_INTAKE_READY_FOR_PARSER_BINDING':'BLOCKED',
    provider:String(provider??''),
    providerGroup,
    session:session??null,
    datasetReceipt:receiptCheck.receipt,
    licenseEvidence:Object.freeze({
      provider:String(provider??''),
      entitlementConfirmed:entitlementConfirmed===true,
      permittedApplicationUseConfirmed:permittedApplicationUseConfirmed===true,
      licenseReceiptHash
    }),
    rawDatasetHash:contentHash,
    parserBound:false,
    fieldSemanticsVerified:false,
    exactUniverseCoverageVerified:false,
    independentCrossCheckBound:false,
    datasetAdmissionReady:false,
    downstreamLineageEligible:false,
    productionAuthority:false,
    phase4Open:false,
    reasons:Object.freeze([...new Set(reasons)]),
    safety:Object.freeze({
      rawDatasetEmbedded:false,
      licenseDocumentEmbedded:false,
      safeToPersistMetadataOnly:ready,
      note:'Persist only this metadata object if vendor terms allow. Keep raw licensed dataset and entitlement document outside the repository.'
    })
  });
}
