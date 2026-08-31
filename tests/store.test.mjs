import test from 'node:test';
import assert from 'node:assert/strict';
import { EgxMarketDataStore } from '../src/market-data-store.js';
import { createSessionManifest } from '../src/session-manifest.js';

function buildLineage(db,{session='2026-08-31'}={}) {
  db.startAcquisition({acquisitionId:'A1',expectedSession:session,startedAt:'2026-08-31T12:30:00Z'});
  db.putRawBar({acquisitionId:'A1',ticker:'ABUK',session,sourceId:'S1',payload:{open:10,high:11,low:9,close:10.5,volume:1000}});
  const rawDataVersion=db.finalizeAcquisition('A1','2026-08-31T12:40:00Z');
  const sourceManifest=db.putSourceManifest({session,sources:['S1'],tickerManifests:['TM1']},'2026-08-31T12:41:00Z');
  db.startDataSnapshot({dataSnapshotId:'D1',marketSession:session,sourceManifestHash:sourceManifest,createdAt:'2026-08-31T12:42:00Z'});
  db.putNormalizedBar({dataSnapshotId:'D1',ticker:'ABUK',session,open:10,high:11,low:9,close:10.5,volume:1000,sourceManifestHash:sourceManifest});
  const normalizedDataVersion=db.finalizeDataSnapshot('D1','2026-08-31T12:43:00Z');
  const manifest=createSessionManifest({marketSession:session,exchangeCalendarVersion:'cal1',universeVersion:'u1',rawDataVersion,normalizedDataVersion,sourceManifest,corporateActionVersion:'ca1',fundamentalsCutoff:'2026-08-31T12:00:00Z',featureVersion:'f0',modelVersion:'baseline0',engineVersion:'0.3.0',configVersion:'cfg1',commitHash:'TEST',generatedAt:'2026-08-31T15:00:00Z'});
  db.putSessionManifest(manifest);
  return {manifest,rawDataVersion,normalizedDataVersion,sourceManifest};
}

function completeRecommendation(snapshotHash, overrides={}) {
  return {
    recommendationId:'R1',ticker:'ABUK',companyName:'Abu Qir Fertilizers',signalSession:'2026-08-31',createdAt:'2026-08-31T15:01:00Z',
    snapshotId:'SNAP-1',snapshotHash,engineVersion:'0.3.0',featureVersion:'f0',modelVersion:'baseline0',configVersion:'cfg1',configHash:'cfghash',commitHash:'TEST',
    decision:'WATCH',finalRankScore:55,confidence:'UNRATED',entryLow:null,entryHigh:null,entryCondition:'TRIGGER_REQUIRED',entryExpiry:null,stop:null,target1:null,target2:null,
    expectedHoldingWindow:'UNKNOWN',maximumHoldingSessions:5,grossRiskReward:null,netRiskReward:null,transactionCostAssumption:0.006,slippageAssumption:0.001,
    liquidityStatus:'UNKNOWN',dataQuality:'READY',marketRegime:'UNKNOWN',whySelected:'Potential setup',whyNotBuyNow:'Trigger not confirmed',riskFactors:[],invalidationConditions:[],evidenceType:'OUT_OF_SAMPLE',status:'OPEN',
    ...overrides
  };
}

test('SSOT follows acquisition -> normalized snapshot -> final session manifest order',()=>{const db=new EgxMarketDataStore();try{const x=buildLineage(db);assert.equal(db.dataSnapshotBars('D1','ABUK').length,1);assert.match(x.rawDataVersion,/^[a-f0-9]{64}$/);assert.match(x.normalizedDataVersion,/^[a-f0-9]{64}$/);}finally{db.close()}});

test('final session manifest cannot reference nonexistent raw or normalized versions',()=>{const db=new EgxMarketDataStore();try{const sm=db.putSourceManifest({source:'x'});const m=createSessionManifest({marketSession:'2026-08-31',exchangeCalendarVersion:'cal1',universeVersion:'u1',rawDataVersion:'missing',normalizedDataVersion:'missing',sourceManifest:sm,corporateActionVersion:'ca1',fundamentalsCutoff:'2026-08-31T12:00:00Z',featureVersion:'f0',modelVersion:'m0',engineVersion:'0.3.0',configVersion:'cfg1',commitHash:'TEST',generatedAt:'2026-08-31T15:00:00Z'});assert.throws(()=>db.putSessionManifest(m),/SESSION_MANIFEST_RAW_VERSION_NOT_FOUND/)}finally{db.close()}});

