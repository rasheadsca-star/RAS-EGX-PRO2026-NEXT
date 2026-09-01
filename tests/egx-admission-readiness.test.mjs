import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessEgxAdmissionReadiness} from '../src/egx-admission-readiness.js';

const report=JSON.parse(fs.readFileSync(new URL('../data/research/egx-admission-readiness-2026-09-01.json',import.meta.url),'utf8'));

test('checked-in readiness snapshot is internally valid but blocked before Phase 3 pass',()=>{
  const r=assessEgxAdmissionReadiness(report);
  assert.equal(r.state,'BLOCKED_BEFORE_PHASE3_PASS');
  assert.equal(r.invariantReady,true);
  assert.equal(r.phase3EvaluationEligible,false);
  assert.equal(r.productionAuthority,false);
  assert.equal(r.baselineAuthorized,false);
  assert.equal(r.phase4Open,false);
});

test('research progress accounts exactly for all 213 A/B/C equity-family candidates',()=>{
  const r=assessEgxAdmissionReadiness(report);
  assert.deepEqual(r.researchProgress,{
    candidateCount:213,
    identityReady:213,
    closeVolumeReconciled:204,
    noTradeEvidence:1,
    positiveVolumeTrueBarMissing:8,
    licensedProviderCapabilityReady:true
  });
  assert.equal(r.prerequisiteGates.independentIdentityReady,true);
  assert.equal(r.prerequisiteGates.sessionResearchAccountingReady,true);
});

test('current blockers are explicit and cannot be hidden by green CI',()=>{
  const r=assessEgxAdmissionReadiness(report);
  assert.deepEqual(r.readinessBlockers,[
    'CERTIFIED_EXHAUSTIVE_ELIGIBLE_UNIVERSE_MISSING',
    'ELIGIBLE_SECURITY_POLICY_NOT_CERTIFIED',
    'PRODUCTION_SESSION_AUTHORITY_MISSING',
    'PRODUCTION_TRUE_OHLCV_CURRENT_COVERAGE_INCOMPLETE',
    'LICENSED_EOD_ENTITLEMENT_AND_RAW_DATASET_RECEIPTS_MISSING',
    'CERTIFIED_HISTORICAL_OHLCV_LINEAGE_INCOMPLETE',
    'IMMUTABLE_PRODUCTION_REGISTRY_MISSING'
  ]);
  assert.equal(report.verifiedCi.pass,320);
  assert.equal(report.authoritativePhase3Status.verdict,'FAIL');
});

test('claiming common share class from Stock schedule invalidates readiness snapshot',()=>{
  const bad=structuredClone(report);
  bad.securityEligibility.stockScheduleProvesCommonShareClass=true;
  const r=assessEgxAdmissionReadiness(bad);
  assert.equal(r.state,'INVALID_READINESS_SNAPSHOT');
  assert.equal(r.invariantReasons.includes('STOCK_SCHEDULE_COMMON_SHARE_INFERENCE_FORBIDDEN'),true);
});

test('claiming licensed dataset admission without entitlement and raw receipt is rejected',()=>{
  const bad=structuredClone(report);
  bad.licensedEod.datasetAdmissionReady=true;
  const r=assessEgxAdmissionReadiness(bad);
  assert.equal(r.state,'INVALID_READINESS_SNAPSHOT');
  assert.equal(r.invariantReasons.includes('LICENSED_DATASET_READY_WITHOUT_REQUIRED_RECEIPTS'),true);
});

test('public research or synthetic OHLC cannot silently become production evidence',()=>{
  const bad=structuredClone(report);
  bad.publicResearch.productionTrueOhlcvReady=1;
  bad.publicResearch.crossProviderFieldSplicingAllowed=true;
  const r=assessEgxAdmissionReadiness(bad);
  assert.equal(r.state,'INVALID_READINESS_SNAPSHOT');
  assert.equal(r.invariantReasons.includes('PUBLIC_RESEARCH_AUTHORITY_BOUNDARY_VIOLATION'),true);
});

test('readiness blocker list must exactly reflect computed prerequisite failures',()=>{
  const bad=structuredClone(report);
  bad.readinessBlockers=bad.readinessBlockers.filter(x=>x!=='PRODUCTION_TRUE_OHLCV_CURRENT_COVERAGE_INCOMPLETE');
  const r=assessEgxAdmissionReadiness(bad);
  assert.equal(r.state,'INVALID_READINESS_SNAPSHOT');
  assert.equal(r.invariantReasons.some(x=>x.startsWith('READINESS_BLOCKERS_UNDERDECLARED:')),true);
});

test('even a hypothetical prerequisite-complete readiness object only becomes eligible for Phase 3 evaluation, never Production authority',()=>{
  const ready=structuredClone(report);
  ready.officialListingEvidence.certifiedExhaustiveEligibleUniverseReady=true;
  ready.securityEligibility.eligibleSecurityPolicyReady=true;
  ready.sessionResearchReconciliation.productionTrueOhlcvCoverageReady=true;
  ready.licensedEod.datasetAdmissionReady=true;
  ready.licensedEod.rawDatasetReceiptPresent=true;
  ready.licensedEod.licenseEntitlementReceiptPresent=true;
  ready.licensedEod.permittedApplicationUseReceiptPresent=true;
  ready.licensedEod.historicalLineageReady=true;
  ready.authoritativePhase3Status.blockers=[];
  ready.readinessBlockers=[];
  const r=assessEgxAdmissionReadiness(ready);
  assert.equal(r.state,'INVALID_READINESS_SNAPSHOT');
  assert.equal(r.productionAuthority,false);
  assert.equal(r.phase4Open,false);
  assert.equal(r.invariantReasons.includes('PHASE3_BLOCKER_MISSING:REGISTRY:MISSING'),true);
});
