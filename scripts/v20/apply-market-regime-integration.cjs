#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function replaceExact(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Expected ${label} pattern not found; refusing broad patch`);
  return source.replace(before, after);
}

function patchBuilder() {
  const file = P('scripts/v20/build-integrated-decision-snapshot.cjs');
  let source = fs.readFileSync(file, 'utf8');

  source = replaceExact(
    source,
    "const sourceHealth = read('data/v20/source-health.json');",
    "const sourceHealth = read('data/v20/source-health.json');\nconst currentMarketRegime = read('data/v20/market-regime.json');",
    'market regime input',
  );

  source = replaceExact(
    source,
    "const marketRegime = v17?.market?.regime || 'UNVERIFIED_CURRENT_REGIME';\nconst marketVerified = !String(marketRegime).startsWith('UNVERIFIED');",
    "const marketRegimeSessionAligned = currentMarketRegime?.asOfSessionDate === sessionDate;\nconst marketVerified = currentMarketRegime?.verified === true && marketRegimeSessionAligned;\nconst marketRegime = marketVerified ? currentMarketRegime.regime : 'UNVERIFIED_CURRENT_REGIME';",
    'market regime authority',
  );

  source = replaceExact(
    source,
    "const marketConfidencePct = marketVerified\n  ? round(Math.min(gateCoveragePct, gateFreshnessPct, gateCriticalFieldsPct), 1)\n  : 0;",
    "const marketConfidencePct = marketVerified ? clamp(currentMarketRegime?.marketConfidencePct ?? 0, 0, 100) : 0;",
    'market confidence calculation',
  );

  source = replaceExact(
    source,
    "  ...(!marketVerified ? ['CURRENT_MARKET_REGIME_UNVERIFIED'] : []),\n  'V18_EXTERNAL_REFERENCE_BROWSER_AUDIT_PENDING',",
    "  ...(!marketVerified ? ['CURRENT_MARKET_REGIME_UNVERIFIED'] : []),\n  ...(currentMarketRegime?.asOfSessionDate && !marketRegimeSessionAligned ? ['MARKET_REGIME_EVIDENCE_SESSION_MISMATCH'] : []),\n  ...((currentMarketRegime?.warnings || []).map(w => `MARKET_REGIME_${w}`)),\n  'V18_EXTERNAL_REFERENCE_BROWSER_AUDIT_PENDING',",
    'market regime warnings',
  );

  source = replaceExact(
    source,
    "  marketStatus: {\n    regime: marketRegime,\n    labelAr: v17?.market?.labelAr || null,\n    verified: marketVerified,\n    marketConfidencePct,\n  },",
    "  marketStatus: {\n    regime: marketRegime,\n    labelAr: marketVerified ? (currentMarketRegime?.labelAr || null) : 'حالة السوق الحالية غير متحققة بتغطية تاريخية متزامنة كافية',\n    verified: marketVerified,\n    marketConfidencePct,\n    evidenceCoveragePct: finite(currentMarketRegime?.metrics?.participationPct),\n    classificationScore: finite(currentMarketRegime?.classificationScore),\n    diagnosticRegime: currentMarketRegime?.diagnosticRegime || null,\n    volatilityOverlay: currentMarketRegime?.volatilityOverlay || null,\n    evidenceSessionAligned: marketRegimeSessionAligned,\n    evidenceSource: 'data/v20/market-regime.json',\n    productionRiskBudgetInfluence: false,\n    executionGateInfluence: false,\n  },",
    'market status output',
  );

  source = replaceExact(
    source,
    "      sourceHealth: 'data/v20/source-health.json',\n    },",
    "      sourceHealth: 'data/v20/source-health.json',\n      marketRegime: 'data/v20/market-regime.json',\n    },",
    'market regime provenance',
  );

  source = replaceExact(
    source,
    "      sourceHealthGeneratedAt: sourceHealth?.generatedAt || null,\n      policySchema: policy?.schemaVersion || null,",
    "      sourceHealthGeneratedAt: sourceHealth?.generatedAt || null,\n      marketRegimeGeneratedAt: currentMarketRegime?.generatedAt || null,\n      marketRegimeAsOfSessionDate: currentMarketRegime?.asOfSessionDate || null,\n      policySchema: policy?.schemaVersion || null,",
    'market regime source hash',
  );

  fs.writeFileSync(file, source, 'utf8');
}

