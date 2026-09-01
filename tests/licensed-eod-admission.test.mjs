import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '../src/hash.js';
import {assessLicensedEodProviderCapability,assessLicensedEodDatasetCandidate} from '../src/licensed-eod-admission.js';

const capability={
  provider:'ICE',candidateSourceId:'LICENSED_EOD',providerGroup:'LICENSED_EOD_VENDOR',
  capabilityEvidence:{
    egxCoveragePublished:true,historicalAvailablePublished:true,endOfDayAvailablePublished:true,
    assetClassIncludesEquities:true,aggregatedOhlcBarsPublished:true,endOfDayOhlcBarsPublished:true
  }
};
const license={provider:'ICE',entitlementConfirmed:true,permittedApplicationUseConfirmed:true,licenseReceiptHash:'a'.repeat(64)};
const rawPayload=JSON.stringify({session:'2026-08-31',rows:[{isin:'EGS1',open:10,high:12,low:9,close:11,volume:100}]});
const receipt={
  sourceId:'LICENSED_EOD',sourceClass:'LICENSED_EOD',providerGroup:'LICENSED_EOD_VENDOR',
  sourceUrl:'https://example-data.ice.com/egx/eod/2026-08-31',capturedAt:'2026-09-01T06:00:00Z',
  session:'2026-08-31',provenanceKind:'API_RAW_JSON',contentHash:sha256(rawPayload)
};
const independent={sourceId:'MUBASHER',sourceClass:'PUBLIC_MARKET',providerGroup:'MUBASHER',sourceUrl:'https://english.mubasher.info/markets/EGX',capturedAt:'2026-09-01T06:01:00Z',session:'2026-08-31',provenanceKind:'RAW_CSV',contentHash:'b'.repeat(64)};
const bars=[{id:'EGS1',session:'2026-08-31',open:10,high:12,low:9,close:11,volume:100}];

test('published ICE EGX OHLC/EOD capability remains capability-only and never grants production authority',()=>{
  const r=assessLicensedEodProviderCapability(capability);
  assert.equal(r.state,'CAPABILITY_READY_DATASET_NOT_ADMITTED');
  assert.equal(r.capabilityReady,true);
  assert.equal(r.datasetReceiptReady,false);
  assert.equal(r.downstreamLineageEligible,false);
  assert.equal(r.productionAuthority,false);
});

test('provider capability is blocked when EGX or true OHLC capability is not documented',()=>{
  const r=assessLicensedEodProviderCapability({...capability,capabilityEvidence:{...capability.capabilityEvidence,egxCoveragePublished:false,aggregatedOhlcBarsPublished:false}});
  assert.equal(r.state,'CAPABILITY_BLOCKED');
  assert.equal(r.reasons.includes('EGX_COVERAGE_NOT_PUBLISHED'),true);
  assert.equal(r.reasons.includes('TRUE_OHLC_CAPABILITY_NOT_PUBLISHED'),true);
});

test('catalog capability cannot substitute for an actual raw licensed dataset receipt',()=>{
  const r=assessLicensedEodDatasetCandidate({capabilityEvidence:capability,licenseEvidence:license,session:'2026-08-31',expectedTradeBarIds:['EGS1'],bars,parserId:'ice-eod-v1',parserVersion:'1',fieldSemanticsVerified:true,independentCrossCheckReceipt:independent});
  assert.equal(r.state,'BLOCKED');
  assert.equal(r.reasons.includes('DATASET_RECEIPT_REQUIRED'),true);
  assert.equal(r.productionAuthority,false);
});

test('valid-looking raw dataset is blocked without hashed entitlement/use-rights evidence',()=>{
  const r=assessLicensedEodDatasetCandidate({capabilityEvidence:capability,datasetReceipt:receipt,rawPayload,session:'2026-08-31',expectedTradeBarIds:['EGS1'],bars,parserId:'ice-eod-v1',parserVersion:'1',fieldSemanticsVerified:true,independentCrossCheckReceipt:independent});
  assert.equal(r.state,'BLOCKED');
  assert.equal(r.reasons.includes('LICENSE_ENTITLEMENT_EVIDENCE_REQUIRED'),true);
});

test('non-raw licensed source evidence is rejected even with a matching content hash',()=>{
  const badReceipt={...receipt,provenanceKind:'SEARCH_RESULT'};
  const r=assessLicensedEodDatasetCandidate({capabilityEvidence:capability,licenseEvidence:license,datasetReceipt:badReceipt,rawPayload,session:'2026-08-31',expectedTradeBarIds:['EGS1'],bars,parserId:'ice-eod-v1',parserVersion:'1',fieldSemanticsVerified:true,independentCrossCheckReceipt:independent});
  assert.equal(r.state,'BLOCKED');
  assert.equal(r.reasons.some(x=>x.includes('NON_RAW_EVIDENCE_KIND')),true);
});

test('session or exact traded-universe mismatch blocks licensed dataset admission',()=>{
  const r=assessLicensedEodDatasetCandidate({capabilityEvidence:capability,licenseEvidence:license,datasetReceipt:receipt,rawPayload,session:'2026-08-30',expectedTradeBarIds:['EGS1','EGS2'],bars,parserId:'ice-eod-v1',parserVersion:'1',fieldSemanticsVerified:true,independentCrossCheckReceipt:independent});
  assert.equal(r.state,'BLOCKED');
  assert.equal(r.reasons.includes('DATASET_SESSION_MISMATCH'),true);
  assert.equal(r.reasons.includes('BAR_SESSION_MISMATCH'),true);
  assert.equal(r.reasons.includes('TRADE_BAR_COVERAGE_MISSING'),true);
});

test('same-provider cross-check cannot satisfy independent licensed dataset reconciliation',()=>{
  const sameProvider={...independent,providerGroup:'LICENSED_EOD_VENDOR'};
  const r=assessLicensedEodDatasetCandidate({capabilityEvidence:capability,licenseEvidence:license,datasetReceipt:receipt,rawPayload,session:'2026-08-31',expectedTradeBarIds:['EGS1'],bars,parserId:'ice-eod-v1',parserVersion:'1',fieldSemanticsVerified:true,independentCrossCheckReceipt:sameProvider});
  assert.equal(r.state,'BLOCKED');
  assert.equal(r.reasons.includes('INDEPENDENCE:SAME_PROVIDER_GROUP'),true);
});

test('fully evidenced licensed dataset only becomes eligible for downstream lineage, never direct Production authority',()=>{
  const r=assessLicensedEodDatasetCandidate({capabilityEvidence:capability,licenseEvidence:license,datasetReceipt:receipt,rawPayload,session:'2026-08-31',expectedTradeBarIds:['EGS1'],bars,parserId:'ice-eod-v1',parserVersion:'1',fieldSemanticsVerified:true,independentCrossCheckReceipt:independent});
  assert.equal(r.state,'READY_FOR_DOWNSTREAM_HISTORICAL_LINEAGE');
  assert.equal(r.candidateReady,true);
  assert.equal(r.datasetReceiptReady,true);
  assert.equal(r.exactTradeBarCoverageReady,true);
  assert.equal(r.independentCrossCheckReady,true);
  assert.equal(r.downstreamLineageEligible,true);
  assert.equal(r.productionAuthority,false);
  assert.equal(r.phase4Open,false);
});
