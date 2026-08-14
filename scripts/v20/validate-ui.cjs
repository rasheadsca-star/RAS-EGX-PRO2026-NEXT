#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const json = rel => JSON.parse(read(rel));
const html = read('v20/index.html');
const css = read('v20/styles.css');
const portfolioCss = read('v20/portfolio.css');
const js = read('v20/app.js');
const portfolioJs = read('v20/portfolio.js');
const portfolioCore = read('v20/portfolio-core.js');
const performanceHtml = read('v20/performance.html');
const performanceCss = read('v20/performance.css');
const performanceJs = read('v20/performance.js');
const healthHtml = read('v20/health.html');
const healthCss = read('v20/health.css');
const healthJs = read('v20/health.js');
const explorer = json('data/v20/market-explorer.json');
const performance = json('data/v20/performance-evidence-registry.json');
const policy = json('data/v20/policy-registry.json');
const current = json('data/v20/current.json');
const marketRegime = json('data/v20/market-regime.json');
const sourceHealth = json('data/v20/source-health.json');
const gate = json('data/v17/resilient-session-status.json');
const technical = json('data/v20/technical-history-status.json');
const sector = json('data/v20/sector-provenance-audit.json');
const forward = json('data/v20/forward-evaluation.json');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(/<html\s+lang="ar"\s+dir="rtl">/i.test(html), 'ARABIC_RTL_DOCUMENT_MISSING');
check(/meta\s+name="viewport"/i.test(html), 'VIEWPORT_META_MISSING');
check(html.includes('id="executionBadge"'), 'EXECUTION_STATUS_NOT_VISIBLE');
check(html.includes('id="gateBanner"'), 'GLOBAL_GATE_BANNER_MISSING');
check(html.includes('id="searchInput"'), 'OPPORTUNITY_SEARCH_MISSING');
check(html.includes('id="marketSearchInput"'), 'FULL_MARKET_SEARCH_MISSING');
check(html.includes('id="marketAvailabilityFilter"'), 'MARKET_AVAILABILITY_FILTER_MISSING');
check(html.includes('id="marketLiquidityFilter"'), 'MARKET_LIQUIDITY_FILTER_MISSING');
check(html.includes('id="marketTechnicalFilter"'), 'MARKET_TECHNICAL_FILTER_MISSING');
check(html.includes('id="marketSort"'), 'MARKET_SORT_MISSING');
check(html.includes('id="marketPrev"') && html.includes('id="marketNext"'), 'MARKET_PAGINATION_MISSING');
for (const id of ['marketRegimePanel','marketRegimeBadge','marketRegimeTitle','marketRegimeCoverage','marketRegimeConfidence','marketRegimeScore','marketRegimeBreadth','marketRegimeSma20','marketRegimeSma50','marketRegimeMomentum5','marketRegimeMomentum20','marketRegimeVolatility','marketRegimeWarning']) check(html.includes(`id="${id}"`), `MARKET_REGIME_UI_MISSING_${id.toUpperCase()}`);
check(html.includes('id="stockDialog"'), 'STOCK_DETAIL_DIALOG_MISSING');
check(html.includes('Net R/R T1'), 'NET_RR_COLUMN_MISSING');
check(js.includes('riskReward?.primaryTarget1NetRiskReward'), 'UI_NOT_USING_PRIMARY_NET_RR');
check(js.includes('Legacy R/R — للمراجعة فقط'), 'LEGACY_RR_NOT_LABELED_AUDIT_ONLY');
check(js.includes('GLOBAL_EXECUTION_GATE_CLOSED'), 'GLOBAL_GATE_REASON_NOT_RENDERED');
check(js.includes("json('../data/v20/source-health.json')"), 'SOURCE_HEALTH_NOT_WIRED');
check(js.includes("json('../data/v20/stock-profiles.json')"), 'STOCK_PROFILES_NOT_WIRED');
check(js.includes("json('../data/v20/risk-reward-audit.json')"), 'RR_AUDIT_NOT_WIRED');
check(js.includes("json('../data/v20/market-explorer.json')"), 'MARKET_EXPLORER_NOT_WIRED');
check(js.includes("json('../data/v20/market-regime.json')"), 'MARKET_REGIME_NOT_WIRED');
check(js.includes('function renderMarketRegime()'), 'MARKET_REGIME_RENDERER_MISSING');
check(js.includes('لا تفتح بوابة التنفيذ ولا تغيّر أوزان الإنتاج تلقائيًا'), 'MARKET_REGIME_EXECUTION_SEPARATION_COPY_MISSING');
check(js.includes('اتساع جلسة اليوم سلبي'), 'MARKET_REGIME_BREADTH_CONFLICT_DISCLOSURE_MISSING');
check(js.includes('NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE'), 'TECHNICAL_SCOPE_STATE_NOT_RENDERED');
check(js.includes('لا يتم عرض سعر قديم كأنه حالي'), 'STALE_PRICE_UI_WARNING_MISSING');
check(js.includes('سهم من السوق الكامل — ليس توصية حالية'), 'MARKET_ONLY_NOT_RECOMMENDATION_UI_MISSING');
check(js.includes('marketPageSize: 25'), 'MARKET_PAGINATION_SIZE_POLICY_MISSING');