function patchPolicy() {
  const file = P('data/v20/policy-registry.json');
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  policy.schemaVersion = '20.0.0-policy-registry-6';
  policy.marketRegime = {
    scope: 'V20_MASTER_UNIVERSE',
    methodologyReference: 'EGX_PRO_MARKET_REGIME_BREADTH_1.0_V16_REFERENCE',
    outputRegimes: ['BULLISH', 'NEUTRAL', 'BEARISH'],
    minimumVerifiedParticipationPct: 60,
    approvedPrimarySources: ['yahoo', 'starta_ohlc_api'],
    currentSnapshotCrossCheckRequired: true,
    currentSnapshotSemanticCompletenessRequired: true,
    currentSessionAlignmentRequired: true,
    currentPriceReconciliationRequired: true,
    maximumCurrentPriceDifferencePct: 5,
    minimumTrustedSessionsPerSymbol: 50,
    pointInTimeCutoffRequired: true,
    futureRowsAllowed: false,
    missingOhlcSynthesisAllowed: false,
    derivedSnapshotHistoryAllowed: false,
    sectorInputsAllowed: false,
    staleV16RegimeMayBePromotedToCurrent: false,
    productionRiskBudgetInfluence: false,
    executionGateInfluence: false,
    decisionUse: 'CURRENT_MARKET_CONTEXT_OR_RESEARCH_DIAGNOSTIC_ONLY',
    note: 'V20 reuses the frozen V16 breadth/trend/volatility methodology as a reference, but current regime status requires at least 60% full-universe participation with same-session trusted history and current-price reconciliation. A stale V16 regime is never promoted to current evidence.',
  };
  fs.writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
}

function patchIndex() {
  const file = P('v20/index.html');
  let source = fs.readFileSync(file, 'utf8');
  const before = '      <section id="rrAuditBanner" class="audit-banner hidden" aria-live="polite"></section>\n\n      <section class="panel opportunities-panel">';
  const after = `      <section id="rrAuditBanner" class="audit-banner hidden" aria-live="polite"></section>\n\n      <section id="marketRegimePanel" class="panel market-regime-panel" aria-labelledby="marketRegimeHeading">\n        <div class="panel-header regime-header">\n          <div>\n            <span class="eyebrow">حالة السوق الحالية</span>\n            <h2 id="marketRegimeHeading">Market Regime</h2>\n            <p>قراءة مستقلة لاتساع السوق والاتجاه والزخم والتقلب. لا تفتح هذه القراءة بوابة التنفيذ ولا تغيّر أوزان المحفظة الإنتاجية.</p>\n          </div>\n          <span id="marketRegimeBadge" class="status-pill status-neutral">جاري التحقق</span>\n        </div>\n        <div class="regime-summary">\n          <div class="regime-lead">\n            <span>الحالة الموثقة</span>\n            <strong id="marketRegimeTitle">—</strong>\n            <small id="marketRegimeDescription">—</small>\n          </div>\n          <div class="regime-core-metrics">\n            <div><span>تغطية الدليل</span><strong id="marketRegimeCoverage">—</strong><small id="marketRegimeAnalyzed">—</small></div>\n            <div><span>ثقة السوق</span><strong id="marketRegimeConfidence">—</strong><small>مرتبطة بتغطية الدليل الحالي</small></div>\n            <div><span>درجة التصنيف</span><strong id="marketRegimeScore">—</strong><small>منهج breadth/trend/volatility</small></div>\n          </div>\n        </div>\n        <div class="regime-evidence-grid" aria-label="أدلة حالة السوق">\n          <div><span>اتساع الجلسة</span><strong id="marketRegimeBreadth">—</strong><small id="marketRegimeAdRatio">—</small></div>\n          <div><span>فوق SMA20</span><strong id="marketRegimeSma20">—</strong><small>اتجاه قصير/متوسط</small></div>\n          <div><span>فوق SMA50</span><strong id="marketRegimeSma50">—</strong><small>اتجاه متوسط</small></div>\n          <div><span>زخم 5 جلسات</span><strong id="marketRegimeMomentum5">—</strong><small>Median للسوق المؤهل</small></div>\n          <div><span>زخم 20 جلسة</span><strong id="marketRegimeMomentum20">—</strong><small>Median للسوق المؤهل</small></div>\n          <div><span>تقلب 20 جلسة</span><strong id="marketRegimeVolatility">—</strong><small id="marketRegimeVolatilityOverlay">—</small></div>\n        </div>\n        <div id="marketRegimeWarning" class="regime-warning" aria-live="polite">حالة السوق سياق تحليلي فقط — لا تفتح بوابة التنفيذ.</div>\n      </section>\n\n      <section class="panel opportunities-panel">`;
  source = replaceExact(source, before, after, 'market regime panel');
  fs.writeFileSync(file, source, 'utf8');
}

