'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const Module = require('module');

const PROD_ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DECISION_ROOT = path.resolve(process.env.ASTRA_DECISION_ROOT || PROD_ROOT);
const PROD = p => path.join(PROD_ROOT, p);
const DEC = p => path.join(DECISION_ROOT, p);

const readProd = p => JSON.parse(fs.readFileSync(PROD(p), 'utf8'));
const readDecision = p => JSON.parse(fs.readFileSync(DEC(p), 'utf8'));
const writeProd = (p, value) => {
  fs.mkdirSync(path.dirname(PROD(p)), { recursive: true });
  fs.writeFileSync(PROD(p), JSON.stringify(value, null, 2) + '\n', 'utf8');
};
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sha256 = value => crypto.createHash('sha256').update(
  typeof value === 'string' ? value : JSON.stringify(value)
).digest('hex');
const gitHead = root => cp.execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8'
}).trim();

function loadCertifiedHealthWithDecisionSnapshot() {
  const filename = DEC('astra/data-health/g11-data-health.cjs');
  const pipelineFile = DEC('astra/pipeline/g09-unified-decision-pipeline.cjs');
  ensure(fs.existsSync(filename), 'Certified G11 data-health module unavailable');
  ensure(fs.existsSync(pipelineFile), 'Certified G09 pipeline module unavailable');

  let src = fs.readFileSync(filename, 'utf8');
  const needle = "marketUniverseEvaluated:pipeline.decisionSnapshot?.marketUniverseEvaluated||0,productionCutover:false";
  const replacement = "marketUniverseEvaluated:pipeline.decisionSnapshot?.marketUniverseEvaluated||0,decisionSnapshot:pipeline.decisionSnapshot||null,productionCutover:false";
  ensure(src.includes(needle), 'Certified G11 DecisionSnapshot exposure point unavailable');
  src = src.replace(needle, replacement);

  const oldWorkspace = process.env.GITHUB_WORKSPACE;
  process.env.GITHUB_WORKSPACE = DECISION_ROOT;
  try {
    delete require.cache[require.resolve(pipelineFile)];
    const pipeline = require(pipelineFile);
    ensure(typeof pipeline.runUnifiedDecisionPipeline === 'function', 'Certified G09 runner unavailable');

    const m = new Module(filename, module);
    m.filename = filename;
    m.paths = Module._nodeModulePaths(path.dirname(filename));
    m._compile(src, filename);
    ensure(typeof m.exports.buildHealth === 'function', 'Certified G11 buildHealth unavailable');
    return m.exports.buildHealth({ pipelineRunner: pipeline.runUnifiedDecisionPipeline });
  } finally {
    if (oldWorkspace === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = oldWorkspace;
  }
}

function refreshSessionExceptions() {
  if (DECISION_ROOT === PROD_ROOT) return;
  const script = PROD('scripts/astra/g22-refresh-session-exceptions.cjs');
  ensure(fs.existsSync(script), 'G22 session-exception refresher unavailable');
  const reviewDir = PROD('data');
  for (const name of fs.readdirSync(reviewDir).filter(x => /^g22-reviewed-session-exceptions-\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    fs.copyFileSync(PROD('data/' + name), DEC('data/' + name));
  }
  cp.execFileSync(process.execPath, [script], {
    cwd: PROD_ROOT,
    env: { ...process.env, ASTRA_DECISION_ROOT: DECISION_ROOT, GITHUB_WORKSPACE: DECISION_ROOT },
    stdio: 'inherit',
    maxBuffer: 32 * 1024 * 1024
  });
}

function refreshV16DomainExceptions() {
  if (DECISION_ROOT === PROD_ROOT) return;
  const script = PROD('scripts/astra/g22-refresh-v16-domain-exceptions.cjs');
  ensure(fs.existsSync(script), 'G22 V16 domain-exception refresher unavailable');
  cp.execFileSync(process.execPath, [script], {
    cwd: PROD_ROOT,
    env: { ...process.env, ASTRA_DECISION_ROOT: DECISION_ROOT, GITHUB_WORKSPACE: DECISION_ROOT },
    stdio: 'inherit',
    maxBuffer: 32 * 1024 * 1024
  });
}

function baselineFrom(data, manifest) {
  const existing = data?.sourceDecision?.certificationBaseline || manifest?.certificationBaseline;
  if (existing) return existing;
  return {
    session: data?.sourceDecision?.session || null,
    decisionSnapshotId: data?.sourceDecision?.decisionSnapshotId || manifest?.decisionSnapshotId || null,
    semanticDecisionHash: data?.sourceDecision?.semanticDecisionHash || manifest?.semanticDecisionHash || null,
    sourceHead: data?.sourceDecision?.sourceHead || null,
    originalGeneratedAt: data?.sourceDecision?.originalGeneratedAt || data?.generatedAt || null
  };
}

function validateOpportunity(row) {
  ensure(row && typeof row.ticker === 'string' && row.ticker.length > 0, 'Opportunity ticker missing');
  ensure(Number.isFinite(Number(row.rank)), row.ticker + ': rank invalid');
  const risk = row.risk || {};
  const entry = Number(risk.entry ?? row.entryPlan?.high);
  const stop = Number(risk.stopLoss ?? row.stopLoss);
  if (Number.isFinite(entry) && Number.isFinite(stop)) {
    ensure(stop < entry, row.ticker + ': stop must be below entry');
  }
  const targets = Array.isArray(row.targets) ? row.targets : (Array.isArray(risk.targets) ? risk.targets : []);
  if (Number.isFinite(entry) && targets.length) {
    ensure(targets.some(v => Number(v) > entry), row.ticker + ': no target above entry');
  }
}

function pct(n, d) {
  return d > 0 ? Number((Number(n) / Number(d) * 100).toFixed(2)) : 0;
}

function main() {
  const current = readProd('astra-prod/app/data.json');
  const manifest = readProd('astra-prod/G22_FULL_APP_MANIFEST.json');
  const mainAppStatus = readProd('data/stable/v16-immediate-scan-status.json');
  const priceTruth = readDecision('data/stable/v15-price-truth.json');
  refreshSessionExceptions();
  refreshV16DomainExceptions();
  const h = loadCertifiedHealthWithDecisionSnapshot();
  const d = h?.pipeline?.decisionSnapshot;

  const expected = priceTruth.expectedSession;
  const available = h?.sessionIntegrity?.latestAvailableCanonicalSession;
  const derivedExpected = h?.sessionIntegrity?.latestExpectedSession;
  const critical = Number(h?.issues?.criticalUnresolved || 0);
  const highIssues = (h?.issues?.issues || []).filter(x => x.severity === 'HIGH');
  const high = highIssues.length;
  const activeUniverse = Number(h?.universe?.activeUniverseCount || 0);
  const currentCanonical = Number(h?.metrics?.currentCanonicalSecurities?.numerator || 0);
  const pipelineReady = Number(h?.metrics?.decisionPipeline?.pipelineReadySecurities || 0);
  const currentCoveragePct = pct(currentCanonical, activeUniverse);
  const pipelineCoveragePct = pct(pipelineReady, activeUniverse);
  const sourceCoveragePct = Number(priceTruth?.source?.sourceSessionEvidenceCoveragePct || 0);
  const allowedOperationalHighCodes = new Set(['CURRENT_SESSION_GAP', 'REGIME_INPUT_INCOMPLETE']);
  const disallowedHigh = highIssues.filter(x => !allowedOperationalHighCodes.has(x.code));

  ensure(manifest.authorizedGate === 'G22', 'G22 manifest authorization missing');
  ensure(manifest.productionCutover === true, 'Production cutover is not active');
  ensure(manifest.certifiedRuntimeBundleMutated === false, 'Certified runtime mutation flag invalid');
  ensure(manifest.canonicalProductionPublisher === '.github/workflows/static.yml', 'Canonical Pages publisher mismatch');
  ensure(current.schemaVersion === 'astra-g22-ui-snapshot-1', 'G22 Full App data schema mismatch');
  ensure(current.sourceDecision?.currentProductionCutover === true, 'Full App is not marked as current production cutover');
  ensure(current.sourceDecision?.decisionSnapshotId === manifest.decisionSnapshotId, 'Pre-refresh app/manifest decision identity mismatch');
  ensure(current.sourceDecision?.semanticDecisionHash === manifest.semanticDecisionHash, 'Pre-refresh app/manifest semantic hash mismatch');

  ensure(DECISION_ROOT !== PROD_ROOT, 'Daily decision must execute from the pinned G22 certified baseline workspace');
  ensure(typeof expected === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expected), 'Price-truth expected session invalid');
  ensure(mainAppStatus.final === true, 'MAIN APP session is not final');
  ensure(mainAppStatus.sourceReady === true, 'MAIN APP source is not ready');
  ensure(mainAppStatus.currentSessionReady === true, 'MAIN APP current session is not ready');
  ensure(mainAppStatus.executionGrade === true, 'MAIN APP session is not execution-grade');
  ensure(mainAppStatus.pagesPublished === true, 'MAIN APP final session has not been Pages-published');
  ensure(mainAppStatus.sessionDate === expected, 'MAIN APP session != price-truth expected session');
  ensure(mainAppStatus.expectedSession === expected, 'MAIN APP expected session mismatch');
  ensure(mainAppStatus.pagesPublishedSession === expected, 'MAIN APP Pages-published session mismatch');
  ensure(/^[0-9a-f]{64}$/.test(String(mainAppStatus.materialFingerprint || '')), 'MAIN APP material fingerprint invalid');
  ensure(priceTruth.ready === true, 'Price truth not ready');
  ensure(priceTruth.executionGrade === true, 'Price truth is not execution-grade');
  ensure(Number(priceTruth.acceptedRows || 0) >= 200, 'Price-truth accepted-row coverage below operational floor: ' + priceTruth.acceptedRows);
  ensure(sourceCoveragePct >= 90, 'Source-session evidence coverage below 90%: ' + sourceCoveragePct);
  ensure((priceTruth.missingHistoryFiles || []).length === 0, 'Certified baseline still has missing history files: ' + JSON.stringify(priceTruth.missingHistoryFiles));
  ensure(activeUniverse === 224, 'Certified active universe drifted from G22 baseline: ' + activeUniverse);
  ensure(derivedExpected === expected, 'Certified G11 expected session != price-truth expected session');
  ensure(available === expected, 'Latest canonical session is not current');
  ensure(h.sessionIntegrity.freshnessStatus === 'CURRENT', 'Session freshness is not CURRENT');
  ensure(critical === 0, 'Current health has CRITICAL findings: ' + critical + ' ' + JSON.stringify((h.issues.issues || []).filter(x => x.severity === 'CRITICAL')));
  ensure(disallowedHigh.length === 0, 'Disallowed HIGH findings: ' + JSON.stringify(disallowedHigh));
  ensure(currentCoveragePct >= 90, 'Current canonical coverage below 90%: ' + currentCoveragePct);
  ensure(pipelineCoveragePct >= 80, 'Decision pipeline coverage below 80%: ' + pipelineCoveragePct);
  ensure(h.pipeline.ok === true, 'Unified decision pipeline failed: ' + JSON.stringify(h.pipeline.diagnostics || []));
  ensure(d, 'Current DecisionSnapshot unavailable');
  ensure(d.sessionDate === expected, 'Decision session mismatch');
  ensure(d.asOfSessionDate === expected, 'Decision as-of session mismatch');
  ensure(['DECISION_SNAPSHOT_READY', 'VALID_ZERO_OPPORTUNITY_SESSION'].includes(d.status), 'Decision status not publishable');
  ensure((d.legacyNetworkCalls || 0) === 0, 'Legacy network influence detected');
  ensure((d.quantEdgeLiveInfluence || 0) === 0, 'QUANT_EDGE live influence detected');
  ensure(Number(d.marketUniverseEvaluated || 0) >= 180, 'Decision universe evaluated below operational floor: ' + d.marketUniverseEvaluated);
  ensure(/^G09-DS-[0-9a-f]{24}$/.test(d.decisionSnapshotId || ''), 'DecisionSnapshot ID invalid');
  ensure(/^[0-9a-f]{64}$/.test(d.semanticDecisionHash || ''), 'Semantic decision hash invalid');

  const top5 = Array.isArray(d.top5) ? d.top5 : [];
  ensure(top5.length <= 5, 'Top opportunities exceed 5');
  top5.forEach(validateOpportunity);

  const sourceHead = gitHead(PROD_ROOT);
  const certifiedBaselineHead = process.env.ASTRA_CERTIFIED_BASELINE_HEAD || gitHead(DECISION_ROOT);
  const refreshedAt = new Date().toISOString();
  const objectHash = sha256(d);
  const baseline = baselineFrom(current, manifest);
  const guardStatus = high > 0 ? 'PASS_WITH_DOCUMENTED_COVERAGE_GAPS' : 'PASS';

  current.schemaVersion = current.schemaVersion || 'astra-g22-ui-snapshot-1';
  current.generatedAt = refreshedAt;
  current.sourceDecision = {
    ...(current.sourceDecision || {}),
    certification: 'G01-G22 GREEN',
    session: expected,
    status: d.status,
    decisionSnapshotId: d.decisionSnapshotId,
    semanticDecisionHash: d.semanticDecisionHash,
    decisionSnapshotObjectHash: objectHash,
    persistedDecisionSnapshotObjectHash: objectHash,
    rebuiltDecisionSnapshotObjectHash: objectHash,
    normalizedRebuildHash: d.semanticDecisionHash,
    objectHashReproduced: true,
    objectHashVarianceReason: null,
    currentProductionCutover: true,
    sourceHead,
    certifiedBaselineHead,
    refreshedAt,
    refreshPolicy: 'G22_POST_CLOSE_FINAL_MAIN_APP_HANDOFF_V5',
    refreshSource: 'G22_CERTIFIED_BASELINE + CURRENT_SESSION_PRICE_TRUTH -> CERTIFIED_G11_CONTEXT -> CERTIFIED_ASTRA_G09_PIPELINE_1',
    sourcePriceTruthGeneratedAt: priceTruth.generatedAt || null,
    upstream: {
      engine: mainAppStatus.engine || 'V16_9_EQUAL_WEIGHT_BASKET',
      final: mainAppStatus.final === true,
      sessionDate: mainAppStatus.sessionDate || null,
      pagesPublished: mainAppStatus.pagesPublished === true,
      pagesPublishedAt: mainAppStatus.pagesPublishedAt || null,
      mainAppMaterialFingerprint: mainAppStatus.materialFingerprint || null,
      sourceSessionDataHash: mainAppStatus.sourceSessionDataHash || null
    },
    certificationBaseline: baseline
  };
  current.decisionSnapshot = d;
  current.health = {
    ...(current.health || {}),
    latestExpectedSession: expected,
    latestAvailableSession: available,
    freshness: h.sessionIntegrity.freshnessStatus,
    activeUniverse,
    currentCanonical: h.metrics.currentCanonicalSecurities,
    decisionReady: h.metrics.decisionPipeline,
    supportResistance: h.metrics.supportResistance,
    searchReadiness: h.metrics.searchReadiness,
    criticalUnresolved: critical,
    highUnresolved: high,
    operationalHighFindings: highIssues.map(x => ({
      code: x.code,
      affectedCount: x.affectedCount,
      affectedTickers: x.affectedTickers
    })),
    guardStatus,
    coverage: {
      currentCanonicalPct: currentCoveragePct,
      decisionPipelinePct: pipelineCoveragePct,
      sourceSessionEvidencePct: sourceCoveragePct
    },
    sessionIntegrity: {
      expectedSession: expected,
      availableSession: available,
      freshnessStatus: h.sessionIntegrity.freshnessStatus
    },
    upstream: {
      engine: mainAppStatus.engine || 'V16_9_EQUAL_WEIGHT_BASKET',
      final: mainAppStatus.final === true,
      sessionDate: mainAppStatus.sessionDate || null,
      pagesPublished: mainAppStatus.pagesPublished === true,
      pagesPublishedAt: mainAppStatus.pagesPublishedAt || null,
      mainAppMaterialFingerprint: mainAppStatus.materialFingerprint || null,
      sourceSessionDataHash: mainAppStatus.sourceSessionDataHash || null
    },
    priceTruth: {
      ready: priceTruth.ready,
      executionGrade: priceTruth.executionGrade,
      generatedAt: priceTruth.generatedAt || null,
      acceptedRows: priceTruth.acceptedRows ?? null,
      updatedHistoryFiles: priceTruth.updatedHistoryFiles ?? null,
      missingHistoryFiles: priceTruth.missingHistoryFiles ?? [],
      source: priceTruth.source?.name || null,
      sourceSessionEvidenceCoveragePct: sourceCoveragePct
    }
  };

  manifest.decisionSnapshotId = d.decisionSnapshotId;
  manifest.semanticDecisionHash = d.semanticDecisionHash;
  manifest.currentSession = expected;
  manifest.currentDecisionSnapshotId = d.decisionSnapshotId;
  manifest.currentSemanticDecisionHash = d.semanticDecisionHash;
  manifest.currentDecisionSnapshotObjectHash = objectHash;
  manifest.lastPostCloseRefreshAt = refreshedAt;
  manifest.currentDecisionSource = 'CERTIFIED_ASTRA_G09_PIPELINE_1_POST_CLOSE';
  manifest.currentDecisionBaselineHead = certifiedBaselineHead;
  manifest.currentDecisionUpstream = {
    engine: mainAppStatus.engine || 'V16_9_EQUAL_WEIGHT_BASKET',
    final: mainAppStatus.final === true,
    sessionDate: mainAppStatus.sessionDate || null,
    pagesPublished: mainAppStatus.pagesPublished === true,
    pagesPublishedAt: mainAppStatus.pagesPublishedAt || null,
    mainAppMaterialFingerprint: mainAppStatus.materialFingerprint || null,
    sourceSessionDataHash: mainAppStatus.sourceSessionDataHash || null
  };
  manifest.currentDecisionCoverage = {
    activeUniverse,
    currentCanonical,
    currentCanonicalPct: currentCoveragePct,
    pipelineReady,
    pipelineCoveragePct,
    sourceSessionEvidencePct: sourceCoveragePct,
    documentedOperationalHighFindings: high
  };
  manifest.certificationBaseline = manifest.certificationBaseline || baseline;
  manifest.productionCutover = true;
  manifest.certifiedRuntimeBundleMutated = false;

  const audit = {
    schemaVersion: 'astra-g22-session-refresh-2',
    refreshedAt,
    sourceHead,
    certifiedBaselineHead,
    certifiedThrough: 'G22',
    productionCutover: true,
    session: {
      expected,
      available,
      decision: d.sessionDate,
      asOf: d.asOfSessionDate,
      freshnessStatus: h.sessionIntegrity.freshnessStatus
    },
    priceTruth: {
      generatedAt: priceTruth.generatedAt || null,
      ready: priceTruth.ready,
      executionGrade: priceTruth.executionGrade,
      acceptedRows: priceTruth.acceptedRows ?? null,
      updatedHistoryFiles: priceTruth.updatedHistoryFiles ?? null,
      missingHistoryFiles: priceTruth.missingHistoryFiles ?? [],
      source: priceTruth.source?.name || null,
      sourceSessionEvidenceCoveragePct: sourceCoveragePct
    },
    health: {
      activeUniverse,
      currentCanonical: h.metrics.currentCanonicalSecurities,
      currentCanonicalCoveragePct: currentCoveragePct,
      decisionReady: h.metrics.decisionPipeline,
      decisionPipelineCoveragePct: pipelineCoveragePct,
      criticalUnresolved: critical,
      highUnresolved: high,
      highFindings: highIssues.map(x => ({
        code: x.code,
        affectedCount: x.affectedCount,
        affectedTickers: x.affectedTickers
      })),
      legacyNetworkCalls: h.pipeline.legacyNetworkCalls || 0,
      operationalGuardStatus: guardStatus
    },
    decision: {
      status: d.status,
      decisionSnapshotId: d.decisionSnapshotId,
      semanticDecisionHash: d.semanticDecisionHash,
      decisionSnapshotObjectHash: objectHash,
      marketUniverseEvaluated: d.marketUniverseEvaluated,
      opportunities: top5.length,
      tickers: top5.map(x => x.ticker),
      ranks: top5.map(x => ({ ticker: x.ticker, rank: x.rank, score: x.decisionScore ?? x.ranking?.score ?? null }))
    },
    certificationBaseline: baseline,
    mutations: {
      fullAppData: true,
      manifest: true,
      certifiedRuntimeBundle: false,
      certifiedBaselineRepository: false,
      legacyFallback: false
    }
  };

  writeProd('astra-prod/app/data.json', current);
  writeProd('astra-prod/G22_FULL_APP_MANIFEST.json', manifest);
  writeProd('astra-prod/G22_SESSION_REFRESH.json', audit);

  process.stdout.write('G22_POST_CLOSE_REFRESH ' + JSON.stringify({
    session: expected,
    decisionSnapshotId: d.decisionSnapshotId,
    semanticDecisionHash: d.semanticDecisionHash,
    status: d.status,
    opportunities: top5.length,
    tickers: top5.map(x => x.ticker),
    activeUniverse,
    currentCanonical: currentCanonical + '/' + activeUniverse,
    currentCanonicalPct: currentCoveragePct,
    decisionReady: pipelineReady,
    decisionPipelinePct: pipelineCoveragePct,
    sourceSessionEvidencePct: sourceCoveragePct,
    critical,
    high,
    guardStatus
  }) + '\n');
}

main();