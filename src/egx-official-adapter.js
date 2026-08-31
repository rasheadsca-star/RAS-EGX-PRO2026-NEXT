import { sha256 } from './hash.js';
import { canonicalTicker, validIsin } from './universe-authority.js';
import { admitOfficialArtifact } from './official-artifact-admission.js';
import { validateSchemaAttestation } from './schema-attestation.js';

const EQUITY_ISIN_PREFIX='EGS';
const BOND_ISIN_PREFIX='EGB';
const SNAPSHOT_TYPES=new Set(['OFFICIAL_LISTED_SECURITIES_SNAPSHOT','OFFICIAL_DAILY_BULLETIN']);
const REQUIRED_UNIVERSE_SEMANTICS=Object.freeze(['ISIN','SECURITY_CODE','ASSET_CLASS','LISTING_STATUS']);

function clean(v){return String(v??'').trim()}
function dateOnly(v){const s=clean(v);return s?s.slice(0,10):null}
function tickerFromReuters(v){return canonicalTicker(v)}

export function classifyEgxSecurity({isin,reutersCode}={}){
  const id=clean(isin).toUpperCase();
  if(id.startsWith(EQUITY_ISIN_PREFIX)) return 'EQUITY';
  if(id.startsWith(BOND_ISIN_PREFIX)||clean(reutersCode).includes('=')) return 'BOND';
  return 'UNKNOWN';
}

export function adaptEgxNewsRecord(record,{sourceId='EGX_BETA_NEWS'}={}){
  const assetClass=classifyEgxSecurity(record);
  if(assetClass!=='EQUITY') return {state:'IGNORED_NON_EQUITY',assetClass,reasons:[`ASSET_CLASS:${assetClass}`],evidence:null};
  const ticker=tickerFromReuters(record.reutersCode);
  const isin=clean(record.isin).toUpperCase();
  const kind=String(record.category??'DISCLOSURE').toUpperCase();
  const evidenceType=kind==='LISTING_NEWS'?'OFFICIAL_LISTING_NEWS':'OFFICIAL_DISCLOSURE';
  const reasons=[];
  if(!ticker) reasons.push('MISSING_REUTERS_CODE');
  if(!validIsin(isin)) reasons.push('INVALID_EQUITY_ISIN');
  if(!record.sourceUrl) reasons.push('MISSING_SOURCE_URL');
  if(reasons.length) return {state:'BLOCKED',assetClass,reasons,evidence:null};
  const title=clean(record.title);
  const segment=/SME|SMEs Market|سوق الشركات الصغيرة|بورصة النيل/i.test(title)?'SME':'UNKNOWN';
  const evidence={ticker,reutersCode:`${ticker}.CA`,isin,evidenceType,sourceId,effectiveDate:dateOnly(record.publishedAt),capturedAt:record.capturedAt??null,segment,companyName:record.companyName??null,status:'ACTIVE',sourceUrl:record.sourceUrl,sourceHash:record.sourceHash??sha256({title,publishedAt:record.publishedAt,isin,reutersCode:record.reutersCode,sourceUrl:record.sourceUrl})};
  return {state:'READY',assetClass,reasons:[],evidence};
}

function verifySnapshotAdmission(rows,meta){
  if(meta.exhaustive!==true) return {state:'UNIVERSE_INCOMPLETE',reasons:['SNAPSHOT_NOT_DECLARED_EXHAUSTIVE']};
  if(!Number.isInteger(meta.declaredTotal)||meta.declaredTotal<0) return {state:'UNIVERSE_INCOMPLETE',reasons:['MISSING_DECLARED_EQUITY_TOTAL']};
  if(!meta.artifact||meta.rawBytes===undefined||!meta.sourceReceipt) return {state:'BLOCKED',reasons:['MISSING_OFFICIAL_ARTIFACT_CHAIN']};
  const artifactAdmission=admitOfficialArtifact({artifact:meta.artifact,rawBytes:meta.rawBytes,sourceReceipt:meta.sourceReceipt,calendarEntry:meta.calendarEntry??null,decisionTime:meta.decisionTime??null});
  if(artifactAdmission.state!=='READY_FOR_SCHEMA_VALIDATION') return {state:'BLOCKED',reasons:['OFFICIAL_ARTIFACT_NOT_ADMITTED',...artifactAdmission.reasons]};
  const reasons=[];
  if(meta.asOfDate!==artifactAdmission.session) reasons.push('ARTIFACT_ASOF_SESSION_MISMATCH');
  if(!meta.extraction) reasons.push('MISSING_EXTRACTION_MANIFEST');
  if(!meta.schemaAttestation) reasons.push('MISSING_SCHEMA_ATTESTATION');
  if(reasons.length) return {state:'BLOCKED',reasons};
  const schema=validateSchemaAttestation({admission:artifactAdmission,extraction:meta.extraction,extractedOutput:rows,attestation:meta.schemaAttestation,requiredSemanticFields:REQUIRED_UNIVERSE_SEMANTICS});
  if(schema.state!=='READY_FOR_SCOPE_VALIDATION') return {state:'BLOCKED',reasons:['SCHEMA_NOT_ATTESTED',...schema.reasons]};
  const sp=meta.scopeProof;
  if(!sp||sp.state!=='VERIFIED'||sp.kind!=='OFFICIAL_DOCUMENT_SCOPE'||sp.scope!=='ALL_LISTED_EQUITIES'||!clean(sp.evidenceLocator)) return {state:'UNIVERSE_INCOMPLETE',reasons:['NO_EXHAUSTIVE_SCOPE_PROOF']};
  if(sp.sourceAdmissionHash!==artifactAdmission.admissionHash) reasons.push('SCOPE_ADMISSION_HASH_MISMATCH');
  if(sp.extractionManifestHash!==meta.extraction.manifest.manifestHash) reasons.push('SCOPE_EXTRACTION_HASH_MISMATCH');
  if(sp.schemaAttestationHash!==schema.attestation.attestationHash) reasons.push('SCOPE_SCHEMA_ATTESTATION_HASH_MISMATCH');
  if(reasons.length) return {state:'BLOCKED',reasons};
  const sourceReceipt={sourceId:meta.sourceReceipt.sourceId,sourceClass:meta.sourceReceipt.sourceClass,providerGroup:meta.sourceReceipt.providerGroup,sourceUrl:artifactAdmission.sourceUrl,session:artifactAdmission.session,capturedAt:meta.sourceReceipt.capturedAt,provenanceKind:meta.sourceReceipt.provenanceKind,contentHash:artifactAdmission.contentHash,receiptHash:artifactAdmission.sourceReceiptHash};
  const scopeProof={state:'VERIFIED',kind:'OFFICIAL_DOCUMENT_SCOPE',scope:'ALL_LISTED_EQUITIES',evidenceLocator:clean(sp.evidenceLocator),sourceReceiptHash:sourceReceipt.receiptHash,sourceAdmissionHash:artifactAdmission.admissionHash,extractionManifestHash:meta.extraction.manifest.manifestHash,schemaAttestationHash:schema.attestation.attestationHash};
  scopeProof.scopeProofHash=sha256(scopeProof);
  return {state:'READY',reasons:[],sourceReceipt,artifactAdmission,extraction:meta.extraction,schemaAttestation:schema.attestation,scopeProof};
}