function patchApp() {
  const file = P('v20/app.js');
  let source = fs.readFileSync(file, 'utf8');

  source = replaceExact(
    source,
    '    current: null, sourceHealth: null, profiles: null, rrAudit: null, portfolioRisk: null, marketExplorer: null,',
    '    current: null, sourceHealth: null, profiles: null, rrAudit: null, portfolioRisk: null, marketExplorer: null, marketRegime: null,',
    'market regime state',
  );

  source = replaceExact(
    source,
    "  const riskAr = value => ({NORMAL:'طبيعي',CAUTIOUS:'حذر',DEFENSIVE:'دفاعي',CASH_PRESERVATION:'حماية السيولة'}[value] || value || '—');",
    "  const riskAr = value => ({NORMAL:'طبيعي',CAUTIOUS:'حذر',DEFENSIVE:'دفاعي',CASH_PRESERVATION:'حماية السيولة'}[value] || value || '—');\n  const marketRegimeAr = value => ({BULLISH:'صاعد',NEUTRAL:'محايد',BEARISH:'هابط / دفاعي',UNVERIFIED_CURRENT_REGIME:'غير متحقق'}[value] || value || '—');",
    'market regime translation',
  );

  source = replaceExact(
    source,
    '      const [current, sourceHealth, profiles, rrAudit, portfolioRisk, marketExplorer] = await Promise.all([',
    '      const [current, sourceHealth, profiles, rrAudit, portfolioRisk, marketExplorer, marketRegime] = await Promise.all([',
    'market regime load destructuring',
  );

  source = replaceExact(
    source,
    "        json('../data/v20/portfolio-risk.json'),\n        json('../data/v20/market-explorer.json')\n      ]);",
    "        json('../data/v20/portfolio-risk.json'),\n        json('../data/v20/market-explorer.json'),\n        json('../data/v20/market-regime.json')\n      ]);",
    'market regime fetch',
  );

  source = replaceExact(
    source,
    '      Object.assign(state, { current, sourceHealth, profiles, rrAudit, portfolioRisk, marketExplorer });',
    '      Object.assign(state, { current, sourceHealth, profiles, rrAudit, portfolioRisk, marketExplorer, marketRegime });',
    'market regime state assignment',
  );

  source = replaceExact(
    source,
    '      renderHeader(); renderMetrics(); renderAudit(); renderOpportunities(); renderMarketSummary(); renderMarketExplorer(); renderSourceHealth(); renderGovernance();',
    '      renderHeader(); renderMetrics(); renderMarketRegime(); renderAudit(); renderOpportunities(); renderMarketSummary(); renderMarketExplorer(); renderSourceHealth(); renderGovernance();',
    'market regime render call',
  );

  const metricsBlock = `  function renderMetrics() {\n    const c = state.current;\n    $('coverage').textContent = pct(c.dataStatus?.coveragePct);\n    $('freshness').textContent = pct(c.dataStatus?.freshnessPct);\n    $('criticalFields').textContent = pct(c.dataStatus?.criticalFieldsPct);\n    $('riskState').textContent = riskAr(c.portfolio?.riskState);\n  }`;
  const metricsWithRegime = `${metricsBlock}\n\n  function renderMarketRegime() {\n    const mr = state.marketRegime || {};\n    const current = state.current || {};\n    const metrics = mr.metrics || {};\n    const verified = mr.verified === true && mr.asOfSessionDate === current.sessionDate;\n    const regime = verified ? mr.regime : 'UNVERIFIED_CURRENT_REGIME';\n    const badge = $('marketRegimeBadge');\n    badge.textContent = verified ? marketRegimeAr(regime) : 'غير متحقق';\n    badge.className = \`status-pill \${verified ? (regime === 'BULLISH' ? 'status-good' : regime === 'NEUTRAL' ? 'status-warn' : 'status-bad') : 'status-neutral'}\`;\n    $('marketRegimeTitle').textContent = marketRegimeAr(regime);\n    $('marketRegimeDescription').textContent = verified ? (mr.labelAr || 'حالة سوق موثقة من الدليل الحالي') : 'التغطية أو تزامن الجلسة غير كافيين لتثبيت حالة سوق حالية.';\n    $('marketRegimeCoverage').textContent = pct(metrics.participationPct);\n    $('marketRegimeAnalyzed').textContent = \`\${num(metrics.analyzedCount, 0)} من \${num(metrics.universeCount, 0)} سهم\`;\n    $('marketRegimeConfidence').textContent = pct(verified ? mr.marketConfidencePct : 0);\n    $('marketRegimeScore').textContent = num(mr.classificationScore, 0);\n    $('marketRegimeBreadth').textContent = \`\${num(metrics.advances, 0)} صاعد / \${num(metrics.declines, 0)} هابط\`;\n    $('marketRegimeAdRatio').textContent = \`A/D \${num(metrics.advanceDeclineRatio, 2)} • صعود \${pct(metrics.advancePct)}\`;\n    $('marketRegimeSma20').textContent = pct(metrics.aboveSma20Pct);\n    $('marketRegimeSma50').textContent = pct(metrics.aboveSma50Pct);\n    $('marketRegimeMomentum5').textContent = pct(metrics.medianReturn5Pct);\n    $('marketRegimeMomentum20').textContent = pct(metrics.medianReturn20Pct);\n    $('marketRegimeVolatility').textContent = pct(metrics.volatility20AnnualizedPct);\n    $('marketRegimeVolatilityOverlay').textContent = mr.volatilityOverlay === 'HIGH_VOLATILITY' ? 'تقلب مرتفع استثنائي' : 'تقلب دون حد الاستثناء';\n\n    const warning = $('marketRegimeWarning');\n    const dailyBreadthWeak = numeric(metrics.advances) !== null && numeric(metrics.declines) !== null && Number(metrics.advances) < Number(metrics.declines);\n    const gateClosed = current.executionStatus !== 'EXECUTION_GRADE';\n    const notes = [];\n    if (dailyBreadthWeak) notes.push('اتساع جلسة اليوم سلبي رغم قوة الاتجاه والزخم المتوسط/الأطول؛ لا تُقرأ BULLISH كإشارة شراء فورية.');\n    if (gateClosed) notes.push('بوابة V17 لم تمنح Execution Grade، لذلك لا يوجد تنفيذ أو تعرض مطبق.');\n    notes.push('حالة السوق سياق تحليلي فقط — لا تفتح بوابة التنفيذ ولا تغيّر أوزان الإنتاج تلقائيًا.');\n    warning.textContent = notes.join(' ');\n    warning.classList.toggle('regime-warning-strong', dailyBreadthWeak || gateClosed);\n  }`;
  source = replaceExact(source, metricsBlock, metricsWithRegime, 'market regime renderer');

  fs.writeFileSync(file, source, 'utf8');
}