for (const id of [
  'portfolioForm','portfolioTicker','portfolioBuyPrice','portfolioQuantity','portfolioRows','portfolioCards',
  'portfolioCost','portfolioValue','portfolioPnl','portfolioCoverage','portfolioGateNote'
]) check(html.includes(`id="${id}"`), `PORTFOLIO_UI_MISSING_${id.toUpperCase()}`);

check(html.includes('src="./portfolio-core.js"'), 'PORTFOLIO_CORE_SCRIPT_NOT_LOADED');
check(html.includes('src="./portfolio.js"'), 'PORTFOLIO_UI_SCRIPT_NOT_LOADED');
check(html.includes('href="./portfolio.css"'), 'PORTFOLIO_CSS_NOT_LOADED');
check(portfolioCore.includes('egx-pro-v20-user-portfolio-v1'), 'PORTFOLIO_STORAGE_KEY_MISSING');
check(portfolioCore.includes('row?.currentSessionAvailable !== true'), 'PORTFOLIO_CURRENT_SESSION_PRICE_GUARD_MISSING');
check(portfolioCore.includes('automaticBuySellInstruction: null'), 'PORTFOLIO_NO_AUTOMATIC_BUY_SELL_CONTRACT_MISSING');
check(portfolioCore.includes('executionGateOverridden: false'), 'PORTFOLIO_EXECUTION_GATE_SEPARATION_MISSING');
check(portfolioJs.includes('localStorage.getItem(core.STORAGE_KEY)'), 'PORTFOLIO_LOCAL_STORAGE_READ_MISSING');
check(portfolioJs.includes('localStorage.setItem(core.STORAGE_KEY'), 'PORTFOLIO_LOCAL_STORAGE_WRITE_MISSING');
check(portfolioJs.includes("json('../data/v20/market-explorer.json')"), 'PORTFOLIO_MARKET_EXPLORER_NOT_WIRED');
check(portfolioJs.includes("json('../data/v20/current.json')"), 'PORTFOLIO_EXECUTION_STATUS_NOT_WIRED');
check(portfolioJs.includes('لا تنشئ أوامر شراء/بيع'), 'PORTFOLIO_NO_ORDER_UI_WARNING_MISSING');
check(!/fetch\([^)]*,\s*\{[^}]*method\s*:\s*['"]POST['"]/is.test(portfolioJs), 'PORTFOLIO_SERVER_POST_DETECTED');

check(/<html\s+lang="ar"\s+dir="rtl">/i.test(performanceHtml), 'PERFORMANCE_ARABIC_RTL_MISSING');
check(/meta\s+name="viewport"/i.test(performanceHtml), 'PERFORMANCE_VIEWPORT_MISSING');
for (const id of ['performanceEvidenceCount','performanceForwardState','performancePolicyNote','performanceGrid','performanceV18Note','performanceContent']) {
  check(performanceHtml.includes(`id="${id}"`), `PERFORMANCE_UI_MISSING_${id.toUpperCase()}`);
}
check(performanceHtml.includes('href="./index.html"'), 'PERFORMANCE_BACK_TO_PLATFORM_LINK_MISSING');
check(performanceHtml.includes('src="./performance.js"'), 'PERFORMANCE_SCRIPT_NOT_LOADED');
check(performanceHtml.includes('href="./performance.css"'), 'PERFORMANCE_CSS_NOT_LOADED');
check(performanceHtml.includes('لا يتم دمج الاختبار التاريخي'), 'PERFORMANCE_SEPARATION_COPY_MISSING');
check(!performanceHtml.includes('id="performanceHeadlineReturn"'), 'PERFORMANCE_HEADLINE_RETURN_UI_PRESENT');
check(performanceJs.includes("loadJson('../data/v20/performance-evidence-registry.json')"), 'PERFORMANCE_REGISTRY_NOT_WIRED');
check(performanceJs.includes("registry.policy?.singleHeadlinePerformanceMetricAllowed !== false"), 'PERFORMANCE_POLICY_RUNTIME_GUARD_MISSING');
check(performanceJs.includes('REUSED_BENCHMARK_NOT_INDEPENDENT'), 'REUSED_BENCHMARK_WARNING_NOT_RENDERED');
check(performanceJs.includes('DEVELOPMENT_OOS'), 'DEVELOPMENT_EVIDENCE_NOT_RENDERED');
check(performanceJs.includes('LIVE_FORWARD'), 'LIVE_FORWARD_NOT_RENDERED');
check(performanceJs.includes('غير صالح كدليل ترقية'), 'REUSED_BENCHMARK_PROMOTION_WARNING_MISSING');
check(performanceJs.includes('لا يوجد عائد محسوم بعد'), 'PENDING_FORWARD_NO_RETURN_COPY_MISSING');
check(!performanceJs.includes('v19DevelopmentAverageNetReturnPct'), 'PERFORMANCE_UI_USES_SUMMARY_DEVELOPMENT_RETURN');
check(!performanceJs.includes('v19ReusedBenchmarkAverageNetReturnPct'), 'PERFORMANCE_UI_USES_SUMMARY_BENCHMARK_RETURN');
try { new Function(performanceJs); } catch { failures.push('PERFORMANCE_JS_SYNTAX_INVALID'); }
check(performance.policy?.singleHeadlinePerformanceMetricAllowed === false, 'PERFORMANCE_REGISTRY_HEADLINE_POLICY_DRIFT');
check(performance.policy?.crossEvidenceAggregationAllowed === false, 'PERFORMANCE_REGISTRY_AGGREGATION_POLICY_DRIFT');
check(performance.policy?.historicalAndForwardEvidenceMustRemainSeparate === true, 'PERFORMANCE_REGISTRY_FORWARD_SEPARATION_DRIFT');
check(performance.policy?.reusedBenchmarkCanPromoteChallenger === false, 'PERFORMANCE_REGISTRY_PROMOTION_POLICY_DRIFT');
check(performance.policy?.pendingForwardReturnMustRemainNull === true, 'PERFORMANCE_REGISTRY_PENDING_NULL_POLICY_DRIFT');
check(performance.policy?.v18PerformanceAccepted === false, 'PERFORMANCE_REGISTRY_V18_POLICY_DRIFT');

check(/<html\s+lang="ar"\s+dir="rtl">/i.test(healthHtml), 'HEALTH_ARABIC_RTL_MISSING');
check(/meta\s+name="viewport"/i.test(healthHtml), 'HEALTH_VIEWPORT_MISSING');
for (const id of [
  'healthMain','healthTitle','healthSession','healthExecution','healthDataState','healthCoverage','healthFreshness','healthCritical','healthSourceAge',
  'blockerCount','blockerGrid','readinessGrid','conflictCount','conflictList','missingCount','missingSymbols','qualityGrid','healthRegimeBadge',
  'marketContext','forwardBadge','forwardContext','provenanceList','healthError'
]) check(healthHtml.includes(`id="${id}"`), `HEALTH_UI_MISSING_${id.toUpperCase()}`);
check(healthHtml.includes('href="./index.html"'), 'HEALTH_BACK_TO_PLATFORM_LINK_MISSING');
check(healthHtml.includes('href="./performance.html"'), 'HEALTH_PERFORMANCE_LINK_MISSING');
check(healthHtml.includes('src="./health.js"'), 'HEALTH_SCRIPT_NOT_LOADED');
check(healthHtml.includes('href="./health.css"'), 'HEALTH_CSS_NOT_LOADED');
check(healthHtml.includes('تظهر هنا فقط الأسباب المسجلة حرفيًا'), 'HEALTH_AUTHORITATIVE_BLOCKER_COPY_MISSING');
for (const source of [
  "loadJson('../data/v20/current.json')",
  "loadJson('../data/v20/source-health.json')",
  "loadJson('../data/v17/resilient-session-status.json')",
  "loadJson('../data/v20/technical-history-status.json')",
  "loadJson('../data/v20/sector-provenance-audit.json')",
  "loadJson('../data/v20/market-regime.json')",
  "loadJson('../data/v20/forward-evaluation.json')"
]) check(healthJs.includes(source), `HEALTH_SOURCE_NOT_WIRED_${source.replace(/[^A-Z0-9]/gi,'_').toUpperCase()}`);
check(healthJs.includes('const reasons = Array.isArray(gate.reasons) ? gate.reasons : []'), 'HEALTH_BLOCKERS_NOT_FROM_V17_REASONS');
check(!healthJs.includes('current.warnings'), 'HEALTH_CURRENT_WARNINGS_MISUSED_AS_BLOCKERS');
check(healthJs.includes('sourceHealth.sourceConflicts'), 'HEALTH_SOURCE_CONFLICTS_NOT_RENDERED');
check(healthJs.includes('sourceHealth.missingSymbols'), 'HEALTH_MISSING_SYMBOLS_NOT_RENDERED');
check(healthJs.includes('technical.currentTechnicalReadyCount'), 'HEALTH_TECHNICAL_STATUS_NOT_RENDERED');
check(healthJs.includes('sector.summary?.productionVerifiedCount'), 'HEALTH_SECTOR_PROVENANCE_NOT_RENDERED');
check(healthJs.includes('regime.methodology?.executionGateInfluence'), 'HEALTH_REGIME_EXECUTION_SEPARATION_NOT_RENDERED');
check(healthJs.includes('forward.evaluationRegression?.ok'), 'HEALTH_FORWARD_REGRESSION_NOT_RENDERED');
check(healthJs.includes('Research → Production') && healthJs.includes('ممنوع'), 'HEALTH_RESEARCH_PRODUCTION_SEPARATION_NOT_VISIBLE');
check(!/fetch\([^)]*,\s*\{[^}]*method\s*:\s*['"]POST['"]/is.test(healthJs), 'HEALTH_WRITE_REQUEST_DETECTED');
try { new Function(healthJs); } catch { failures.push('HEALTH_JS_SYNTAX_INVALID'); }

check(sourceHealth.sessionDate === current.sessionDate, 'HEALTH_SOURCE_SESSION_MISMATCH');
check(gate.priceTruth?.verifiedSessionDate === current.sessionDate, 'HEALTH_GATE_PRICE_SESSION_MISMATCH');
check(sourceHealth.executionGrade === gate.executionGrade, 'HEALTH_EXECUTION_GRADE_SOURCE_MISMATCH');
check(gate.executionGrade === true || current.executionStatus !== 'EXECUTION_GRADE', 'HEALTH_CURRENT_EXECUTION_OVERRIDES_GATE');
check(Array.isArray(gate.reasons), 'HEALTH_GATE_REASONS_NOT_ARRAY');
check(technical.asOfSessionDate === current.sessionDate, 'HEALTH_TECHNICAL_SESSION_MISMATCH');
check(sector.summary?.productionVerifiedCount === 0, 'HEALTH_SECTOR_PRODUCTION_PROVENANCE_UNEXPECTED');
check(sector.summary?.productionSectorConcentrationEnabled === false, 'HEALTH_SECTOR_CONCENTRATION_POLICY_DRIFT');
check(marketRegime.asOfSessionDate === current.sessionDate, 'HEALTH_MARKET_REGIME_SESSION_MISMATCH');
check(marketRegime.methodology?.executionGateInfluence === false, 'HEALTH_MARKET_REGIME_EXECUTION_INFLUENCE_DRIFT');
check(marketRegime.methodology?.productionRiskBudgetInfluence === false, 'HEALTH_MARKET_REGIME_RISK_INFLUENCE_DRIFT');
check(forward.asOfSessionDate === current.sessionDate, 'HEALTH_FORWARD_SESSION_MISMATCH');
check(forward.authoritativeEvidence?.selfContainedStatus === true, 'HEALTH_FORWARD_SELF_CONTAINED_STATUS_MISSING');
check(forward.authoritativeEvidence?.selfContainedRegression === true, 'HEALTH_FORWARD_SELF_CONTAINED_REGRESSION_MISSING');
check(forward.evaluationRegression?.ok === true, 'HEALTH_FORWARD_REGRESSION_FAILED');
check(forward.authoritativeEvidence?.derivedSidecarsAreAuthoritative === false, 'HEALTH_FORWARD_SIDECAR_AUTHORITY_DRIFT');

check(css.includes('.market-regime-panel{'), 'MARKET_REGIME_STYLES_MISSING');
check(marketRegime.asOfSessionDate === current.sessionDate, 'MARKET_REGIME_UI_SESSION_MISMATCH');
check(marketRegime.methodology?.sectorInputsUsed === false, 'MARKET_REGIME_UI_SECTOR_INFERENCE_LEAK');
check(marketRegime.methodology?.productionRiskBudgetInfluence === false, 'MARKET_REGIME_UI_RISK_INFLUENCE_DRIFT');
check(marketRegime.methodology?.executionGateInfluence === false, 'MARKET_REGIME_UI_EXECUTION_INFLUENCE_DRIFT');
if (marketRegime.verified === true) {
  check(current.marketStatus?.verified === true, 'CURRENT_MARKET_STATUS_NOT_VERIFIED_WITH_VERIFIED_EVIDENCE');
  check(current.marketStatus?.regime === marketRegime.regime, 'CURRENT_MARKET_STATUS_REGIME_MISMATCH');
} else {
  check(current.marketStatus?.verified === false, 'CURRENT_MARKET_STATUS_VERIFIED_WITH_UNVERIFIED_EVIDENCE');
}

check(css.includes('@media(max-width:1024px)'), 'RESPONSIVE_1024_MISSING');
check(css.includes('@media(max-width:768px)'), 'RESPONSIVE_768_MISSING');
check(css.includes('@media(max-width:430px)'), 'RESPONSIVE_430_MISSING');
check(css.includes('@media(max-width:390px)'), 'RESPONSIVE_390_MISSING');
check(css.includes('prefers-reduced-motion'), 'REDUCED_MOTION_MISSING');
check(portfolioCss.includes('@media(max-width:1024px)'), 'PORTFOLIO_RESPONSIVE_1024_MISSING');
check(portfolioCss.includes('@media(max-width:768px)'), 'PORTFOLIO_RESPONSIVE_768_MISSING');
check(portfolioCss.includes('@media(max-width:430px)'), 'PORTFOLIO_RESPONSIVE_430_MISSING');
check(portfolioCss.includes('@media(max-width:390px)'), 'PORTFOLIO_RESPONSIVE_390_MISSING');
check(performanceCss.includes('@media(max-width:1024px)'), 'PERFORMANCE_RESPONSIVE_1024_MISSING');
check(performanceCss.includes('@media(max-width:768px)'), 'PERFORMANCE_RESPONSIVE_768_MISSING');
check(performanceCss.includes('@media(max-width:430px)'), 'PERFORMANCE_RESPONSIVE_430_MISSING');
check(performanceCss.includes('@media(max-width:390px)'), 'PERFORMANCE_RESPONSIVE_390_MISSING');
check(healthCss.includes('@media(max-width:1024px)'), 'HEALTH_RESPONSIVE_1024_MISSING');
check(healthCss.includes('@media(max-width:768px)'), 'HEALTH_RESPONSIVE_768_MISSING');
check(healthCss.includes('@media(max-width:430px)'), 'HEALTH_RESPONSIVE_430_MISSING');
check(healthCss.includes('@media(max-width:390px)'), 'HEALTH_RESPONSIVE_390_MISSING');
check(healthCss.includes('prefers-reduced-motion'), 'HEALTH_REDUCED_MOTION_MISSING');
check(html.includes('aria-live="polite"'), 'ARIA_LIVE_STATUS_MISSING');
check(performanceHtml.includes('aria-live="polite"'), 'PERFORMANCE_ARIA_LIVE_MISSING');
check(healthHtml.includes('aria-live="polite"'), 'HEALTH_ARIA_LIVE_MISSING');
check(html.includes('class="skip-link"'), 'SKIP_LINK_MISSING');
check(performanceHtml.includes('class="skip-link"'), 'PERFORMANCE_SKIP_LINK_MISSING');
check(healthHtml.includes('class="skip-link"'), 'HEALTH_SKIP_LINK_MISSING');
check(explorer.policy?.fullMarketSearch === true, 'EXPLORER_FULL_MARKET_POLICY_NOT_ACTIVE');
check(explorer.policy?.marketOnlyIsRecommendation === false, 'EXPLORER_MARKET_ONLY_POLICY_DRIFT');
check(explorer.policy?.semanticRowQualityPropagated === true, 'SEMANTIC_ROW_QUALITY_NOT_PROPAGATED');
check(policy.userPortfolio?.storage === 'BROWSER_LOCAL_STORAGE_ONLY', 'PORTFOLIO_LOCAL_ONLY_POLICY_NOT_ACTIVE');
check(policy.userPortfolio?.influencesExecutionGate === false, 'PORTFOLIO_EXECUTION_GATE_POLICY_DRIFT');
check(policy.userPortfolio?.automaticOrders === false, 'PORTFOLIO_AUTO_ORDER_POLICY_DRIFT');

const report = {
  schemaVersion: '20.0.0-ui-validation-6',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    rtlArabicFirst: true,
    globalExecutionStatusVisible: true,
    conservativeNetRiskRewardPrimary: true,
    legacyRiskRewardAuditOnly: true,
    opportunitySearchSeparatedFromFullMarketSearch: true,
    fullMarketExplorerWired: true,
    marketOnlyNotRecommendation: true,
    noStalePricePresentedAsCurrent: true,
    technicalReadinessStateVisible: true,
    semanticDataQualityVisibleToExplorer: true,
    paginationPageSize: 25,
    userPortfolioLocalOnly: true,
    userPortfolioCurrentSessionValuationOnly: true,
    userPortfolioNoAutomaticOrders: true,
    userPortfolioExecutionGateSeparated: true,
    performanceEvidencePageSeparated: true,
    performanceNoHeadlineAggregation: true,
    performanceReusedBenchmarkWarningVisible: true,
    performancePendingForwardNoReturn: true,
    performanceV18Unaccepted: true,
    marketRegimeVisible: true,
    marketRegimeEvidenceSessionAligned: marketRegime.asOfSessionDate === current.sessionDate,
    marketRegimeExecutionGateSeparated: true,
    marketRegimeSectorInferenceExcluded: true,
    marketRegimeBreadthConflictDisclosure: true,
    sourceHealthVisible: true,
    decisionHealthCenterSeparated: true,
    decisionHealthBlockersAuthoritativeV17Only: true,
    decisionHealthContextSeparatedFromBlockers: true,
    decisionHealthReadOnly: true,
    decisionHealthSourceConflictsVisible: true,
    decisionHealthMissingEvidenceVisible: true,
    decisionHealthForwardEmbeddedEvidenceVisible: true,
    decisionHealthSectorProvenanceVisible: true,
    responsiveBreakpoints: [1024, 768, 430, 390],
    reducedMotionSupport: true,
    accessibilityBasics: true
  },
  limitation: 'Static contract validation plus generated-data invariants. Pixel-level/browser visual verification remains a separate acceptance step.'
};

fs.mkdirSync(path.join(root, 'data/v20'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/v20/ui-validation.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
