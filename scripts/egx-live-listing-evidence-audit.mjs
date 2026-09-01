import fs from 'node:fs';
import crypto from 'node:crypto';
import {classifyEgxListedUniverse} from '../src/egx-listed-security-classification.js';

const EVIDENCE='data/research/egx-listing-evidence-2026-09-01.json';
const OUT='artifacts/egx-live-listing-evidence-audit.json';
const BASE='https://beta.egx.com.eg/api/bff/egx/';
const REFERER='https://beta.egx.com.eg/en/listed/stocks';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const sort=a=>[...a].sort();
const diff=(a,b)=>sort([...a].filter(x=>!b.has(x)));

async function get(endpoint){
  const res=await fetch(BASE+endpoint,{headers:{accept:'application/json','x-egx-bff-request':'1',referer:REFERER,'user-agent':'Mozilla/5.0 Chrome/151'}});
  const raw=Buffer.from(await res.arrayBuffer());
  let parsed=null; try{parsed=JSON.parse(raw.toString('utf8'))}catch{}
  return {endpoint,httpStatus:res.status,contentType:res.headers.get('content-type'),bytes:raw.length,sha256:sha(raw),parsed};
}

fs.mkdirSync('artifacts',{recursive:true});
const evidenceRaw=fs.readFileSync(EVIDENCE);
const evidence=JSON.parse(evidenceRaw);
const [info,cats]=await Promise.all([get('stock-info'),get('stock-categories')]);
if(info.httpStatus!==200||!Array.isArray(info.parsed?.data)) throw new Error('stock-info unavailable');
if(cats.httpStatus!==200||!cats.parsed?.data) throw new Error('stock-categories unavailable');

const before=classifyEgxListedUniverse(info.parsed,cats.parsed);
const tempRecords=evidence.temporaryListings??[];
const tamayuzRecords=evidence.sme?.tamayuzEvidence?.members??[];
const after=classifyEgxListedUniverse(info.parsed,cats.parsed,{
  temporaryListingEvidence:tempRecords,
  smeTamayuzEvidence:tamayuzRecords,
  inferSmeNileFromComplement:true
});

const liveUnsegmented=new Set(before.rows.filter(x=>x.listingState==='UNSEGMENTED_NONTRADING_LISTING_CANDIDATE').map(x=>x.isin));
const evidenceTemp=new Set(tempRecords.map(x=>String(x.isin??'').trim().toUpperCase()).filter(Boolean));
const liveSme=new Set(after.smeOnly.map(x=>x.isin));
const tamayuz=new Set(tamayuzRecords.map(x=>String(x.isin??'').trim().toUpperCase()).filter(Boolean));
const overlap=after.categoryTopology.overlaps.find(x=>x.left==='INACTIVE'&&x.right==='SME')??null;
const report={
  schemaVersion:'egx-live-listing-evidence-audit-1',
  generatedAt:new Date().toISOString(),
  evidence:{path:EVIDENCE,sha256:sha(evidenceRaw),asOfDate:evidence.asOfDate,authorityMode:evidence.authorityMode},
  officialReceipts:{
    stockInfo:{endpoint:info.endpoint,httpStatus:info.httpStatus,contentType:info.contentType,bytes:info.bytes,sha256:info.sha256},
    stockCategories:{endpoint:cats.endpoint,httpStatus:cats.httpStatus,contentType:cats.contentType,bytes:cats.bytes,sha256:cats.sha256}
  },
  stockInfo:{count:after.stockInfoCount,egyptianEquityCount:after.stockInfoEgyptianEquityCount,instrumentCounts:after.instrumentCounts,equityPartition:after.stockInfoEquityPartition},
  tradable:{productionTradableEquityCandidateCount:after.productionTradableEquityCandidateCount,productionAuthority:false},
  temporaryListings:{
    liveUnsegmentedBeforeEvidence:liveUnsegmented.size,
    registryCount:evidenceTemp.size,
    missingRegistryEvidenceForLive:diff(liveUnsegmented,evidenceTemp),
    registryEvidenceAbsentFromLiveUnsegmented:diff(evidenceTemp,liveUnsegmented),
    exactSetMatch:liveUnsegmented.size===evidenceTemp.size&&diff(liveUnsegmented,evidenceTemp).length===0&&diff(evidenceTemp,liveUnsegmented).length===0,
    confirmedAfterEvidence:after.temporaryListingConfirmedCount,
    unresolvedAfterEvidence:after.unresolvedTemporaryEvidenceCount
  },
  sme:{
    officialCategoryCount:after.smeCategoryCount,
    identityOnlyCount:after.smeOnly.length,
    tamayuzEvidenceCount:tamayuz.size,
    tamayuzOutsideOfficialSme:diff(tamayuz,liveSme),
    segmentCounts:after.smeSegmentCounts,
    inactiveSmeOverlap:overlap,
    productionAuthority:false
  },
  categoryTopology:after.categoryTopology,
  productionAuthority:false
};

const checks={
  stockInfo262:after.stockInfoCount===262,
  egyptianEquities256:after.stockInfoEgyptianEquityCount===256,
  tradableCandidates213:after.productionTradableEquityCandidateCount===213,
  temporaryExact28:report.temporaryListings.exactSetMatch&&evidenceTemp.size===28,
  temporaryResolved:after.temporaryListingConfirmedCount===28&&after.unresolvedTemporaryEvidenceCount===0,
  sme21:after.smeCategoryCount===21&&after.smeOnly.length===21,
  tamayuz5:tamayuz.size===5&&after.smeSegmentCounts.TAMAYUZ_INDEPENDENT_EVIDENCE===5,
  nileInferred16:after.smeSegmentCounts.NILE_INFERRED_FROM_OFFICIAL_SME_MINUS_TAMAYUZ===16,
  smeInactiveOverlap5:overlap?.count===5,
  noInvalidTamayuzEvidence:after.invalidTamayuzEvidence.length===0
};
report.checks=checks;
report.verdict=Object.values(checks).every(Boolean)?'PASS_RESEARCH_IDENTITY_PARTITION':'FAIL_CLOSED';
fs.writeFileSync(OUT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.verdict!=='PASS_RESEARCH_IDENTITY_PARTITION') process.exit(1);
