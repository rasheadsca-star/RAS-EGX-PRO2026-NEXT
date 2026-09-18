'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => { try { return JSON.parse(fs.readFileSync(R(p), 'utf8')); } catch { return d; } };
const write = (p, v) => { fs.mkdirSync(path.dirname(R(p)), {recursive:true}); fs.writeFileSync(R(p), JSON.stringify(v, null, 2) + '\n', 'utf8'); };
const now = () => process.env.G11_EVALUATED_AT || new Date().toISOString();
const uniq = (xs) => [...new Set((xs || []).filter(Boolean))].sort();
const intersection = (a,b) => { const bs = new Set(b); return uniq(a.filter((x) => bs.has(x))); };

function main() {
  const closure = read('docs/astra/G11_APPROVED_SOURCE_CLOSURE_RUN.json', {});
  const sources = read('docs/astra/G11_APPROVED_SOURCE_REGISTRY.json', {});
  const v16 = read('docs/astra/G11_V16_FEATURE_READINESS.json', {});
  const issues = read('docs/astra/G11_DATA_HEALTH_ISSUES.json', {issues:[]});
  const metrics = read('docs/astra/G11_DATA_HEALTH_METRICS.json', {});
  const snapshot = read('docs/astra/G11_DATA_HEALTH_SNAPSHOT.json', {});
  const stale = read('docs/astra/G11_STALE_RECORDS.json', {records:[]});
  const pipeline = read('docs/astra/G11_CURRENT_PIPELINE_RUN.json', {});
  const gates = read('04_ACCEPTANCE_GATES.json', {});
  const state = read('05_WORK_STATE.json', {});

  const noncoverage = closure.noncoverage?.records || [];
  const invalid = closure.invalidSource?.records || [];
  const staleAudit = closure.stale?.records || [];
  const noncoverageResolved = noncoverage.filter((x) => ['RESOLVED_APPROVED_PRIMARY','RESOLVED_APPROVED_FALLBACK','SECURITY_STATUS_CHANGED','LEGITIMATE_SOURCE_SCOPE_EXCLUSION'].includes(x.finalDisposition));
  const noncoverageExternal = noncoverage.filter((x) => x.finalDisposition === 'ACTIVE_SECURITY_NO_APPROVED_CURRENT_SOURCE');
  const invalidResolved = invalid.filter((x) => x.finalDisposition === 'RESOLVED_APPROVED_FALLBACK');
  const invalidExternal = invalid.filter((x) => x.finalDisposition !== 'RESOLVED_APPROVED_FALLBACK');
  const staleResolved = staleAudit.filter((x) => ['RESOLVED_FRESH_PRIMARY','RESOLVED_FRESH_APPROVED_FALLBACK'].includes(x.finalDisposition));
  const staleLegitimate = staleAudit.filter((x) => ['LEGITIMATE_NO_TRADE','LEGITIMATE_SUSPENSION'].includes(x.finalDisposition));
  const staleExternal = staleAudit.filter((x) => x.finalDisposition === 'EXTERNAL_CURRENT_DATA_UNAVAILABLE');
  const staleInternal = staleAudit.filter((x) => x.finalDisposition === 'INTERNAL_INGESTION_DEFECT');

  const issueSets = {};
  for (const item of issues.issues || []) issueSets[item.code] = uniq(item.affectedTickers || []);
  const symbolSet = issueSets.SYMBOL_IDENTITY_UNRESOLVED || [];
  const currentSet = issueSets.CURRENT_SESSION_GAP || [];
  const regimeSet = issueSets.REGIME_INPUT_INCOMPLETE || [];
  const uniqueAffected = uniq([...symbolSet, ...currentSet, ...regimeSet]);
  const intersections = {
    symbolAndCurrent:intersection(symbolSet,currentSet),
    symbolAndRegime:intersection(symbolSet,regimeSet),
    currentAndRegime:intersection(currentSet,regimeSet),
    allThree:intersection(intersection(symbolSet,currentSet),regimeSet),
  };

  const notReady = (v16.records || []).filter((x) => !x.ready);
  const reasonGroups = {};
  for (const rec of notReady) for (const reason of rec.reasons || []) {
    if (!reasonGroups[reason]) reasonGroups[reason] = [];
    reasonGroups[reason].push(rec.ticker);
  }
  for (const key of Object.keys(reasonGroups)) reasonGroups[key] = uniq(reasonGroups[key]);

  const externalTickerSet = uniq([
    ...noncoverageExternal.map((x) => x.ticker),
    ...invalidExternal.map((x) => x.ticker),
    ...staleExternal.map((x) => x.ticker),
  ]);
  const legitimateTickerSet = new Set(staleLegitimate.map((x) => x.ticker));
  const modelDomainExceptionSet = new Set((snapshot.modelDomainExceptions || []).map((x) => x.ticker));
  const internalTickerSet = uniq([
    ...staleInternal.map((x) => x.ticker),
    ...notReady.filter((x) => !legitimateTickerSet.has(x.ticker) && !modelDomainExceptionSet.has(x.ticker) && (x.reasons || []).some((r) => /PRIMITIVE|ATR_PCT|RETURN1|AVERAGE_VOLUME|BASE_FEATURE/.test(r))).map((x) => x.ticker),
  ]);
  const gate = (gates.gates || []).find((x) => x.id === 'G11');
  const high = Number(issues.highProductionRelevantUnresolved ?? issues.highUnresolved ?? 0);
  const critical = Number(issues.criticalUnresolved || 0);
  const externalOnly = gate?.status !== 'GREEN' && critical === 0 && high > 0 && internalTickerSet.length === 0 && externalTickerSet.length > 0;
  const dependencyStatus = gate?.status === 'GREEN' ? 'GREEN' : externalOnly ? 'BLOCKED_EXTERNAL_DATA_DEPENDENCY' : 'BLOCKED_DATA_HEALTH';

  const blockers = {
    schemaVersion:'astra-g11-external-source-blockers-1', generatedAt:now(), expectedSession:closure.expectedSession,
    status:dependencyStatus,
    approvedSourcesExhausted:true,
    noncoverage:{total:noncoverage.length,resolved:noncoverageResolved.length,externalBlocked:noncoverageExternal.length,resolvedTickers:noncoverageResolved.map((x)=>x.ticker),externalBlockedTickers:noncoverageExternal.map((x)=>x.ticker),records:noncoverage},
    invalidSource:{total:invalid.length,resolved:invalidResolved.length,externalBlocked:invalidExternal.length,resolvedTickers:invalidResolved.map((x)=>x.ticker),externalBlockedTickers:invalidExternal.map((x)=>x.ticker),records:invalid},
    stale:{audited:staleAudit.length,resolved:staleResolved.length,legitimate:staleLegitimate.length,externalBlocked:staleExternal.length,internalBlocked:staleInternal.length,resolvedTickers:staleResolved.map((x)=>x.ticker),legitimateTickers:staleLegitimate.map((x)=>x.ticker),externalBlockedTickers:staleExternal.map((x)=>x.ticker),internalBlockedTickers:staleInternal.map((x)=>x.ticker),currentCertifiedStaleTickers:(stale.records||[]).map((x)=>x.ticker)},
    externalBlockedUniqueTickers:externalTickerSet,
    internalBlockedUniqueTickers:internalTickerSet,
    legitimateModelDomainExclusions:[...modelDomainExceptionSet].sort(),
    sourceApprovalsStillRequired:externalTickerSet.length ? [
      {requirement:'Provide a validation-approved expected-session OHLCV source for the listed active securities through an existing approved fallback channel (EGX official, Mubasher, reviewed approved import) OR configure the repository licensed EOD provider.',tickers:externalTickerSet,expectedSession:closure.expectedSession,requiredFields:['exact canonical symbol or verified ISIN','session date','open','high','low','close','volume','source timestamp/provenance']},
      {requirement:'If the licensed provider is selected, configure EGX_HISTORY_API_URL and the required EGX_HISTORY_API_KEY secret; do not substitute unapproved public providers.',tickers:externalTickerSet},
    ] : [],
    prohibitedWorkarounds:['previous-session carry-forward','synthetic OHLCV','legacy engine decision output','fuzzy symbol matching','random internet providers','acceptance-threshold relaxation'],
  };
  write('docs/astra/G11_EXTERNAL_SOURCE_BLOCKERS.json', blockers);

  const graph = {
    schemaVersion:'astra-g11-blocker-dependency-graph-1', generatedAt:now(),
    issueFamilyCounts:{symbolIdentity:symbolSet.length,currentSessionGap:currentSet.length,regimeInputIncomplete:regimeSet.length},
    uniqueAffectedSecurityCount:uniqueAffected.length,
    uniqueAffectedSecurities:uniqueAffected,
    intersections,
    v16ReasonSets:reasonGroups,
    nodes:uniq([
      ...externalTickerSet.map((x)=>`source:${x}`),
      ...Object.keys(reasonGroups).map((x)=>`feature:${x}`),
      'strategy:PORTFOLIO_BASKET_EQUAL_WEIGHT','regime:EGX_PRO_MARKET_REGIME_BREADTH_1.0'
    ]),
    edges:[
      ...externalTickerSet.flatMap((ticker)=>[
        {from:`source:${ticker}`,to:`feature:CURRENT_CANONICAL_${ticker}`,relation:'blocks'},
        {from:`feature:CURRENT_CANONICAL_${ticker}`,to:'strategy:PORTFOLIO_BASKET_EQUAL_WEIGHT',relation:'can_block_candidate_evaluation'},
        {from:`feature:CURRENT_CANONICAL_${ticker}`,to:'regime:EGX_PRO_MARKET_REGIME_BREADTH_1.0',relation:'reduces_cross_section'},
        {from:'strategy:PORTFOLIO_BASKET_EQUAL_WEIGHT',to:`security:${ticker}`,relation:'production_readiness'},
      ]),
      ...Object.entries(reasonGroups).flatMap(([reason,tickers])=>tickers.map((ticker)=>({from:`feature:${reason}`,to:`security:${ticker}`,relation:'not_ready'}))),
    ],
    note:'Issue-family counts overlap; they are not summed as distinct securities.'
  };
  write('docs/astra/G11_BLOCKER_DEPENDENCY_GRAPH.json', graph);

  sources.runFindings = {
    evaluatedAt:now(), approvedSourcesExhausted:true,
    externalBlockedUniqueTickers:externalTickerSet,
    licensedProviderConfigured:Boolean((sources.records||[]).find((x)=>x.sourceId==='optional_licensed_eod_provider')?.currentAvailability),
    reviewedApprovedImportRecords:Number((sources.records||[]).find((x)=>x.sourceId==='approved_reviewed_import')?.approvedRecordCount || 0),
  };
  write('docs/astra/G11_APPROVED_SOURCE_REGISTRY.json', sources);

  state.g11_external_data_closure = {
    status:dependencyStatus, evaluatedAt:now(), noncoverageResolved:noncoverageResolved.length, noncoverageExternalBlocked:noncoverageExternal.length,
    invalidResolved:invalidResolved.length, invalidExternalBlocked:invalidExternal.length,
    staleResolved:staleResolved.length, staleLegitimate:staleLegitimate.length, staleExternalBlocked:staleExternal.length, staleInternalBlocked:staleInternal.length,
    uniqueAffectedAfter:uniqueAffected.length, externalBlockedUnique:externalTickerSet.length, internalBlockedUnique:internalTickerSet.length,
    currentCanonical:metrics.currentCanonicalSecurities ? `${metrics.currentCanonicalSecurities.numerator}/${metrics.currentCanonicalSecurities.denominator}` : null,
    decisionReady:metrics.decisionPipeline ? `${metrics.decisionPipeline.pipelineReadySecurities}/${metrics.regimeInputs?.intendedUniverse || metrics.currentCanonicalSecurities?.denominator}` : null,
    regimeReady:metrics.regimeInputs ? `${metrics.regimeInputs.analyzed}/${metrics.regimeInputs.intendedUniverse}` : null,
    decisionSnapshotId:pipeline.decisionSnapshotId || null, semanticDecisionHash:pipeline.semanticDecisionHash || null,
    criticalUnresolved:critical, highProductionRelevantUnresolved:high, g12Status:'PENDING', productionCutover:false,
  };
  if (dependencyStatus === 'BLOCKED_EXTERNAL_DATA_DEPENDENCY') {
    state.current_phase = 'G11_BLOCKED_EXTERNAL_DATA_DEPENDENCY';
    state.current_gate = 'G11';
    state.last_green_gate = 'G10';
    state.next_action = 'STOP FURTHER G11 ENGINEERING. Obtain validation-approved expected-session OHLCV coverage for the tickers in docs/astra/G11_EXTERNAL_SOURCE_BLOCKERS.json or configure the approved licensed EOD provider, then rerun G11. Do not start G12 or merge to main.';
  }
  state.last_updated = now();
  write('05_WORK_STATE.json', state);
  write('docs/astra/WORK_STATE.json', state);

  const logPath = R('07_WORK_LOG.md');
  const old = fs.existsSync(logPath) ? fs.readFileSync(logPath,'utf8') : '';
  const marker = `## ${now()} — G11 Approved Source Closure`;
  if (!old.includes(marker)) fs.writeFileSync(logPath, old + `\n\n${marker}\n\n- Status: ${dependencyStatus}\n- Approved current-source inventory exhausted: yes.\n- Noncoverage resolved/external: ${noncoverageResolved.length}/${noncoverageExternal.length}.\n- Invalid-source resolved/external: ${invalidResolved.length}/${invalidExternal.length}.\n- Stale resolved/legitimate/external/internal: ${staleResolved.length}/${staleLegitimate.length}/${staleExternal.length}/${staleInternal.length}.\n- Final issue-family overlap unique affected securities: ${uniqueAffected.length}.\n- CRITICAL=${critical}; HIGH=${high}.\n- DecisionSnapshot=${pipeline.decisionSnapshotId || 'none'}; legacy-network calls=${pipeline.legacyNetworkCalls}; productionCutover=false; G12=PENDING.\n`, 'utf8');

  console.log('ASTRA_G11_EXTERNAL_FINAL ' + JSON.stringify({status:dependencyStatus,noncoverageResolved:noncoverageResolved.length,noncoverageExternal:noncoverageExternal.length,invalidResolved:invalidResolved.length,invalidExternal:invalidExternal.length,staleResolved:staleResolved.length,staleLegitimate:staleLegitimate.length,staleExternal:staleExternal.length,staleInternal:staleInternal.length,uniqueAffected:uniqueAffected.length,externalBlockedUnique:externalTickerSet.length,internalBlockedUnique:internalTickerSet.length,critical,high,current:metrics.currentCanonicalSecurities,decisionReady:metrics.decisionPipeline?.pipelineReadySecurities,regimeReady:metrics.regimeInputs?.analyzed,decisionSnapshotId:pipeline.decisionSnapshotId,hash:pipeline.semanticDecisionHash,overall:snapshot.overallStatus}));
}

main();
