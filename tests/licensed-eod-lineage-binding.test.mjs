import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256,canonicalize } from '../src/hash.js';
import { EgxMarketDataStore } from '../src/market-data-store.js';
import { createLicensedEodDatasetAdmissionCertificate,verifyLicensedEodDatasetAdmissionCertificate,licensedEodAdmissionMatchesBar } from '../src/licensed-eod-admission.js';
import { createHistoricalObservationLineage,verifyHistoricalObservationLineage } from '../src/historical-observation-lineage.js';

const HISTORY_SESSION='2026-08-28';
const MARKET_SESSION='2026-08-31';
const PARSER='LICENSED_EOD_JSON_BAR_V1';
const BARS=[
  {ticker:'AIH',session:HISTORY_SESSION,open:20,high:21,low:19.5,close:20.6,volume:250000},
  {ticker:'VERT',session:HISTORY_SESSION,open:10,high:11,low:9.8,close:10.7,volume:125000}
];
const RAW=JSON.stringify({session:HISTORY_SESSION,rows:BARS});
const CAPABILITY={provider:'ICE',candidateSourceId:'LICENSED_EOD',providerGroup:'LICENSED_EOD_VENDOR',capabilityEvidence:{egxCoveragePublished:true,historicalAvailablePublished:true,endOfDayAvailablePublished:true,assetClassIncludesEquities:true,aggregatedOhlcBarsPublished:true,endOfDayOhlcBarsPublished:true}};
const LICENSE={provider:'ICE',entitlementConfirmed:true,permittedApplicationUseConfirmed:true,licenseReceiptHash:'a'.repeat(64)};
const DATASET_RECEIPT={sourceId:'LICENSED_EOD',sourceClass:'LICENSED_EOD',providerGroup:'LICENSED_EOD_VENDOR',sourceUrl:'https://example-data.ice.com/egx/eod/2026-08-28',capturedAt:'2026-08-29T06:00:00Z',session:HISTORY_SESSION,provenanceKind:'API_RAW_JSON',contentHash:sha256(RAW)};
const CROSSCHECK={sourceId:'MUBASHER',sourceClass:'PUBLIC_MARKET',providerGroup:'MUBASHER',sourceUrl:'https://english.mubasher.info/markets/EGX',capturedAt:'2026-08-29T06:01:00Z',session:HISTORY_SESSION,provenanceKind:'RAW_CSV',contentHash:'b'.repeat(64)};

function admission(rawPayload=RAW,session=HISTORY_SESSION,bars=BARS,expected=['AIH','VERT']){
  return createLicensedEodDatasetAdmissionCertificate({capabilityEvidence:CAPABILITY,licenseEvidence:LICENSE,datasetReceipt:{...DATASET_RECEIPT,session,contentHash:sha256(rawPayload)},rawPayload,session,expectedTradeBarIds:expected,bars,parserId:PARSER,parserVersion:'1',fieldSemanticsVerified:true,independentCrossCheckReceipt:{...CROSSCHECK,session}});
}
function productionStore(id='licensed-history'){
  const store=new EgxMarketDataStore(':memory:');
  const body={mode:'CERTIFIED_PRODUCTION',session:MARKET_SESSION,primarySource:'OFFICIAL_EGX'};
  const sourcePayload={...body,manifestHash:sha256(body)};
  const sourceManifestHash=store.putSourceManifest(sourcePayload,'2026-08-31T15:00:00Z');
  store.startDataSnapshot({dataSnapshotId:id,marketSession:MARKET_SESSION,sourceManifestHash,createdAt:'2026-08-31T15:01:00Z',ingestionMode:'CERTIFIED_PRODUCTION'});
  return {store,dataSnapshotId:id,sourceManifestHash};
}

test('fully evidenced licensed dataset creates deterministic admission bound to raw bytes coverage and bar proofs',()=>{
  const a=admission(),b=admission();
  assert.equal(a.admissionHash,b.admissionHash);
  assert.equal(verifyLicensedEodDatasetAdmissionCertificate(a,{rawPayload:RAW}).state,'READY');
  assert.equal(a.barProofs.length,2);
  assert.equal(licensedEodAdmissionMatchesBar(a,BARS[1],{rawPayload:RAW}),true);
});

test('licensed historical lineage cannot exist without dataset admission',()=>{
  assert.throws(()=>createHistoricalObservationLineage({dataSnapshotId:'s1',bar:BARS[1],receipt:DATASET_RECEIPT,rawPayload:RAW,parserId:PARSER,parserVersion:'1'}),/LICENSED_EOD_ADMISSION_REQUIRED_FOR_HISTORICAL_LINEAGE/);
});

test('valid licensed admission authorizes only the exact admitted bar and raw dataset',()=>{
  const a=admission();
  const cert=createHistoricalObservationLineage({dataSnapshotId:'s1',bar:BARS[1],receipt:DATASET_RECEIPT,rawPayload:RAW,parserId:PARSER,parserVersion:'1',licensedDatasetAdmission:a});
  assert.equal(verifyHistoricalObservationLineage(cert).state,'READY');
  assert.equal(cert.licensedDatasetAdmissionHash,a.admissionHash);
  const notAdmitted={ticker:'ORAS',session:HISTORY_SESSION,open:50,high:51,low:49,close:50.5,volume:1000};
  assert.throws(()=>createHistoricalObservationLineage({dataSnapshotId:'s1',bar:notAdmitted,receipt:DATASET_RECEIPT,rawPayload:RAW,parserId:PARSER,parserVersion:'1',licensedDatasetAdmission:a}),/LICENSED_EOD_ADMISSION_BAR_MISMATCH/);
});

