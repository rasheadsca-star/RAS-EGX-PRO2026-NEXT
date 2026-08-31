import { sha256 } from './hash.js';

const NON_RAW_KINDS=new Set(['SEARCH_SNIPPET','SEARCH_RESULT','MANUAL_TRANSCRIPTION']);
const HEX64=/^[0-9a-f]{64}$/i;
function parseUrl(value){try{return new URL(value)}catch{return null}}
function provider(policy,receipt){return policy?.providerGroup??receipt?.providerGroup??receipt?.sourceId??null}
function officialEgxHost(host){return host==='egx.com.eg'||host.endsWith('.egx.com.eg')}

export function verifyReceiptContent(receipt,rawPayload){
  if(rawPayload===undefined||rawPayload===null) return {state:'BLOCKED',reasons:['RAW_PAYLOAD_REQUIRED'],computedHash:null};
  const computedHash=sha256(rawPayload);
  const claimed=String(receipt?.contentHash??'').toLowerCase();
  const reasons=[];
  if(!HEX64.test(claimed)) reasons.push('INVALID_CONTENT_HASH');
  else if(computedHash!==claimed) reasons.push('CONTENT_HASH_MISMATCH');
  return {state:reasons.length?'BLOCKED':'READY',reasons,computedHash};
}

export function validateSourceReceipt(receipt,{policy=null,calendarEntry=null,decisionTime=null,maxLagMinutes=360,rawPayload}={}){
  const reasons=[];
  if(!receipt?.sourceId) reasons.push('MISSING_SOURCE_ID');
  if(!receipt?.sourceClass) reasons.push('MISSING_SOURCE_CLASS');
  if(!receipt?.providerGroup) reasons.push('MISSING_PROVIDER_GROUP');
  if(!receipt?.sourceUrl) reasons.push('MISSING_SOURCE_URL');
  if(!receipt?.capturedAt) reasons.push('MISSING_CAPTURE_TIME');
  if(!receipt?.session) reasons.push('MISSING_SESSION');
  if(!receipt?.provenanceKind) reasons.push('MISSING_PROVENANCE_KIND');
  if(!HEX64.test(String(receipt?.contentHash??''))) reasons.push('INVALID_CONTENT_HASH');
  if(rawPayload!==undefined){const contentCheck=verifyReceiptContent(receipt,rawPayload);for(const reason of contentCheck.reasons)if(!reasons.includes(reason))reasons.push(reason)}
  if(policy?.sourceClass&&receipt?.sourceClass!==policy.sourceClass) reasons.push('SOURCE_CLASS_POLICY_MISMATCH');
  if(policy?.providerGroup&&receipt?.providerGroup!==policy.providerGroup) reasons.push('PROVIDER_GROUP_POLICY_MISMATCH');
  const url=parseUrl(receipt?.sourceUrl);
  if(receipt?.sourceUrl&&!url) reasons.push('INVALID_SOURCE_URL');
  if(url&&url.protocol!=='https:') reasons.push('NON_HTTPS_SOURCE');
  if(policy?.sourceClass==='OFFICIAL_EXCHANGE'&&url&&!officialEgxHost(url.hostname.toLowerCase())) reasons.push('OFFICIAL_DOMAIN_MISMATCH');
  if(policy?.mayBePrimaryCurrent&&NON_RAW_KINDS.has(String(receipt?.provenanceKind).toUpperCase())) reasons.push('NON_RAW_EVIDENCE_KIND');

  if(calendarEntry){
    if(receipt?.session!==calendarEntry.session) reasons.push(`SESSION_MISMATCH:${receipt?.session}:${calendarEntry.session}`);
    const capture=Date.parse(receipt?.capturedAt),close=Date.parse(calendarEntry.closeAt);
    if(!Number.isFinite(capture)||!Number.isFinite(close)) reasons.push('INVALID_TIMESTAMP');
    else{
      if(capture<close) reasons.push('PRE_CLOSE_SOURCE_CAPTURE');
      if(capture-close>maxLagMinutes*60000) reasons.push('SOURCE_CAPTURE_TOO_LATE');
    }
  }
  if(decisionTime){
    const capture=Date.parse(receipt?.capturedAt),decision=Date.parse(decisionTime);
    if(!Number.isFinite(decision)) reasons.push('INVALID_DECISION_TIME');
    else if(Number.isFinite(capture)&&capture>decision) reasons.push('CAPTURE_AFTER_DECISION_TIME');
  }
  const normalized={sourceId:receipt?.sourceId??null,sourceClass:receipt?.sourceClass??null,providerGroup:receipt?.providerGroup??null,sourceUrl:receipt?.sourceUrl??null,session:receipt?.session??null,capturedAt:receipt?.capturedAt??null,provenanceKind:receipt?.provenanceKind??null,contentHash:String(receipt?.contentHash??'').toLowerCase()};
  const receiptHash=sha256(normalized);
  if(receipt?.receiptHash&&receipt.receiptHash!==receiptHash) reasons.push('RECEIPT_HASH_MISMATCH');
  return {state:reasons.length?'BLOCKED':'READY',reasons,receipt:{...normalized,receiptHash}};
}

export function validateIndependentReceipts(primary,crossCheck){
  const reasons=[];
  if(!primary?.providerGroup||!crossCheck?.providerGroup) reasons.push('MISSING_PROVIDER_GROUP');
  else if(primary.providerGroup===crossCheck.providerGroup) reasons.push('SAME_PROVIDER_GROUP');
  if(primary?.contentHash&&crossCheck?.contentHash&&primary.contentHash===crossCheck.contentHash) reasons.push('IDENTICAL_CONTENT_HASH');
  return {state:reasons.length?'BLOCKED':'READY',reasons,providers:{primary:provider(null,primary),crossCheck:provider(null,crossCheck)}};
}
