import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, canonicalize } from '../src/hash.js';
import { EgxMarketDataStore } from '../src/market-data-store.js';
import { createHistoricalObservationLineage, verifyHistoricalObservationLineage, historicalLineageMatchesBar, historicalBarHash } from '../src/historical-observation-lineage.js';

const MARKET_SESSION='2026-08-31';
const HISTORY_SESSION='2026-08-28';
const OFFICIAL_PARSER='OFFICIAL_EGX_JSON_BAR_V1';
const BAR=Object.freeze({ticker:'VERT',session:HISTORY_SESSION,open:10,high:11,low:9.8,close:10.7,volume:125000});
const RAW=Object.freeze({ticker:'VERT',session:HISTORY_SESSION,open:10,high:11,low:9.8,close:10.7,volume:125000,source:'official-eod-file'});

function receipt(sourceId='OFFICIAL_EGX',sourceClass='OFFICIAL_EXCHANGE',providerGroup='EGX',rawPayload=RAW){
  return {sourceId,sourceClass,providerGroup,sourceUrl:'https://beta.egx.com.eg/downloads/history.csv',session:HISTORY_SESSION,capturedAt:'2026-08-29T08:00:00Z',provenanceKind:'DIRECT_FILE',contentHash:sha256(rawPayload)};
}

function productionStore(id='hist-snap'){
  const store=new EgxMarketDataStore(':memory:');
  const body={mode:'CERTIFIED_PRODUCTION',session:MARKET_SESSION,primarySource:'OFFICIAL_EGX'};
  const sourcePayload={...body,manifestHash:sha256(body)};
  const sourceManifestHash=store.putSourceManifest(sourcePayload,'2026-08-31T15:00:00Z');
  store.startDataSnapshot({dataSnapshotId:id,marketSession:MARKET_SESSION,sourceManifestHash,createdAt:'2026-08-31T15:01:00Z',ingestionMode:'CERTIFIED_PRODUCTION'});
  return {store,sourceManifestHash,dataSnapshotId:id};
}

function normalizedRowHash({dataSnapshotId,sourceManifestHash,bar}){
  return sha256({dataSnapshotId,ticker:bar.ticker,session:bar.session,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume??null,sourceManifestHash,certifiedReconciliationManifestHash:null,primaryObservationCertificateHash:null});
}

test('official historical receipt produces deterministic production lineage bound to exact bar',()=>{
  const a=createHistoricalObservationLineage({dataSnapshotId:'s1',bar:BAR,receipt:receipt(),rawPayload:RAW,parserId:OFFICIAL_PARSER,parserVersion:'1'});
  const b=createHistoricalObservationLineage({dataSnapshotId:'s1',bar:BAR,receipt:receipt(),rawPayload:RAW,parserId:OFFICIAL_PARSER,parserVersion:'1'});
  assert.equal(a.certificateHash,b.certificateHash);
  assert.equal(verifyHistoricalObservationLineage(a).state,'READY');
  assert.equal(historicalLineageMatchesBar(a,{dataSnapshotId:'s1',...BAR}),true);
  assert.equal(historicalLineageMatchesBar(a,{dataSnapshotId:'s1',...BAR,close:10.8}),false);
});

test('Yahoo and public market sources cannot authorize production history',()=>{
  assert.throws(()=>createHistoricalObservationLineage({dataSnapshotId:'s1',bar:BAR,receipt:receipt('YAHOO','HISTORY_ONLY','YAHOO'),rawPayload:RAW,parserId:'yahoo',parserVersion:'1'}),/HISTORICAL_SOURCE_NOT_PRODUCTION_AUTHORIZED/);
  assert.throws(()=>createHistoricalObservationLineage({dataSnapshotId:'s1',bar:BAR,receipt:receipt('MUBASHER','PUBLIC_MARKET','MUBASHER'),rawPayload:RAW,parserId:'mubasher',parserVersion:'1'}),/HISTORICAL_SOURCE_NOT_PRODUCTION_AUTHORIZED/);
});

test('official source cannot authorize production history through an unregistered parser',()=>{
  assert.throws(()=>createHistoricalObservationLineage({dataSnapshotId:'s1',bar:BAR,receipt:receipt(),rawPayload:RAW,parserId:'egx-eod-csv',parserVersion:'1'}),/HISTORICAL_PARSER_UNSUPPORTED/);
});

test('historical certificate rejects raw payload tampering even when receipt metadata is otherwise valid',()=>{
  const r=receipt();
  assert.throws(()=>createHistoricalObservationLineage({dataSnapshotId:'s1',bar:BAR,receipt:r,rawPayload:{...RAW,close:99},parserId:OFFICIAL_PARSER,parserVersion:'1'}),/HISTORICAL_LINEAGE_RECEIPT_INVALID:.*CONTENT_HASH_MISMATCH/);
});

test('official raw payload must deterministically reproduce the claimed historical bar',()=>{
  assert.throws(()=>createHistoricalObservationLineage({dataSnapshotId:'s1',bar:{...BAR,close:10.8},receipt:receipt(),rawPayload:RAW,parserId:OFFICIAL_PARSER,parserVersion:'1'}),/HISTORICAL_LINEAGE_EXTRACTED_BAR_MISMATCH/);
});