test('finalized raw acquisition and data snapshot cannot be mutated',()=>{const db=new EgxMarketDataStore();try{buildLineage(db);assert.throws(()=>db.putRawBar({acquisitionId:'A1',ticker:'X',session:'2026-08-31',sourceId:'S1',payload:{}}),/ACQUISITION_ALREADY_FINALIZED/);assert.throws(()=>db.putNormalizedBar({dataSnapshotId:'D1',ticker:'X',session:'2026-08-31',open:1,high:1,low:1,close:1,volume:1,sourceManifestHash:'x'}),/DATA_SNAPSHOT_ALREADY_FINALIZED/)}finally{db.close()}});

test('invalid OHLC cannot enter normalized truth',()=>{const db=new EgxMarketDataStore();try{const sm=db.putSourceManifest({source:'x'});db.startDataSnapshot({dataSnapshotId:'D1',marketSession:'2026-08-31',sourceManifestHash:sm,createdAt:'2026-08-31T12:00:00Z'});assert.throws(()=>db.putNormalizedBar({dataSnapshotId:'D1',ticker:'X',session:'2026-08-31',open:10,high:8,low:9,close:10,volume:1,sourceManifestHash:sm}),/INVALID_NORMALIZED_OHLC/)}finally{db.close()}});

test('recommendation contract rejects incomplete records',()=>{const db=new EgxMarketDataStore();try{const {manifest}=buildLineage(db);assert.throws(()=>db.appendRecommendation({recommendationId:'Rbad',snapshotHash:manifest.snapshotHash,signalSession:'2026-08-31',ticker:'ABUK',decision:'WATCH',createdAt:'2026-08-31T15:01:00Z'}),/RECOMMENDATION_MISSING/)}finally{db.close()}});

test('recommendation ledger is complete and append-only',()=>{const db=new EgxMarketDataStore();try{const {manifest}=buildLineage(db);db.appendRecommendation(completeRecommendation(manifest.snapshotHash));assert.throws(()=>db.db.prepare("UPDATE recommendation_ledger SET decision='BUY_CANDIDATE' WHERE recommendation_id='R1'").run(),/IMMUTABLE_RECOMMENDATION_LEDGER/);assert.throws(()=>db.db.prepare("DELETE FROM recommendation_ledger WHERE recommendation_id='R1'").run(),/IMMUTABLE_RECOMMENDATION_LEDGER/)}finally{db.close()}});

test('recommendation signal session must match immutable session manifest',()=>{const db=new EgxMarketDataStore();try{const {manifest}=buildLineage(db);assert.throws(()=>db.appendRecommendation(completeRecommendation(manifest.snapshotHash,{signalSession:'2026-08-30'})),/RECOMMENDATION_SESSION_MISMATCH/)}finally{db.close()}});

test('evidence store only accepts explicit evidence classes and is append-only',()=>{const db=new EgxMarketDataStore();try{db.appendEvidence({evidenceId:'E1',evidenceType:'BACKTEST',engineVersion:'0.3.0',configHash:'cfg',payload:{signals:10},createdAt:'2026-08-31T15:00:00Z'});assert.throws(()=>db.appendEvidence({evidenceId:'E2',evidenceType:'FORWARDISH',engineVersion:'0.3.0',configHash:'cfg',payload:{},createdAt:'2026-08-31T15:00:00Z'}),/INVALID_EVIDENCE_TYPE/);assert.throws(()=>db.db.prepare("DELETE FROM evidence_store WHERE evidence_id='E1'").run(),/IMMUTABLE_EVIDENCE_STORE/)}finally{db.close()}});

test('fundamentals are point-in-time and future publications are excluded',()=>{const db=new EgxMarketDataStore();try{db.appendFundamental({fundamentalId:'F1',ticker:'ABUK',reportPeriod:'2026-Q1',publicationDate:'2026-05-01T08:00:00Z',availableFrom:'2026-05-01T08:00:00Z',source:'EGX',verifiedAt:'2026-05-01T09:00:00Z',value:1});db.appendFundamental({fundamentalId:'F2',ticker:'ABUK',reportPeriod:'2026-Q2',publicationDate:'2026-08-15T08:00:00Z',availableFrom:'2026-08-15T08:00:00Z',source:'EGX',verifiedAt:'2026-08-15T09:00:00Z',value:2});assert.equal(db.fundamentalsAsOf('ABUK','2026-06-01T00:00:00Z').length,1);assert.equal(db.fundamentalsAsOf('ABUK','2026-08-16T00:00:00Z').length,2)}finally{db.close()}});
test('fundamental cannot be available before publication',()=>{const db=new EgxMarketDataStore();try{assert.throws(()=>db.appendFundamental({fundamentalId:'Fbad',ticker:'ABUK',reportPeriod:'2026-Q2',publicationDate:'2026-08-15T08:00:00Z',availableFrom:'2026-08-14T08:00:00Z',source:'EGX',verifiedAt:'2026-08-15T09:00:00Z'}),/FUNDAMENTAL_AVAILABLE_BEFORE_PUBLICATION/)}finally{db.close()}});