test('licensed admission cannot be replayed against a different dataset or session',()=>{
  const a=admission();
  const changedRaw=JSON.stringify({session:HISTORY_SESSION,rows:[BARS[0],{...BARS[1],close:10.8}]});
  const v=verifyLicensedEodDatasetAdmissionCertificate(a,{rawPayload:changedRaw});
  assert.equal(v.state,'BLOCKED');
  assert.ok(v.reasons.some(x=>x.includes('CONTENT_HASH_MISMATCH')));
  const nextRaw=JSON.stringify({session:'2026-08-29',rows:BARS.map(x=>({...x,session:'2026-08-29'}))});
  assert.throws(()=>createHistoricalObservationLineage({dataSnapshotId:'s1',bar:{...BARS[1],session:'2026-08-29'},receipt:{...DATASET_RECEIPT,session:'2026-08-29',contentHash:sha256(nextRaw)},rawPayload:nextRaw,parserId:PARSER,parserVersion:'1',licensedDatasetAdmission:a}),/LICENSED_EOD_ADMISSION_INVALID|LICENSED_EOD_ADMISSION_RECEIPT_MISMATCH/);
});

test('tampered admission cannot survive without exact admission hash and bar proofs',()=>{
  const a=admission();
  const tampered={...a,licenseEvidence:{...a.licenseEvidence,licenseReceiptHash:'c'.repeat(64)}};
  assert.equal(verifyLicensedEodDatasetAdmissionCertificate(tampered,{rawPayload:RAW}).state,'BLOCKED');
  const proofs={...a,barProofs:a.barProofs.map((x,i)=>i?{...x,barHash:'d'.repeat(64)}:x)};
  const body={...proofs};delete body.admissionHash;proofs.admissionHash=sha256(body);
  const pv=verifyLicensedEodDatasetAdmissionCertificate(proofs,{rawPayload:RAW});
  assert.equal(pv.state,'BLOCKED');
  assert.ok(pv.reasons.includes('LICENSED_EOD_ADMISSION_BAR_PROOFS_INVALID'));
});

test('licensed admission is rejected when attached to official exchange historical lineage',()=>{
  const a=admission();
  const raw={ticker:'VERT',session:HISTORY_SESSION,open:10,high:11,low:9.8,close:10.7,volume:125000};
  const r={sourceId:'OFFICIAL_EGX',sourceClass:'OFFICIAL_EXCHANGE',providerGroup:'EGX',sourceUrl:'https://beta.egx.com.eg/history',capturedAt:'2026-08-29T06:00:00Z',session:HISTORY_SESSION,provenanceKind:'DIRECT_FILE',contentHash:sha256(raw)};
  assert.throws(()=>createHistoricalObservationLineage({dataSnapshotId:'s1',bar:raw,receipt:r,rawPayload:raw,parserId:'OFFICIAL_EGX_JSON_BAR_V1',parserVersion:'1',licensedDatasetAdmission:a}),/LICENSED_EOD_ADMISSION_UNEXPECTED_FOR_OFFICIAL_LINEAGE/);
});

test('SSOT licensed historical API rejects missing admission and accepts exact admitted lineage',()=>{
  const {store,dataSnapshotId}=productionStore('licensed-api');
  assert.throws(()=>store.putCertifiedHistoricalNormalizedBar({dataSnapshotId,bar:BARS[1],receipt:DATASET_RECEIPT,rawPayload:RAW,parserId:PARSER,parserVersion:'1'}),/LICENSED_EOD_ADMISSION_REQUIRED_FOR_HISTORICAL_LINEAGE/);
  const a=admission();
  const rowHash=store.putCertifiedHistoricalNormalizedBar({dataSnapshotId,bar:BARS[1],receipt:DATASET_RECEIPT,rawPayload:RAW,parserId:PARSER,parserVersion:'1',licensedDatasetAdmission:a});
  assert.match(rowHash,/^[0-9a-f]{64}$/);
  const stored=store.db.prepare('SELECT payload_json FROM historical_observation_lineage WHERE data_snapshot_id=? AND ticker=?').get(dataSnapshotId,'VERT');
  assert.equal(verifyHistoricalObservationLineage(JSON.parse(stored.payload_json)).state,'READY');
});

test('direct SQL cannot plant licensed historical lineage after removing its admission and recomputing outer certificate hash',()=>{
  const {store,dataSnapshotId}=productionStore('licensed-sql');
  const a=admission();
  const valid=createHistoricalObservationLineage({dataSnapshotId,bar:BARS[1],receipt:DATASET_RECEIPT,rawPayload:RAW,parserId:PARSER,parserVersion:'1',licensedDatasetAdmission:a});
  const forged={...valid,licensedDatasetAdmission:null,licensedDatasetAdmissionHash:null};
  const body={...forged};delete body.certificateHash;forged.certificateHash=sha256(body);
  assert.equal(verifyHistoricalObservationLineage(forged).state,'BLOCKED');
  assert.throws(()=>store.db.prepare(`INSERT INTO historical_observation_lineage(certificate_hash,data_snapshot_id,ticker,session,source_id,source_class,source_receipt_hash,bar_hash,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(forged.certificateHash,dataSnapshotId,forged.ticker,forged.session,forged.sourceId,forged.sourceClass,forged.sourceReceipt.receiptHash,forged.barHash,canonicalize(forged),'2026-08-31T15:02:00Z'),/INVALID_HISTORICAL_LINEAGE_ROW/);
});

test('licensed admission hash is an entitlement-document anchor, not a vendor signature or automatic production authority',()=>{
  const a=admission();
  assert.equal(a.productionAuthority,false);
  assert.match(a.licenseEvidence.licenseReceiptHash,/^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(a,'licenseDocumentPayload'),false);
});
