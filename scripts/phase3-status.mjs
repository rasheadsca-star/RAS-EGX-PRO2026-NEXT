import fs from'node:fs';import path from'node:path';import{adaptEgxNewsRecord}from'../src/egx-official-adapter.js';import{buildAuthoritativeUniverse}from'../src/universe-authority.js';import{evaluatePhase3Gate}from'../src/phase3-gate.js';import{issueBaselineAuthorization}from'../src/phase-transition.js';import{sha256}from'../src/hash.js';
const root=process.cwd();
const fixture=JSON.parse(fs.readFileSync(path.join(root,'evidence/official/egx-beta-identity-sample-2026-08-31.json'),'utf8'));
const discoveryPath=path.join(root,'evidence/official/source-discovery-status.json');
const discovery=fs.existsSync(discoveryPath)?JSON.parse(fs.readFileSync(discoveryPath,'utf8')):null;
const adapted=fixture.records.map(r=>adaptEgxNewsRecord(r,{sourceId:fixture.source.id}));
const identityEvidence=adapted.filter(x=>x.state==='READY').map(x=>x.evidence);
const ignored=adapted.filter(x=>x.state==='IGNORED_NON_EQUITY').length;
const universe=buildAuthoritativeUniverse(identityEvidence,{asOfDate:fixture.asOfDate,requireSnapshot:true});
const gate=evaluatePhase3Gate({universe,registry:null,sessionAuthority:null,acquisitionPlans:[],sourceReceipts:[]});
const phase4Authorization=issueBaselineAuthorization({state:'FAIL',session:fixture.asOfDate,calendarVersion:null,universeVersion:universe.version,registryVersion:null,reportHash:null,phase3:gate});
const report={
  schemaVersion:'egx-one-phase3-status-4',
  generatedFrom:'reproducible_checked_in_official_identity_sample',
  asOfDate:fixture.asOfDate,
  policy:{sourceReceiptsRequired:true,independentProviderCrossCheckRequired:true,searchSnippetsMayBeAuthoritativeRawEvidence:false,unverifiedBulletinContentMayAuthorizeBaseline:false,officialInclusionEvidenceRequiresReceiptScopeAndUniverseCertificate:true,currentSessionBarsRequireMarketObservationCertificates:true,productionSsotRequiresCertifiedReconciliation:true},
  officialEvidence:{source:fixture.source,identityEquities:identityEvidence.length,ignoredNonEquity:ignored,exhaustive:fixture.exhaustive,evidenceHash:sha256(fixture)},
  sourceDiscovery:discovery?{state:discovery.state,officialDirectPage:discovery.officialDirectPage,bulletinDiscovery:discovery.bulletinDiscovery,discoveryHash:sha256(discovery)}:{state:'NOT_RECORDED'},
  sourceProvenance:{
    state:'NOT_EVALUATED_UNTIL_EXHAUSTIVE_UNIVERSE_AND_CURRENT_SESSION',
    requiredRuntimeProofs:['PRIMARY_AUTHORITATIVE_RECEIPT','PRIMARY_MARKET_OBSERVATION_CERTIFICATE','INDEPENDENT_CROSSCHECK_RECEIPT','INDEPENDENT_CROSSCHECK_MARKET_OBSERVATION_CERTIFICATE','CERTIFIED_PRODUCTION_RECONCILIATION_MANIFEST'],
    requiredUniverseProofs:['OFFICIAL_SOURCE_RECEIPT_HASH','OFFICIAL_DOCUMENT_SCOPE_PROOF_HASH','UNIVERSE_EXTRACTION_CERTIFICATE_HASH'],
    requiredSsotProofs:['CERTIFIED_PRODUCTION_SOURCE_MANIFEST','CERTIFIED_RECONCILIATION_MANIFEST_HASH','PRIMARY_OBSERVATION_CERTIFICATE_HASH']
  },
  universe:{state:universe.state,reasons:universe.reasons,total:universe.total},
  phase3:{verdict:gate.verdict,baselineAuthorized:gate.baselineAuthorized,blockers:gate.blockers},
  phase4:{state:'LOCKED',authorizationState:phase4Authorization.state,authorizationToken:phase4Authorization.authorizationToken,reasons:phase4Authorization.reasons},
  interpretation:'Architecture and contracts may pass CI while operational Phase 3 remains FAIL. Identity/disclosure evidence is intentionally insufficient. Phase 4 is machine-locked until an exhaustive receipt-, scope-, and certificate-bound official EGX equity universe, versioned session authority, authoritative post-close current-session observations with independent certified cross-checks, and a CERTIFIED_PRODUCTION reconciliation manifest persisted into the SSOT all pass.'
};
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/phase3-current-status.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
