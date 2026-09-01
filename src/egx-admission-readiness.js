const norm=v=>String(v??'').trim();
const uniq=a=>[...new Set(a)];

export const EGX_ADMISSION_READINESS_SCHEMA='egx-admission-readiness-1';

export function assessEgxAdmissionReadiness(report={}){
  const reasons=[];
  if(report?.schemaVersion!==EGX_ADMISSION_READINESS_SCHEMA) reasons.push('SCHEMA_VERSION_MISMATCH');
  if(report?.authorityMode!=='RESEARCH_READINESS_ONLY') reasons.push('AUTHORITY_MODE_NOT_RESEARCH_READINESS_ONLY');
  if(report?.productionAuthority!==false) reasons.push('PRODUCTION_AUTHORITY_MUST_BE_FALSE');
  if(report?.baselineAuthorized!==false) reasons.push('BASELINE_AUTHORIZED_MUST_BE_FALSE');
  if(report?.phase4Open!==false) reasons.push('PHASE4_MUST_BE_FALSE');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(norm(report?.asOfSession))) reasons.push('SESSION_REQUIRED');

  const ci=report?.verifiedCi??{};
  if(!(Number(ci.tests)>0&&Number(ci.tests)===Number(ci.pass)&&Number(ci.fail)===0)) reasons.push('VERIFIED_CI_NOT_GREEN');

  const listing=report?.officialListingEvidence??{};
  if(Number(listing.stockInfoRows)!==262) reasons.push('STOCK_INFO_ROW_COUNT_CHANGED');
  if(Number(listing.egyptianEquityFamilyRows)!==256) reasons.push('EQUITY_FAMILY_ROW_COUNT_CHANGED');
  if(Number(listing.abcTradableBoardEquityFamilyCandidates)!==213) reasons.push('ABC_EQUITY_FAMILY_COUNT_CHANGED');
  if(Number(listing.temporaryListingsConfirmed)!==28) reasons.push('TEMPORARY_LISTING_COUNT_CHANGED');
  if(listing.officialResultSetReady!==true) reasons.push('OFFICIAL_RESULT_SET_NOT_READY');

  const identity=report?.identity??{};
  const identityReady=Number(identity.candidateCount)>0&&Number(identity.candidateCount)===Number(identity.independentlyReconciled)&&Number(identity.unresolved)===0&&identity.ready===true;
  if(!identityReady) reasons.push('INDEPENDENT_IDENTITY_NOT_COMPLETE');

  const security=report?.securityEligibility??{};
  if(security.stockScheduleProvesCommonShareClass!==false) reasons.push('STOCK_SCHEDULE_COMMON_SHARE_INFERENCE_FORBIDDEN');
  const preferred=Array.isArray(security.preferredConfirmed)?security.preferredConfirmed:[];
  if(!preferred.some(x=>norm(x?.ticker).toUpperCase()==='CCAPP'&&norm(x?.isin).toUpperCase()==='EGS73541P048')) reasons.push('CCAPP_PREFERRED_EVIDENCE_MISSING');

  const session=report?.sessionResearchReconciliation??{};
  const candidateCount=Number(session.candidateCount),cv=Number(session.independentCloseVolumeRows),noTrade=Number(session.noTradeSessionEvidence),missing=Number(session.positiveVolumeTrueBarMissing);
  const accountingReady=candidateCount>0&&cv+noTrade+missing===candidateCount&&Number(session.accountedCandidates)===candidateCount&&session.candidateAccountingExact===true;
  if(!accountingReady) reasons.push('SESSION_CANDIDATE_ACCOUNTING_NOT_EXACT');
  if(Number(session.independentClosePrecisionCompatible)!==cv||Number(session.independentVolumeExact)!==cv) reasons.push('CLOSE_VOLUME_RECONCILIATION_COUNT_MISMATCH');
  if(Number(session.productionTrueOhlcvRowsAdmitted)!==0) reasons.push('UNEXPECTED_PRODUCTION_TRUE_OHLCV_ADMISSION');

  const semantics=report?.officialMarketDataSemantics??{};
  if(semantics.marketWatchScopeUsable!==false) reasons.push('INCOHERENT_MARKET_WATCH_SCOPE_MUST_REMAIN_BLOCKED');
  if(semantics.priceVolumePointsTrueOhlcvEligible!==false) reasons.push('PRICE_VOLUME_POINTS_TRUE_OHLCV_FORBIDDEN');
  if(semantics.syntheticFrontendOhlcRejected!==true) reasons.push('SYNTHETIC_FRONTEND_OHLC_REJECTION_REQUIRED');

  const publicResearch=report?.publicResearch??{};
  if(Number(publicResearch.productionTrueOhlcvReady)!==0||publicResearch.rawProductionAuthority!==false||publicResearch.crossProviderFieldSplicingAllowed!==false) reasons.push('PUBLIC_RESEARCH_AUTHORITY_BOUNDARY_VIOLATION');

  const licensed=report?.licensedEod??{};
  const capabilityReady=licensed.providerCapabilityReady===true&&licensed.egxCapabilityPublished===true&&licensed.historicalEodOhlcCapabilityPublished===true;
  if(!capabilityReady) reasons.push('LICENSED_EOD_CAPABILITY_NOT_READY');
  if(licensed.datasetAdmissionReady===true&&(licensed.rawDatasetReceiptPresent!==true||licensed.licenseEntitlementReceiptPresent!==true||licensed.permittedApplicationUseReceiptPresent!==true)) reasons.push('LICENSED_DATASET_READY_WITHOUT_REQUIRED_RECEIPTS');

  const phase3=report?.authoritativePhase3Status??{};
  if(phase3.verdict!=='FAIL') reasons.push('CHECKED_IN_READINESS_SNAPSHOT_MUST_NOT_CLAIM_PHASE3_PASS');
  const actualBlockers=Array.isArray(phase3.blockers)?phase3.blockers:[];
  for(const required of ['REGISTRY:MISSING','SESSION_AUTHORITY:MISSING','UNIVERSE:UNIVERSE_INCOMPLETE']) if(!actualBlockers.includes(required)) reasons.push(`PHASE3_BLOCKER_MISSING:${required}`);

  const prerequisiteGates=Object.freeze({
    independentIdentityReady:identityReady,
    sessionResearchAccountingReady:accountingReady,
    officialEligibleUniverseCertified:listing.certifiedExhaustiveEligibleUniverseReady===true,
    eligibleSecurityPolicyReady:security.eligibleSecurityPolicyReady===true,
    productionSessionAuthorityReady:actualBlockers.includes('SESSION_AUTHORITY:MISSING')===false,
    productionTrueOhlcvCurrentCoverageReady:session.productionTrueOhlcvCoverageReady===true,
    licensedEodDatasetAdmissionReady:licensed.datasetAdmissionReady===true,
    certifiedHistoricalLineageReady:licensed.historicalLineageReady===true,
    immutableProductionRegistryReady:actualBlockers.includes('REGISTRY:MISSING')===false
  });
  const phase3EvaluationEligible=Object.values(prerequisiteGates).every(Boolean);
  const readinessBlockers=[];
  if(!prerequisiteGates.officialEligibleUniverseCertified) readinessBlockers.push('CERTIFIED_EXHAUSTIVE_ELIGIBLE_UNIVERSE_MISSING');
  if(!prerequisiteGates.eligibleSecurityPolicyReady) readinessBlockers.push('ELIGIBLE_SECURITY_POLICY_NOT_CERTIFIED');
  if(!prerequisiteGates.productionSessionAuthorityReady) readinessBlockers.push('PRODUCTION_SESSION_AUTHORITY_MISSING');
  if(!prerequisiteGates.productionTrueOhlcvCurrentCoverageReady) readinessBlockers.push('PRODUCTION_TRUE_OHLCV_CURRENT_COVERAGE_INCOMPLETE');
  if(!prerequisiteGates.licensedEodDatasetAdmissionReady) readinessBlockers.push('LICENSED_EOD_ENTITLEMENT_AND_RAW_DATASET_RECEIPTS_MISSING');
  if(!prerequisiteGates.certifiedHistoricalLineageReady) readinessBlockers.push('CERTIFIED_HISTORICAL_OHLCV_LINEAGE_INCOMPLETE');
  if(!prerequisiteGates.immutableProductionRegistryReady) readinessBlockers.push('IMMUTABLE_PRODUCTION_REGISTRY_MISSING');

  const declared=Array.isArray(report?.readinessBlockers)?report.readinessBlockers:[];
  const missingDeclared=readinessBlockers.filter(x=>!declared.includes(x));
  const unexpectedDeclared=declared.filter(x=>!readinessBlockers.includes(x));
  if(missingDeclared.length) reasons.push(`READINESS_BLOCKERS_UNDERDECLARED:${missingDeclared.join(',')}`);
  if(unexpectedDeclared.length) reasons.push(`READINESS_BLOCKERS_STALE:${unexpectedDeclared.join(',')}`);

  const invariantReady=reasons.length===0;
  return Object.freeze({
    schemaVersion:EGX_ADMISSION_READINESS_SCHEMA,
    state:!invariantReady?'INVALID_READINESS_SNAPSHOT':phase3EvaluationEligible?'ELIGIBLE_FOR_PHASE3_GATE_EVALUATION':'BLOCKED_BEFORE_PHASE3_PASS',
    invariantReady,
    phase3EvaluationEligible,
    prerequisiteGates,
    readinessBlockers:Object.freeze(readinessBlockers),
    invariantReasons:Object.freeze(uniq(reasons)),
    researchProgress:Object.freeze({
      candidateCount,
      identityReady:Number(identity.independentlyReconciled),
      closeVolumeReconciled:cv,
      noTradeEvidence:noTrade,
      positiveVolumeTrueBarMissing:missing,
      licensedProviderCapabilityReady:capabilityReady
    }),
    productionAuthority:false,
    baselineAuthorized:false,
    phase4Open:false
  });
}