test('production SSOT accepts historical bar only through certified lineage API and can finalize exact snapshot',()=>{
  const {store,sourceManifestHash,dataSnapshotId}=productionStore('hist-api');
  const rowHash=store.putCertifiedHistoricalNormalizedBar({dataSnapshotId,bar:{...BAR},receipt:receipt(),rawPayload:RAW,parserId:OFFICIAL_PARSER,parserVersion:'1'});
  assert.match(rowHash,/^[0-9a-f]{64}$/);
  const lineage=store.db.prepare('SELECT payload_json FROM historical_observation_lineage WHERE data_snapshot_id=? AND ticker=? AND session=?').get(dataSnapshotId,BAR.ticker,BAR.session);
  assert.ok(lineage);
  assert.equal(verifyHistoricalObservationLineage(JSON.parse(lineage.payload_json)).state,'READY');
  const contentHash=store.finalizeDataSnapshot(dataSnapshotId,'2026-08-31T15:10:00Z');
  assert.match(contentHash,/^[0-9a-f]{64}$/);
  const saved=store.db.prepare('SELECT content_hash FROM data_snapshots WHERE data_snapshot_id=?').get(dataSnapshotId);
  assert.equal(saved.content_hash,contentHash);
  assert.equal(sourceManifestHash.length,64);
});

test('generic normalized API cannot bypass production historical lineage',()=>{
  const {store,sourceManifestHash,dataSnapshotId}=productionStore('hist-generic');
  assert.throws(()=>store.putNormalizedBar({dataSnapshotId,sourceManifestHash,...BAR}),/CERTIFIED_PRODUCTION_HISTORICAL_BAR_REQUIRES_LINEAGE/);
});

test('direct SQL cannot plant production historical normalized bar without certified lineage',()=>{
  const {store,sourceManifestHash,dataSnapshotId}=productionStore('hist-sql');
  const rowHash=normalizedRowHash({dataSnapshotId,sourceManifestHash,bar:BAR});
  assert.throws(()=>store.db.prepare(`INSERT INTO normalized_bars(data_snapshot_id,ticker,session,open,high,low,close,volume,source_manifest_hash,certified_reconciliation_manifest_hash,primary_observation_certificate_hash,row_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(dataSnapshotId,BAR.ticker,BAR.session,BAR.open,BAR.high,BAR.low,BAR.close,BAR.volume,sourceManifestHash,null,null,rowHash),/CERTIFIED_PRODUCTION_HISTORY_REQUIRES_LINEAGE/);
});

test('direct SQL cannot plant future session bar into production snapshot',()=>{
  const {store,sourceManifestHash,dataSnapshotId}=productionStore('future-sql');
  const future={ticker:'VERT',session:'2026-09-01',open:10,high:11,low:9.8,close:10.7,volume:1};
  const rowHash=normalizedRowHash({dataSnapshotId,sourceManifestHash,bar:future});
  assert.throws(()=>store.db.prepare(`INSERT INTO normalized_bars(data_snapshot_id,ticker,session,open,high,low,close,volume,source_manifest_hash,certified_reconciliation_manifest_hash,primary_observation_certificate_hash,row_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(dataSnapshotId,future.ticker,future.session,future.open,future.high,future.low,future.close,future.volume,sourceManifestHash,null,null,rowHash),/CERTIFIED_PRODUCTION_FUTURE_BAR_FORBIDDEN/);
});

test('direct SQL cannot plant recomputed certificate around tampered raw historical payload',()=>{
  const {store,dataSnapshotId}=productionStore('tampered-cert');
  const valid=createHistoricalObservationLineage({dataSnapshotId,bar:{...BAR},receipt:receipt(),rawPayload:RAW,parserId:OFFICIAL_PARSER,parserVersion:'1'});
  const tampered={...valid,rawPayload:{...RAW,close:77}};
  const body={...tampered};delete body.certificateHash;
  tampered.certificateHash=sha256(body);
  assert.throws(()=>store.db.prepare(`INSERT INTO historical_observation_lineage(certificate_hash,data_snapshot_id,ticker,session,source_id,source_class,source_receipt_hash,bar_hash,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(tampered.certificateHash,dataSnapshotId,tampered.ticker,tampered.session,tampered.sourceId,tampered.sourceClass,tampered.sourceReceipt.receiptHash,tampered.barHash,canonicalize(tampered),'2026-08-31T15:02:00Z'),/INVALID_HISTORICAL_LINEAGE_ROW/);
});

test('recomputed hashes cannot make a forged bar survive deterministic raw parser replay',()=>{
  const {store,dataSnapshotId}=productionStore('forged-bar-cert');
  const valid=createHistoricalObservationLineage({dataSnapshotId,bar:{...BAR},receipt:receipt(),rawPayload:RAW,parserId:OFFICIAL_PARSER,parserVersion:'1'});
  const forgedBar={...valid.bar,close:10.8};
  const forgedBarHash=historicalBarHash(forgedBar);
  const forged={...valid,bar:forgedBar,barHash:forgedBarHash,extractionProofHash:sha256({sourceContentHash:valid.sourceReceipt.contentHash,parserId:valid.parserId,parserVersion:String(valid.parserVersion),barHash:forgedBarHash,extractedBar:{ticker:RAW.ticker,session:RAW.session,open:RAW.open,high:RAW.high,low:RAW.low,close:RAW.close,volume:RAW.volume}})};
  const body={...forged};delete body.certificateHash;
  forged.certificateHash=sha256(body);
  assert.equal(verifyHistoricalObservationLineage(forged).state,'BLOCKED');
  assert.ok(verifyHistoricalObservationLineage(forged).reasons.includes('HISTORICAL_LINEAGE_EXTRACTED_BAR_MISMATCH'));
  assert.throws(()=>store.db.prepare(`INSERT INTO historical_observation_lineage(certificate_hash,data_snapshot_id,ticker,session,source_id,source_class,source_receipt_hash,bar_hash,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(forged.certificateHash,dataSnapshotId,forged.ticker,forged.session,forged.sourceId,forged.sourceClass,forged.sourceReceipt.receiptHash,forged.barHash,canonicalize(forged),'2026-08-31T15:02:00Z'),/INVALID_HISTORICAL_LINEAGE_ROW/);
});
