#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch (error) { if (fallback !== null) return fallback; throw new Error(`Cannot read ${rel}: ${error.message}`); } };
const writeAtomic = (rel, value) => { const file=P(rel); fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.tmp`; fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,'utf8'); JSON.parse(fs.readFileSync(tmp,'utf8')); fs.renameSync(tmp,file); };
const finite = value => Number.isFinite(Number(value));
const positive = value => finite(value) && Number(value) > 0;
const sym = value => String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
const indexBy = (rows, key='symbol') => new Map((Array.isArray(rows)?rows:[]).map(row=>[sym(row?.[key] ?? row?.ticker),row]).filter(([s])=>s));
const insufficientTechnicalSignal = value => /تاريخ\s+غير\s+كاف/u.test(String(value || ''));

const recs = read('data/recommendations.json');
const recStatus = read('data/v17/current-recommendation-base-status.json', {});
const technicalReport = read('data/technical-50-report.json', {});
const liquidity = read('data/v17/liquidity-gate.json');
const sr = read('data/v17/internal-ohlc-support-resistance.json');
const resilient = read('data/v17/resilient-session-status.json');
const sessionTruth = read('data/v17/market-session-truth.json');
const explorer = read('data/v20/market-explorer.json');
const sync = read('data/v20/v17-runtime-sync.json', {});

const sessionDate = sessionTruth.selectedSessionDate || resilient.sessionDate || recs.sessionDate || explorer.sessionDate;
if (!sessionDate) throw new Error('Cannot establish authoritative V17 session date');
if (recs.sessionDate !== sessionDate) throw new Error(`V17 recommendation/session mismatch: ${recs.sessionDate} vs ${sessionDate}`);
if (technicalReport.referenceSessionDate !== sessionDate) throw new Error(`V17 technical/session mismatch: ${technicalReport.referenceSessionDate} vs ${sessionDate}`);
if (liquidity.referenceSessionDate !== sessionDate || sr.referenceSessionDate !== sessionDate) throw new Error('V17 liquidity/SR session is not aligned to authoritative session');
if (recs.engine !== 'V17_CURRENT_SESSION_TECHNICAL_BASE_1') throw new Error(`Unexpected V17 recommendation engine ${recs.engine}`);
if (recs.policy?.newTradingFormulaIntroduced !== false || recs.policy?.technical50MethodologyReused !== true) throw new Error('V17 recommendation methodology contract drift');
if (technicalReport.version !== '5.6.1-v17-session-truth') throw new Error(`Unexpected V17 technical report version ${technicalReport.version}`);

const recMap = indexBy(recs.all || []);
const technicalMap = indexBy(technicalReport.symbols || []);
const liqMap = indexBy(liquidity.rows || []);
const srMap = indexBy(sr.rows || []);
const criticalConflictMap = new Map();
for (const conflict of (sr.allSourceConflicts || sr.sourceConflicts || [])) {
  if (conflict?.critical !== true) continue;
  const s=sym(conflict.symbol); if (!s) continue;
  if (!criticalConflictMap.has(s)) criticalConflictMap.set(s, []);
  criticalConflictMap.get(s).push({source:conflict.source||null,state:conflict.state||null,maxDiffPct:finite(conflict.maxDiffPct)?Number(conflict.maxDiffPct):null});
}
const missingSr = new Set((sr.allMissingSymbols || sr.missingSymbols || []).map(sym));
const topBuyRows = Array.isArray(recs.topBuyCandidates) ? recs.topBuyCandidates : (recs.all || []).filter(row => !/(بيع|خروج|مخاطر|مرتفع التذبذب)/u.test(String(row?.signal || row?.recommendation || ''))).slice(0, 30);
const topBuySet = new Set(topBuyRows.map(row=>sym(row.symbol || row.ticker)).filter(Boolean));

const srMinConfidence = Number(sr?.thresholds?.minimumConfidence ?? 0.8);
const globalExecutionGrade = resilient.executionGrade === true;
const globalGateStatus = resilient.status || resilient.mode || null;
const sourceSessionVerified = sessionTruth.executionSafe === true && sr.sourceSessionVerified === true && liquidity.sourceSessionVerified === true;
const v17TechnicalMinimumSessions = 10; // Exact semantic boundary used by build-v56-technical-report.js before it stops emitting "تاريخ غير كافٍ".

const universeRows = Array.isArray(explorer.rows) ? explorer.rows : [];
const rows = universeRows.map(base => {
  const ticker = sym(base.ticker);
  const rec = recMap.get(ticker) || null;
  const technical = technicalMap.get(ticker) || null;
  const liq = liqMap.get(ticker) || null;
  const srRow = srMap.get(ticker) || null;
  const conflicts = criticalConflictMap.get(ticker) || [];
  const blockers = [];

  const criticalPriceFieldsReady = !!rec && rec.sessionDate === sessionDate && positive(rec.price ?? rec.last) && finite(rec.open) && finite(rec.high) && finite(rec.low) && finite(rec.volume) && finite(rec.valueTraded ?? rec.turnover) && Number(rec.high) >= Number(rec.low);
  const v17DataEligible = criticalPriceFieldsReady && sourceSessionVerified;
  if (!rec || rec.sessionDate !== sessionDate) blockers.push('STALE_DATA');
  else if (!criticalPriceFieldsReady) blockers.push('MISSING_CRITICAL_FIELDS');
  if (!sourceSessionVerified) blockers.push('SESSION_NOT_ALIGNED');

  const v17LiquidityEligible = liq?.executionLiquidityOk === true && liq?.evidenceAvailable === true;
  if (!v17LiquidityEligible) blockers.push('LOW_LIQUIDITY');

  // Preserve the exact V17 Technical-50 semantics instead of requiring invented fields.
  // rebuild-current-recommendation-base only emits a recommendation row when a current Technical-50 row exists.
  // build-v56-technical-report explicitly labels <10 trusted sessions as "تاريخ غير كافٍ".
  const technicalHistorySessions = finite(rec?.historySessions) ? Number(rec.historySessions) : (finite(technical?.points) ? Number(technical.points) : null);
  const technicalSignal = String(rec?.signal ?? technical?.signal ?? '');
  const v17TechnicalSourceEligible = !!rec && !!technical && rec.sessionDate === sessionDate && technical.lastDate === sessionDate && finite(rec.technicalScore) && finite(rec.finalConfidence);
  const v17TechnicalProductionReady = v17TechnicalSourceEligible && technicalHistorySessions >= v17TechnicalMinimumSessions && !insufficientTechnicalSignal(technicalSignal);
  const v17TechnicalEligible = v17TechnicalProductionReady;
  if (!v17TechnicalSourceEligible) blockers.push('TECHNICAL_SOURCE_NOT_CURRENT');
  else if (!v17TechnicalProductionReady) blockers.push('INSUFFICIENT_TECHNICAL_HISTORY');

  const srCurrent = !!srRow && srRow.sessionDate === sessionDate && srRow.freshness === 'LATEST_COMPLETED_SESSION';
  const srConfidenceOk = !!srRow && finite(srRow.confidence) && Number(srRow.confidence) >= srMinConfidence;
  const v17SrSourceEligible = srRow?.executionEligible === true; // Exact per-row V17 source flag.
  const v17SrProductionReady = v17SrSourceEligible && srCurrent && srConfidenceOk && conflicts.length === 0;
  const v17SrEligible = v17SrProductionReady;
  const v17SrGlobalExecutionReady = sr.executionCandidateReady === true;
  if (!srRow || missingSr.has(ticker)) blockers.push('MISSING_SR');
  else if (!v17SrSourceEligible) {
    if (!srCurrent) blockers.push('STALE_DATA');
    if (!srConfidenceOk) blockers.push('SR_LOW_CONFIDENCE');
    if (srCurrent && srConfidenceOk) blockers.push('SR_NOT_EXECUTION_ELIGIBLE');
  }
  if (conflicts.length) blockers.push('CRITICAL_SOURCE_CONFLICT');

  const v17SourceConfidenceReady = sourceSessionVerified && conflicts.length === 0;
  const v17PriceEligible = !!rec && rec.sessionDate === sessionDate && positive(rec.price ?? rec.last) && base.currentSessionAvailable === true && positive(base.price);
  if (!v17PriceEligible) blockers.push('PRICE_UNTRUSTED');

  // No authoritative V17 per-symbol corporate-action feed was found in the audited V17 branch.
  // Unknown stays unknown and can never be silently promoted to execution-safe.
  const v17CorporateActionSafe = null;
  const corporateActionState = 'NOT_AVAILABLE_IN_AUTHORITATIVE_V17_ARTIFACTS';

  const v17SelectionCandidate = topBuySet.has(ticker);
  const v17RecommendationEligible = v17SelectionCandidate && v17DataEligible && v17LiquidityEligible && v17TechnicalEligible && v17SrEligible && v17SourceConfidenceReady && v17PriceEligible;
  if (!v17SelectionCandidate) blockers.push('V17_RECOMMENDATION_FILTER');

  const v17ExecutionEligible = v17RecommendationEligible && globalExecutionGrade && v17SrGlobalExecutionReady && v17CorporateActionSafe === true;
  if (!v17SrGlobalExecutionReady) blockers.push('V17_SR_GLOBAL_EXECUTION_NOT_READY');
  if (!globalExecutionGrade) blockers.push('EXECUTION_GATE_CLOSED');
  if (v17CorporateActionSafe !== true) blockers.push('CORPORATE_ACTION_STATUS_UNAVAILABLE');

  return {
    ticker,
    companyName: base.nameAr || base.nameEn || rec?.name_ar || rec?.name_en || ticker,
    marketSessionDate: sessionDate,
    v17RecommendationEngine: recs.engine,
    v17RecommendationScore: finite(rec?.finalConfidence) ? Number(rec.finalConfidence) : null,
    v17SelectionCandidate,
    v17DataEligible,
    v17LiquidityEligible,
    v17TechnicalSourceEligible,
    v17TechnicalProductionReady,
    v17TechnicalEligible,
    v17SrSourceEligible,
    v17SrProductionReady,
    v17SrEligible,
    v17SrGlobalExecutionReady,
    v17SourceConfidenceReady,
    v17CorporateActionSafe,
    corporateActionState,
    v17PriceEligible,
    v17RecommendationEligible,
    v17ExecutionEligible,
    v17Blockers: [...new Set(blockers)],
    evidence: {
      recommendationPresent: !!rec,
      recommendationSessionDate: rec?.sessionDate || null,
      dataQualityScore: finite(rec?.dataQualityScore) ? Number(rec.dataQualityScore) : null,
      technicalReportVersion: technicalReport.version,
      technicalLastDate: technical?.lastDate || null,
      technicalHistorySessions,
      technicalMinimumSessionsBeforeHistoryIsNotInsufficient: v17TechnicalMinimumSessions,
      technicalSignal: technicalSignal || null,
      technicalScore: finite(rec?.technicalScore) ? Number(rec.technicalScore) : null,
      technicalConfidence: finite(rec?.finalConfidence) ? Number(rec.finalConfidence) : null,
      liquidityDecision: liq?.liquidityDecision || null,
      liquidityScore: finite(liq?.liquidityScore) ? Number(liq.liquidityScore) : null,
      srGrade: srRow?.grade || null,
      srRowExecutionEligible: srRow?.executionEligible === true,
      srGlobalExecutionCandidateReady: sr.executionCandidateReady === true,
      srConfidence: finite(srRow?.confidence) ? Number(srRow.confidence) : null,
      srFreshness: srRow?.freshness || null,
      srMethodology: srRow?.methodology || null,
      criticalSourceConflicts: conflicts,
      trustedPrice: v17PriceEligible ? Number(base.price) : null
    }
  };
});

const counts = key => rows.filter(row => row[key] === true).length;
const out = {
  schemaVersion: '20.0.0-v17-production-decision-core-2',
  generatedAt: new Date().toISOString(),
  moduleId: 'V20_V17_PRODUCTION_DECISION_CORE',
  sessionDate,
  sourceV17: {
    branch: sync?.source?.branch || 'develop/v17-rebuild',
    commitSha: sync?.source?.commitSha || null,
    recommendationEngine: recs.engine,
    recommendationMethodology: recStatus.scoreMethodology || 'EXISTING_TECHNICAL_50_CONFIDENCE_REUSED_WITHOUT_NEW_STRATEGY_FORMULA',
    technicalReportVersion: technicalReport.version,
    technicalReportSummary: technicalReport.summary || null,
    srSchemaVersion: sr.schemaVersion || null,
    srExecutionCandidateReady: sr.executionCandidateReady === true,
    globalGateStatus,
    globalExecutionGrade,
    sourceSessionVerified
  },
  policy: {
    v17IsAuthoritativeForProductionEligibility: true,
    v20NativeMayOverrideV17: false,
    researchDiscoveryMayContinueWhenBlocked: true,
    technicalSourceEligibilitySeparatedFromProductionReadiness: true,
    srRowEligibilitySeparatedFromGlobalSrReadiness: true,
    corporateActionUnknownNeverPromotedToSafe: true,
    globalGateClosedMeansZeroExecutionEligible: true
  },
  summary: {
    evaluatedCount: rows.length,
    selectionCandidateCount: counts('v17SelectionCandidate'),
    dataEligibleCount: counts('v17DataEligible'),
    liquidityEligibleCount: counts('v17LiquidityEligible'),
    technicalSourceEligibleCount: counts('v17TechnicalSourceEligible'),
    technicalProductionReadyCount: counts('v17TechnicalProductionReady'),
    technicalEligibleCount: counts('v17TechnicalEligible'),
    srSourceEligibleCount: counts('v17SrSourceEligible'),
    srProductionReadyCount: counts('v17SrProductionReady'),
    srEligibleCount: counts('v17SrEligible'),
    recommendationEligibleCount: counts('v17RecommendationEligible'),
    executionEligibleCount: counts('v17ExecutionEligible'),
    srGlobalExecutionReady: sr.executionCandidateReady === true,
    globalExecutionGrade
  },
  rows
};
if (!globalExecutionGrade && out.summary.executionEligibleCount !== 0) throw new Error('Closed V17 gate produced execution-eligible stocks');
if (out.summary.technicalSourceEligibleCount === 0) throw new Error('V17 Technical-50 source mapping failed: no current source-eligible rows');
if (Number(technicalReport.summary?.withAtLeast20Sessions || 0) === 0 && out.summary.technicalProductionReadyCount > 0) {
  // Production readiness is allowed at the exact V17 signal threshold of 10 sessions, not invented 20/50 requirements.
  if (!rows.some(row => row.v17TechnicalProductionReady && Number(row.evidence?.technicalHistorySessions) >= 10)) throw new Error('Technical readiness count cannot be justified from V17 history semantics');
}
writeAtomic('data/v20/v17-production-decision-core.json', out);
console.log(JSON.stringify({ok:true,sessionDate,moduleId:out.moduleId,...out.summary},null,2));
