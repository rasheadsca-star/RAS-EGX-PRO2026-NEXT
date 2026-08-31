import { sha256 } from './hash.js';
import { canonicalTicker, validIsin } from './universe-authority.js';
import { validateSourceReceipt } from './source-provenance.js';
import { DEFAULT_SOURCE_POLICY } from './acquisition-policy.js';

const EQUITY_ISIN_PREFIX='EGS';
const BOND_ISIN_PREFIX='EGB';
const SNAPSHOT_TYPES=new Set(['OFFICIAL_LISTED_SECURITIES_SNAPSHOT','OFFICIAL_DAILY_BULLETIN']);
const DIRECT_OFFICIAL_KINDS=new Set(['OFFICIAL_DIRECT_FILE','OFFICIAL_DIRECT_PAGE']);

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

function verifySnapshotAdmission(meta){
  if(meta.exhaustive!==true) return {state:'UNIVERSE_INCOMPLETE',reasons:['SNAPSHOT_NOT_DECLARED_EXHAUSTIVE']};
  if(!meta.scopeProof||meta.scopeProof.state!=='VERIFIED'||meta.scopeProof.kind!=='OFFICIAL_DOCUMENT_SCOPE'||meta.scopeProof.scope!=='ALL_LISTED_EQUITIES'||!clean(meta.scopeProof.evidenceLocator)) return {state:'UNIVERSE_INCOMPLETE',reasons:['NO_EXHAUSTIVE_SCOPE_PROOF']};
  if(!Number.isInteger(meta.declaredTotal)||meta.declaredTotal<0) return {state:'UNIVERSE_INCOMPLETE',reasons:['MISSING_DECLARED_EQUITY_TOTAL']};
  if(!meta.sourceReceipt) return {state:'BLOCKED',reasons:['MISSING_OFFICIAL_SOURCE_RECEIPT']};
  const verified=validateSourceReceipt(meta.sourceReceipt,{policy:DEFAULT_SOURCE_POLICY.OFFICIAL_EGX});
  if(verified.state!=='READY') return {state:'BLOCKED',reasons:['UNVERIFIED_OFFICIAL_SOURCE_RECEIPT',...verified.reasons]};
  const r=verified.receipt;
  const reasons=[];
  if(r.sourceId!==meta.sourceId) reasons.push('SOURCE_RECEIPT_ID_MISMATCH');
  if(r.sourceUrl!==meta.sourceUrl) reasons.push('SOURCE_RECEIPT_URL_MISMATCH');
  if(r.session!==meta.asOfDate) reasons.push('SOURCE_RECEIPT_SESSION_MISMATCH');
  if(r.contentHash!==String(meta.sourceHash??'').toLowerCase()) reasons.push('SOURCE_RECEIPT_CONTENT_HASH_MISMATCH');
  if(!DIRECT_OFFICIAL_KINDS.has(String(r.provenanceKind).toUpperCase())) reasons.push('SOURCE_RECEIPT_NOT_DIRECT_OFFICIAL_CONTENT');
  if(reasons.length) return {state:'BLOCKED',reasons};
  const scopeProof={state:'VERIFIED',kind:'OFFICIAL_DOCUMENT_SCOPE',scope:'ALL_LISTED_EQUITIES',evidenceLocator:clean(meta.scopeProof.evidenceLocator),sourceReceiptHash:r.receiptHash};
  scopeProof.scopeProofHash=sha256(scopeProof);
  return {state:'READY',reasons:[],sourceReceipt:r,scopeProof};
}

export function adaptEgxListedSnapshot(rows,meta={}){
  const evidenceType=String(meta.evidenceType??'').toUpperCase();
  if(!SNAPSHOT_TYPES.has(evidenceType)) return {state:'BLOCKED',reasons:['INVALID_SNAPSHOT_EVIDENCE_TYPE'],evidence:[],manifest:null};
  if(!meta.asOfDate||!meta.sourceId||!meta.sourceUrl||!meta.sourceHash) return {state:'BLOCKED',reasons:['MISSING_SNAPSHOT_PROVENANCE'],evidence:[],manifest:null};
  const admission=verifySnapshotAdmission(meta);
  if(admission.state!=='READY') return {state:admission.state,reasons:admission.reasons,evidence:[],manifest:null};
  const accepted=[];const ignored=[];const blocked=[];
  for(const row of rows??[]){
    const assetClass=classifyEgxSecurity(row);
    if(assetClass!=='EQUITY'){ignored.push({assetClass,isin:row?.isin??null,reutersCode:row?.reutersCode??null});continue}
    const ticker=tickerFromReuters(row.reutersCode??row.ticker),isin=clean(row.isin).toUpperCase();
    const reasons=[];if(!ticker)reasons.push('MISSING_TICKER');if(!validIsin(isin))reasons.push('INVALID_EQUITY_ISIN');
    if(reasons.length){blocked.push({row,reasons});continue}
    accepted.push({ticker,reutersCode:`${ticker}.CA`,isin,evidenceType,sourceId:meta.sourceId,effectiveDate:dateOnly(row.effectiveDate??meta.asOfDate),capturedAt:admission.sourceReceipt.capturedAt,segment:String(row.segment??'UNKNOWN').toUpperCase(),companyName:row.companyName??null,status:String(row.status??'ACTIVE').toUpperCase(),sourceUrl:meta.sourceUrl,sourceHash:meta.sourceHash,sourceReceiptHash:admission.sourceReceipt.receiptHash,scopeProofHash:admission.scopeProof.scopeProofHash});
  }
  if(blocked.length) return {state:'BLOCKED',reasons:['MALFORMED_EQUITY_ROWS'],blocked,evidence:[],manifest:null};
  const dedupe=new Set(accepted.map(x=>`${x.ticker}|${x.isin}`));
  if(dedupe.size!==accepted.length) return {state:'DATA_CONFLICT',reasons:['DUPLICATE_TICKER_ISIN_ROWS'],evidence:[],manifest:null};
  if(accepted.length!==meta.declaredTotal) return {state:'DATA_CONFLICT',reasons:[`DECLARED_EQUITY_TOTAL_MISMATCH:${meta.declaredTotal}:${accepted.length}`],evidence:[],manifest:null};
  const manifest={sourceId:meta.sourceId,sourceUrl:meta.sourceUrl,sourceHash:meta.sourceHash,capturedAt:admission.sourceReceipt.capturedAt,asOfDate:meta.asOfDate,evidenceType,declaredTotal:meta.declaredTotal,rawRows:(rows??[]).length,equityRows:accepted.length,ignoredNonEquity:ignored.length,exhaustive:true,sourceReceiptHash:admission.sourceReceipt.receiptHash,scopeProofHash:admission.scopeProof.scopeProofHash};
  manifest.manifestHash=sha256(manifest);
  return {state:'READY',reasons:[],evidence:accepted.sort((a,b)=>a.ticker.localeCompare(b.ticker)),ignored,manifest};
}
