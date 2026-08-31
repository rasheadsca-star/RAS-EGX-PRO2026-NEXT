import { sha256 } from './hash.js';

export const UNIVERSE_STATES = Object.freeze({READY:'READY',UNIVERSE_INCOMPLETE:'UNIVERSE_INCOMPLETE',DATA_CONFLICT:'DATA_CONFLICT',SOURCE_UNAVAILABLE:'SOURCE_UNAVAILABLE',BLOCKED:'BLOCKED'});
const INCLUSION_EVIDENCE=new Set(['OFFICIAL_LISTED_SECURITIES_SNAPSHOT','OFFICIAL_DAILY_BULLETIN']);
const IDENTITY_EVIDENCE=new Set([...INCLUSION_EVIDENCE,'OFFICIAL_LISTING_NEWS','OFFICIAL_DISCLOSURE']);
const SEGMENTS=new Set(['MAIN','SME','UNKNOWN']);
const HEX64=/^[0-9a-f]{64}$/i;

export function canonicalTicker(value){return String(value??'').trim().toUpperCase().replace(/\.CA$/,'')}
export function canonicalReuters(value){const t=canonicalTicker(value);return t?`${t}.CA`:null}
export function validIsin(value){return /^EG[A-Z0-9]{10}$/.test(String(value??'').trim().toUpperCase())}

function normalizeEvidence(e){
  const ticker=canonicalTicker(e.ticker??e.reutersCode),isin=String(e.isin??'').trim().toUpperCase()||null,evidenceType=String(e.evidenceType??'').trim().toUpperCase(),sourceId=String(e.sourceId??'').trim(),effectiveDate=String(e.effectiveDate??e.asOfDate??'').slice(0,10)||null,capturedAt=e.capturedAt??null,segment=String(e.segment??'UNKNOWN').trim().toUpperCase();
  return {ticker,reutersCode:canonicalReuters(ticker),isin,evidenceType,sourceId,effectiveDate,capturedAt,segment:SEGMENTS.has(segment)?segment:'UNKNOWN',companyName:e.companyName??null,status:String(e.status??'ACTIVE').toUpperCase(),sourceUrl:e.sourceUrl??null,sourceHash:e.sourceHash??null,sourceReceiptHash:e.sourceReceiptHash??null,scopeProofHash:e.scopeProofHash??null};
}
function inclusionProofValid(e){return !INCLUSION_EVIDENCE.has(e.evidenceType)||(HEX64.test(String(e.sourceReceiptHash??''))&&HEX64.test(String(e.scopeProofHash??'')))}

