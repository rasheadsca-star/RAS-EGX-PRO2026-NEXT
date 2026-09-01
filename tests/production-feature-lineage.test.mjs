import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/hash.js';
import { createHistoricalObservationLineage } from '../src/historical-observation-lineage.js';
import { buildProductionFeatureInputLineage, validateFeatureBundle } from '../src/feature-bundle-gate.js';

const SIGNAL='2026-08-31';
const SNAP='prod-feature-snapshot';
const NORMALIZED=sha256('normalized-production-snapshot');
const CURRENT_CERT=sha256('current-market-observation-certificate');

function historical(session,close){
  const bar={ticker:'VERT',session,open:close-0.2,high:close+0.4,low:close-0.5,close,volume:100000};
  const raw={...bar,kind:'official-eod'};
  const receipt={sourceId:'OFFICIAL_EGX',sourceClass:'OFFICIAL_EXCHANGE',providerGroup:'EGX',sourceUrl:'https://beta.egx.com.eg/downloads/history.csv',session,capturedAt:`${session}T15:00:00Z`,provenanceKind:'DIRECT_FILE',contentHash:sha256(raw)};
  return createHistoricalObservationLineage({dataSnapshotId:SNAP,bar,receipt,rawPayload:raw,parserId:'egx-eod-csv',parserVersion:'1'});
}

const c27=historical('2026-08-27',10.1);
const c28=historical('2026-08-28',10.5);
const required=['2026-08-27','2026-08-28'];

function productionInput(certs=[c27,c28],sessions=required){
  return buildProductionFeatureInputLineage({ticker:'VERT',signalSession:SIGNAL,productionSnapshotId:SNAP,normalizedDataVersion:NORMALIZED,currentObservationCertificateHash:CURRENT_CERT,requiredHistorySessions:sessions,historicalLineageCertificates:certs});
}

function group(name,inputHash,extra={}){
  return {name,state:'READY',asOfSession:SIGNAL,availableAt:'2026-08-31T14:45:00+03:00',sourceVersion:['TECHNICAL','LIQUIDITY'].includes(name)?NORMALIZED:`src-${name}`,featureVersion:`feat-${name}`,payloadHash:sha256({name,payload:'fixed'}),inputLineageHash:['TECHNICAL','LIQUIDITY'].includes(name)?inputHash:null,...extra};
}

function context(lineage){
  return {signalSession:SIGNAL,decisionCutoff:'2026-08-31T15:00:00+03:00',authorityMode:'CERTIFIED_PRODUCTION',ticker:'VERT',productionSnapshotId:SNAP,normalizedDataVersion:NORMALIZED,currentObservationCertificateHash:CURRENT_CERT,requiredHistorySessions:required,historicalLineageCertificates:[c27,c28]};
}

test('production feature input lineage is deterministic and requires exact certified historical coverage',()=>{
  const a=productionInput();
  const b=productionInput([c28,c27],['2026-08-28','2026-08-27']);
  assert.equal(a.state,'READY');
  assert.equal(a.inputLineageHash,b.inputLineageHash);
  assert.equal(a.historicalLineageManifestHash,b.historicalLineageManifestHash);
});

test('missing or extra historical certificate coverage blocks production feature input lineage',()=>{
  const missing=productionInput([c28]);
  assert.equal(missing.state,'BLOCKED');
  assert.ok(missing.reasons.includes('PRODUCTION_FEATURE_HISTORY_COVERAGE_MISMATCH'));
  const extra=historical('2026-08-26',9.9);
  const surplus=productionInput([c27,c28,extra]);
  assert.equal(surplus.state,'BLOCKED');
  assert.ok(surplus.reasons.includes('PRODUCTION_FEATURE_HISTORY_COVERAGE_MISMATCH'));
});

test('certified production feature bundle is ready only when market-derived groups bind exact input lineage',()=>{
  const lineage=productionInput();
  const r=validateFeatureBundle({groups:[group('TECHNICAL',lineage.inputLineageHash),group('LIQUIDITY',lineage.inputLineageHash),group('CORPORATE_ACTIONS',null)]},context(lineage));
  assert.equal(r.state,'READY');
  assert.equal(r.productionLineage.inputLineageHash,lineage.inputLineageHash);
  assert.equal(r.manifest.productionInputLineageHash,lineage.inputLineageHash);
});

test('production feature cannot detach from normalized snapshot or certified lineage',()=>{
  const lineage=productionInput();
  const wrong=sha256('different-input-lineage');
  const r=validateFeatureBundle({groups:[group('TECHNICAL',wrong),group('LIQUIDITY',lineage.inputLineageHash,{sourceVersion:sha256('other-snapshot')}),group('CORPORATE_ACTIONS',null)]},context(lineage));
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.includes('TECHNICAL:PRODUCTION_INPUT_LINEAGE_MISMATCH'));
  assert.ok(r.reasons.includes('LIQUIDITY:PRODUCTION_SOURCE_VERSION_MISMATCH'));
});

test('production feature payload hash and history session declaration are mandatory',()=>{
  const lineage=productionInput();
  const noPayload=validateFeatureBundle({groups:[group('TECHNICAL',lineage.inputLineageHash,{payloadHash:null}),group('LIQUIDITY',lineage.inputLineageHash),group('CORPORATE_ACTIONS',null)]},context(lineage));
  assert.equal(noPayload.state,'BLOCKED');
  assert.ok(noPayload.reasons.includes('TECHNICAL:PRODUCTION_PAYLOAD_HASH_REQUIRED'));
  const noHistory=validateFeatureBundle({groups:[group('TECHNICAL',lineage.inputLineageHash),group('LIQUIDITY',lineage.inputLineageHash),group('CORPORATE_ACTIONS',null)]},{...context(lineage),requiredHistorySessions:[],historicalLineageCertificates:[]});
  assert.equal(noHistory.state,'BLOCKED');
  assert.ok(noHistory.reasons.includes('PRODUCTION_FEATURE_HISTORY_SESSIONS_REQUIRED'));
});