function patchStyles() {
  const file = P('v20/styles.css');
  let source = fs.readFileSync(file, 'utf8');
  const marker = '@media(max-width:1200px)';
  const css = '.market-regime-panel{position:relative;overflow:hidden}.market-regime-panel:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(180deg,var(--accent),var(--blue));opacity:.75}.regime-header{align-items:flex-start}.regime-summary{display:grid;grid-template-columns:minmax(240px,.8fr) 1.5fr;gap:14px;margin-bottom:14px}.regime-lead,.regime-core-metrics>div,.regime-evidence-grid>div{border:1px solid var(--line);background:rgba(255,255,255,.022);border-radius:14px;padding:15px}.regime-lead{display:flex;flex-direction:column;justify-content:center;min-height:112px}.regime-lead span,.regime-lead small,.regime-core-metrics span,.regime-core-metrics small,.regime-evidence-grid span,.regime-evidence-grid small{display:block;color:var(--muted);font-size:10px}.regime-lead strong{font-size:30px;margin:5px 0}.regime-core-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.regime-core-metrics strong,.regime-evidence-grid strong{display:block;font-size:20px;margin:6px 0}.regime-evidence-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.regime-warning{margin-top:14px;padding:12px 14px;border:1px solid rgba(112,167,255,.22);background:rgba(112,167,255,.055);border-radius:12px;color:#c9ddff;line-height:1.7;font-size:12px}.regime-warning-strong{border-color:rgba(246,195,91,.30);background:rgba(246,195,91,.07);color:#ffe0a0}@media(max-width:1200px){.regime-evidence-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:1024px){.regime-summary{grid-template-columns:1fr}.regime-core-metrics{grid-template-columns:repeat(3,1fr)}}@media(max-width:768px){.regime-evidence-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:430px){.regime-core-metrics,.regime-evidence-grid{grid-template-columns:1fr}.regime-lead strong{font-size:25px}}';
  if (!source.includes('.market-regime-panel{')) {
    if (!source.includes(marker)) throw new Error('Expected CSS responsive marker not found; refusing broad patch');
    source = source.replace(marker, `${css}${marker}`);
  }
  fs.writeFileSync(file, source, 'utf8');
}