export function buildAuthoritativeUniverse(evidence,{asOfDate,declaredTotal=null,requireSnapshot=true}={}){
  if(!asOfDate) throw new Error('asOfDate required');
  if(!Array.isArray(evidence)||!evidence.length) return {state:'SOURCE_UNAVAILABLE',reasons:['NO_OFFICIAL_UNIVERSE_EVIDENCE'],asOfDate,total:0,rows:[],version:null,sourceManifest:null};
  const rows=evidence.map(normalizeEvidence).filter(e=>!e.effectiveDate||e.effectiveDate<=asOfDate);
  const malformed=rows.filter(e=>!e.sourceId||!IDENTITY_EVIDENCE.has(e.evidenceType)||!e.ticker||(e.isin&&!validIsin(e.isin)));
  if(malformed.length) return {state:'BLOCKED',reasons:['MALFORMED_OFFICIAL_IDENTITY_EVIDENCE'],asOfDate,total:0,rows:[],version:null,sourceManifest:null};
  const unproven=rows.filter(e=>INCLUSION_EVIDENCE.has(e.evidenceType)&&!inclusionProofValid(e));
  if(unproven.length) return {state:'BLOCKED',reasons:['UNPROVEN_OFFICIAL_INCLUSION_EVIDENCE'],asOfDate,total:0,rows:[],version:null,sourceManifest:null};

  const snapshotRows=rows.filter(e=>INCLUSION_EVIDENCE.has(e.evidenceType)&&e.status!=='DELISTED');
  if(requireSnapshot&&!snapshotRows.length) return {state:'UNIVERSE_INCOMPLETE',reasons:['NO_EXHAUSTIVE_OFFICIAL_SNAPSHOT'],asOfDate,total:0,rows:[],version:null,sourceManifest:null};

  const byTicker=new Map();for(const e of rows){const current=byTicker.get(e.ticker)??[];current.push(e);byTicker.set(e.ticker,current)}
  const conflicts=[];const isinToTicker=new Map();
  for(const [ticker,items] of byTicker){const isins=[...new Set(items.map(x=>x.isin).filter(Boolean))];if(isins.length>1)conflicts.push(`TICKER_MULTIPLE_ISIN:${ticker}:${isins.join(',')}`);for(const isin of isins){const prior=isinToTicker.get(isin);if(prior&&prior!==ticker)conflicts.push(`ISIN_MULTIPLE_TICKER:${isin}:${prior},${ticker}`);else isinToTicker.set(isin,ticker)}}
  if(conflicts.length) return {state:'DATA_CONFLICT',reasons:conflicts,asOfDate,total:0,rows:[],version:null,sourceManifest:null};

  const activeTickers=new Set(snapshotRows.map(x=>x.ticker));
  const canonical=[...activeTickers].map(ticker=>{
    const items=byTicker.get(ticker)??[],inclusion=items.filter(x=>INCLUSION_EVIDENCE.has(x.evidenceType)&&x.status!=='DELISTED'),best=[...inclusion,...items].sort((a,b)=>(b.effectiveDate??'').localeCompare(a.effectiveDate??'')||a.sourceId.localeCompare(b.sourceId))[0];
    const sourceEvidence=items.map(x=>({sourceId:x.sourceId,evidenceType:x.evidenceType,effectiveDate:x.effectiveDate,capturedAt:x.capturedAt,sourceUrl:x.sourceUrl,sourceHash:x.sourceHash,sourceReceiptHash:x.sourceReceiptHash,scopeProofHash:x.scopeProofHash})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return {ticker,reutersCode:`${ticker}.CA`,isin:best.isin??items.find(x=>x.isin)?.isin??null,companyName:best.companyName??items.find(x=>x.companyName)?.companyName??null,segment:best.segment??'UNKNOWN',status:'ACTIVE',identityVerified:items.some(x=>IDENTITY_EVIDENCE.has(x.evidenceType)),inclusionVerified:inclusion.length>0,evidenceCount:items.length,evidenceHash:sha256(sourceEvidence)};
  }).sort((a,b)=>a.ticker.localeCompare(b.ticker));

  const reasons=[];if(canonical.some(x=>!x.identityVerified||!x.inclusionVerified))reasons.push('UNVERIFIED_UNIVERSE_MEMBER');if(Number.isInteger(declaredTotal)&&declaredTotal>=0&&canonical.length!==declaredTotal)reasons.push(`DECLARED_TOTAL_MISMATCH:${declaredTotal}:${canonical.length}`);
  const sourceManifest={asOfDate,sources:[...new Set(rows.map(x=>x.sourceId))].sort(),evidenceTypes:[...new Set(rows.map(x=>x.evidenceType))].sort(),evidenceCount:rows.length,declaredTotal,sourceReceiptHashes:[...new Set(snapshotRows.map(x=>x.sourceReceiptHash))].sort(),scopeProofHashes:[...new Set(snapshotRows.map(x=>x.scopeProofHash))].sort()};sourceManifest.manifestHash=sha256(sourceManifest);
  const version=sha256({asOfDate,sourceManifestHash:sourceManifest.manifestHash,rows:canonical});return {state:reasons.length?'UNIVERSE_INCOMPLETE':'READY',reasons,asOfDate,total:canonical.length,rows:canonical,version,sourceManifest};
}