export function adaptEgxListedSnapshot(rows,meta={}){
  const evidenceType=String(meta.evidenceType??'').toUpperCase();
  if(!SNAPSHOT_TYPES.has(evidenceType)) return {state:'BLOCKED',reasons:['INVALID_SNAPSHOT_EVIDENCE_TYPE'],evidence:[],manifest:null};
  if(!meta.asOfDate) return {state:'BLOCKED',reasons:['MISSING_SNAPSHOT_ASOF_DATE'],evidence:[],manifest:null};
  const admission=verifySnapshotAdmission(rows,meta);
  if(admission.state!=='READY') return {state:admission.state,reasons:admission.reasons,evidence:[],manifest:null};
  const sourceId=admission.sourceReceipt.sourceId,sourceUrl=admission.artifactAdmission.sourceUrl,sourceHash=admission.artifactAdmission.contentHash;
  const accepted=[];const ignored=[];const blocked=[];
  for(const row of rows??[]){
    const assetClass=classifyEgxSecurity(row);
    if(assetClass!=='EQUITY'){ignored.push({assetClass,isin:row?.isin??null,reutersCode:row?.reutersCode??null});continue}
    const ticker=tickerFromReuters(row.reutersCode??row.ticker),isin=clean(row.isin).toUpperCase();
    const rowReasons=[];if(!ticker)rowReasons.push('MISSING_TICKER');if(!validIsin(isin))rowReasons.push('INVALID_EQUITY_ISIN');
    if(rowReasons.length){blocked.push({row,reasons:rowReasons});continue}
    accepted.push({ticker,reutersCode:`${ticker}.CA`,isin,evidenceType,sourceId,effectiveDate:dateOnly(row.effectiveDate??meta.asOfDate),capturedAt:admission.sourceReceipt.capturedAt,segment:String(row.segment??'UNKNOWN').toUpperCase(),companyName:row.companyName??null,status:String(row.status??'ACTIVE').toUpperCase(),sourceUrl,sourceHash,sourceReceiptHash:admission.sourceReceipt.receiptHash,scopeProofHash:admission.scopeProof.scopeProofHash});
  }
  if(blocked.length) return {state:'BLOCKED',reasons:['MALFORMED_EQUITY_ROWS'],blocked,evidence:[],manifest:null};
  const dedupe=new Set(accepted.map(x=>`${x.ticker}|${x.isin}`));
  if(dedupe.size!==accepted.length) return {state:'DATA_CONFLICT',reasons:['DUPLICATE_TICKER_ISIN_ROWS'],evidence:[],manifest:null};
  if(accepted.length!==meta.declaredTotal) return {state:'DATA_CONFLICT',reasons:[`DECLARED_EQUITY_TOTAL_MISMATCH:${meta.declaredTotal}:${accepted.length}`],evidence:[],manifest:null};
  const manifest={sourceId,sourceUrl,sourceHash,capturedAt:admission.sourceReceipt.capturedAt,asOfDate:meta.asOfDate,evidenceType,declaredTotal:meta.declaredTotal,rawRows:(rows??[]).length,equityRows:accepted.length,ignoredNonEquity:ignored.length,exhaustive:true,sourceReceiptHash:admission.sourceReceipt.receiptHash,artifactAdmissionHash:admission.artifactAdmission.admissionHash,extractionManifestHash:admission.extraction.manifest.manifestHash,schemaAttestationHash:admission.schemaAttestation.attestationHash,scopeProofHash:admission.scopeProof.scopeProofHash};
  manifest.manifestHash=sha256(manifest);
  return {state:'READY',reasons:[],evidence:accepted.sort((a,b)=>a.ticker.localeCompare(b.ticker)),ignored,manifest};
}