function patchUiValidator() {
  const file = P('scripts/v20/validate-ui.cjs');
  let source = fs.readFileSync(file, 'utf8');

  source = replaceExact(
    source,
    "const policy = json('data/v20/policy-registry.json');\nconst failures = [];",
    "const policy = json('data/v20/policy-registry.json');\nconst current = json('data/v20/current.json');\nconst marketRegime = json('data/v20/market-regime.json');\nconst failures = [];",
    'market regime validator data inputs',
  );

  source = replaceExact(
    source,
    "check(html.includes('id=\"marketPrev\"') && html.includes('id=\"marketNext\"'), 'MARKET_PAGINATION_MISSING');\ncheck(html.includes('id=\"stockDialog\"'), 'STOCK_DETAIL_DIALOG_MISSING');",
    "check(html.includes('id=\"marketPrev\"') && html.includes('id=\"marketNext\"'), 'MARKET_PAGINATION_MISSING');\nfor (const id of ['marketRegimePanel','marketRegimeBadge','marketRegimeTitle','marketRegimeCoverage','marketRegimeConfidence','marketRegimeScore','marketRegimeBreadth','marketRegimeSma20','marketRegimeSma50','marketRegimeMomentum5','marketRegimeMomentum20','marketRegimeVolatility','marketRegimeWarning']) check(html.includes(`id=\"${id}\"`), `MARKET_REGIME_UI_MISSING_${id.toUpperCase()}`);\ncheck(html.includes('id=\"stockDialog\"'), 'STOCK_DETAIL_DIALOG_MISSING');",
    'market regime UI ids validation',
  );

  source = replaceExact(
    source,
    "check(js.includes(\"json('../data/v20/market-explorer.json')\"), 'MARKET_EXPLORER_NOT_WIRED');\ncheck(js.includes('NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE'), 'TECHNICAL_SCOPE_STATE_NOT_RENDERED');",
    "check(js.includes(\"json('../data/v20/market-explorer.json')\"), 'MARKET_EXPLORER_NOT_WIRED');\ncheck(js.includes(\"json('../data/v20/market-regime.json')\"), 'MARKET_REGIME_NOT_WIRED');\ncheck(js.includes('function renderMarketRegime()'), 'MARKET_REGIME_RENDERER_MISSING');\ncheck(js.includes('لا تفتح بوابة التنفيذ ولا تغيّر أوزان الإنتاج تلقائيًا'), 'MARKET_REGIME_EXECUTION_SEPARATION_COPY_MISSING');\ncheck(js.includes('اتساع جلسة اليوم سلبي'), 'MARKET_REGIME_BREADTH_CONFLICT_DISCLOSURE_MISSING');\ncheck(js.includes('NOT_EVALUATED_IN_CURRENT_TECHNICAL_SCOPE'), 'TECHNICAL_SCOPE_STATE_NOT_RENDERED');",
    'market regime JS validation',
  );

  source = replaceExact(
    source,
    "check(performance.policy?.v18PerformanceAccepted === false, 'PERFORMANCE_REGISTRY_V18_POLICY_DRIFT');\n\ncheck(css.includes('@media(max-width:1024px)'), 'RESPONSIVE_1024_MISSING');",
    "check(performance.policy?.v18PerformanceAccepted === false, 'PERFORMANCE_REGISTRY_V18_POLICY_DRIFT');\ncheck(css.includes('.market-regime-panel{'), 'MARKET_REGIME_STYLES_MISSING');\ncheck(marketRegime.asOfSessionDate === current.sessionDate, 'MARKET_REGIME_UI_SESSION_MISMATCH');\ncheck(marketRegime.methodology?.sectorInputsUsed === false, 'MARKET_REGIME_UI_SECTOR_INFERENCE_LEAK');\ncheck(marketRegime.methodology?.productionRiskBudgetInfluence === false, 'MARKET_REGIME_UI_RISK_INFLUENCE_DRIFT');\ncheck(marketRegime.methodology?.executionGateInfluence === false, 'MARKET_REGIME_UI_EXECUTION_INFLUENCE_DRIFT');\nif (marketRegime.verified === true) {\n  check(current.marketStatus?.verified === true, 'CURRENT_MARKET_STATUS_NOT_VERIFIED_WITH_VERIFIED_EVIDENCE');\n  check(current.marketStatus?.regime === marketRegime.regime, 'CURRENT_MARKET_STATUS_REGIME_MISMATCH');\n} else {\n  check(current.marketStatus?.verified === false, 'CURRENT_MARKET_STATUS_VERIFIED_WITH_UNVERIFIED_EVIDENCE');\n}\n\ncheck(css.includes('@media(max-width:1024px)'), 'RESPONSIVE_1024_MISSING');",
    'market regime data/UI contract validation',
  );

  source = replaceExact(
    source,
    "  schemaVersion: '20.0.0-ui-validation-4',",
    "  schemaVersion: '20.0.0-ui-validation-5',",
    'UI validation schema bump',
  );

  source = replaceExact(
    source,
    "    performanceV18Unaccepted: true,\n    sourceHealthVisible: true,",
    "    performanceV18Unaccepted: true,\n    marketRegimeVisible: true,\n    marketRegimeEvidenceSessionAligned: marketRegime.asOfSessionDate === current.sessionDate,\n    marketRegimeExecutionGateSeparated: true,\n    marketRegimeSectorInferenceExcluded: true,\n    marketRegimeBreadthConflictDisclosure: true,\n    sourceHealthVisible: true,",
    'market regime UI validation report',
  );

  fs.writeFileSync(file, source, 'utf8');
}

patchBuilder();
patchPolicy();
patchIndex();
patchApp();
patchStyles();
patchUiValidator();
console.log(JSON.stringify({
  patched: true,
  files: [
    'scripts/v20/build-integrated-decision-snapshot.cjs',
    'data/v20/policy-registry.json',
    'v20/index.html',
    'v20/app.js',
    'v20/styles.css',
    'scripts/v20/validate-ui.cjs',
  ],
  policySchemaVersion: '20.0.0-policy-registry-6',
  uiValidationSchemaVersion: '20.0.0-ui-validation-5',
}, null, 2));
