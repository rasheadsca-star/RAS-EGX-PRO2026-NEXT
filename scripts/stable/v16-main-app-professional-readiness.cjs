#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = relative => path.join(ROOT, relative);
const FILES = {
  snapshot: P('data/stable/v16-main-app-current.json'),
  priceTruth: P('data/stable/v15-price-truth.json'),
  basket: P('data/research/v16-v169-basket-engine.json'),
  live: P('data/stable/v16-v169-live-evaluation.json'),
  consensus: P('data/stable/v16-main-app-consensus.json'),
  consensusRegression: P('data/stable/v16-main-app-consensus-regression.json'),
  stack: P('data/stable/v16-main-app-stack-status.json'),
  analyzer: P('preview-v16/app/stock-analyzer.js'),
  chart: P('preview-v16/app/stock-analyzer-chart.js'),
  decisionUi: P('preview-v16/app/stock-analyzer-decision.js'),
  output: P('data/stable/v16-main-app-professional-readiness.json'),
};

const ENGINE = 'V16_9_EQUAL_WEIGHT_BASKET';
const MIN_LIVE_RESOLVED_SESSIONS = 20;
const MIN_WALK_FORWARD_SESSIONS = 30;

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clamp(value, min = 0, max = 100) { return Math.max(min, Math.min(max, value)); }
function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(n(value) * factor) / factor;
}
function pct(value) { return clamp(n(value)); }
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function fileExists(relative) { return fs.existsSync(P(relative)); }
function historyExists(ticker) { return Boolean(ticker) && fileExists(`data/history/${ticker}.json`); }

function axis(id, labelAr, weight, points, details, requirements = []) {
  const scorePct = weight > 0 ? clamp(points / weight * 100) : 0;
  return {
    id,
    labelAr,
    weight,
    points: round(points, 2),
    scorePct: round(scorePct, 1),
    details,
    requirements,
  };
}

function buildProfessionalReadiness() {
  const now = new Date().toISOString();
  const snap = readJson(FILES.snapshot, {});
  const price = readJson(FILES.priceTruth, {});
  const basket = readJson(FILES.basket, {});
  const live = readJson(FILES.live, {});
  const consensus = readJson(FILES.consensus, {});
  const consensusRegression = readJson(FILES.consensusRegression, {});
  const stack = readJson(FILES.stack, {});
  const analyzer = readText(FILES.analyzer);
  const chart = readText(FILES.chart);
  const decisionUi = readText(FILES.decisionUi);

  const tickers = (snap.recommendations || basket.currentBasket || [])
    .map(row => String(row?.ticker || '').trim().toUpperCase())
    .filter(Boolean);

  // AXIS 1 — Data & Session Integrity (25)
  const inputRows = Math.max(1, n(price?.source?.inputRows, 0));
  const acceptedRows = n(price.acceptedRows, 0);
  const acceptedRatioPct = clamp(acceptedRows / inputRows * 100);
  const sourceEvidencePct = pct(price?.source?.sourceSessionEvidenceCoveragePct ?? snap?.dataTruth?.sourceSessionEvidenceCoveragePct);
  const sessionAligned = snap?.governance?.sessionAligned === true
    && snap?.dataTruth?.marketSession
    && snap?.dataTruth?.decisionSession
    && snap.dataTruth.marketSession === snap.dataTruth.decisionSession;
  const executionGrade = price.executionGrade === true && snap?.dataTruth?.executionGrade === true;
  let dataPoints = 0;
  dataPoints += executionGrade ? 8 : 0;
  dataPoints += sessionAligned ? 6 : 0;
  dataPoints += 6 * sourceEvidencePct / 100;
  dataPoints += 5 * acceptedRatioPct / 100;
  const dataReq = [];
  if (!executionGrade) dataReq.push({ code: 'EXECUTION_GRADE', labelAr: 'اجتياز Execution Grade لبيانات الجلسة الحالية', hard: true });
  if (!sessionAligned) dataReq.push({ code: 'SESSION_ALIGNMENT', labelAr: 'تطابق جلسة السوق مع جلسة القرار', hard: true });
  if (sourceEvidencePct < 100) dataReq.push({ code: 'SOURCE_EVIDENCE_100', labelAr: `رفع تغطية إثبات جلسة المصدر من ${round(sourceEvidencePct,1)}% إلى 100%`, hard: false });
  if (acceptedRatioPct < 100) dataReq.push({ code: 'PRICE_ACCEPTANCE_100', labelAr: `تقليل الصفوف المرفوضة؛ المقبول حاليًا ${acceptedRows}/${inputRows}`, hard: false });
  const dataAxis = axis('DATA_SESSION_INTEGRITY', 'سلامة البيانات والجلسة', 25, dataPoints, {
    executionGrade,
    sessionAligned,
    sourceSessionEvidenceCoveragePct: round(sourceEvidencePct, 1),
    acceptedRows,
    inputRows,
    acceptedRatioPct: round(acceptedRatioPct, 1),
  }, dataReq);

  // AXIS 2 — V16.9 Walk-Forward Stability (25)
  const wf = basket.blockedWalkForwardMetrics || {};
  const wfSessions = n(wf.sessions, 0);
  const wfAvg = n(wf.averageNetReturnPct, 0);
  const wfPf = n(wf.profitFactor, 0);
  const wfWin = n(wf.sessionWinRatePct, 0);
  const wfDd = n(wf.maximumDrawdownPct, -100);
  const gate = basket.acceptanceGate || {};
  const gatePassed = basket.productionEligible === true && Object.values(gate).length > 0 && Object.values(gate).every(Boolean);
  let wfPoints = 0;
  wfPoints += Math.min(5, 5 * wfSessions / MIN_WALK_FORWARD_SESSIONS);
  wfPoints += wfAvg > 0 ? 4 : 0;
  wfPoints += wfPf >= 1.5 ? 4 : wfPf >= 1.2 ? 2.5 : 0;
  wfPoints += wfWin >= 50 ? 3 : wfWin >= 45 ? 2 : 0;
  wfPoints += wfDd >= -15 ? 4 : wfDd >= -20 ? 2 : 0;
  wfPoints += gatePassed ? 5 : 0;
  const wfReq = [];
  if (wfSessions < MIN_WALK_FORWARD_SESSIONS) wfReq.push({ code: 'WF_SAMPLE', labelAr: `استكمال Blocked Walk-Forward إلى ${MIN_WALK_FORWARD_SESSIONS} جلسة على الأقل؛ الحالي ${wfSessions}`, hard: true });
  if (wfAvg <= 0) wfReq.push({ code: 'WF_POSITIVE_RETURN', labelAr: 'إثبات متوسط عائد صافي موجب خارج العينة', hard: true });
  if (wfPf < 1.2) wfReq.push({ code: 'WF_PF', labelAr: 'Profit Factor خارج العينة ≥ 1.20', hard: true });
  if (wfWin < 45) wfReq.push({ code: 'WF_WIN_RATE', labelAr: 'نسبة جلسات رابحة خارج العينة ≥ 45%', hard: true });
  if (wfDd < -15) wfReq.push({ code: 'WF_DRAWDOWN', labelAr: 'Maximum Drawdown أفضل من -15%', hard: true });
  if (!gatePassed) wfReq.push({ code: 'WF_ACCEPTANCE_GATE', labelAr: 'اجتياز جميع بوابات قبول V16.9 التاريخية', hard: true });
  const wfAxis = axis('V169_WALK_FORWARD', 'ثبات V16.9 خارج العينة', 25, wfPoints, {
    sessions: wfSessions,
    minimumSessions: MIN_WALK_FORWARD_SESSIONS,
    averageNetReturnPct: round(wfAvg, 4),
    profitFactor: round(wfPf, 3),
    sessionWinRatePct: round(wfWin, 2),
    maximumDrawdownPct: round(wfDd, 3),
    acceptanceGatePassed: gatePassed,
  }, wfReq);

  // AXIS 3 — V16.9 live/forward evidence (25)
  const liveSummary = live.summary || {};
  const resolvedSessions = n(liveSummary.resolvedSessions, 0);
  const liveAvg = n(liveSummary.averageNetReturnPct, 0);
  const livePf = n(liveSummary.profitFactor, 0);
  const liveWin = n(liveSummary.winningSessionPct, 0);
  const liveDd = n(liveSummary.maximumDrawdownPct, -100);
  const liveSampleRatio = clamp(resolvedSessions / MIN_LIVE_RESOLVED_SESSIONS, 0, 1);
  let livePoints = 0;
  // Half of this axis is deliberately sample-size dependent. Strong early
  // returns cannot substitute for a sufficiently long forward/live record.
  livePoints += 12.5 * liveSampleRatio;
  livePoints += liveAvg > 0 ? 3.5 : 0;
  livePoints += livePf >= 1.2 ? 3.5 : 0;
  livePoints += liveWin >= 45 ? 2.5 : 0;
  livePoints += liveDd >= -15 ? 3 : 0;
  const liveGatePassed = resolvedSessions >= MIN_LIVE_RESOLVED_SESSIONS
    && liveAvg > 0 && livePf >= 1.2 && liveWin >= 45 && liveDd >= -15;
  const liveReq = [];
  if (resolvedSessions < MIN_LIVE_RESOLVED_SESSIONS) liveReq.push({
    code: 'LIVE_MIN_RESOLVED_SESSIONS',
    labelAr: `استكمال السجل الحي لـV16.9 إلى ${MIN_LIVE_RESOLVED_SESSIONS} جلسة محسومة؛ الحالي ${resolvedSessions} والمتبقي ${Math.max(0, MIN_LIVE_RESOLVED_SESSIONS - resolvedSessions)}`,
    hard: true,
  });
  if (liveAvg <= 0) liveReq.push({ code: 'LIVE_POSITIVE_RETURN', labelAr: 'متوسط عائد حي صافي موجب بعد التكاليف', hard: true });
  if (livePf < 1.2) liveReq.push({ code: 'LIVE_PF', labelAr: 'Profit Factor حي ≥ 1.20', hard: true });
  if (liveWin < 45) liveReq.push({ code: 'LIVE_WIN_RATE', labelAr: 'نسبة جلسات حية رابحة ≥ 45%', hard: true });
  if (liveDd < -15) liveReq.push({ code: 'LIVE_DRAWDOWN', labelAr: 'Maximum Drawdown حي أفضل من -15%', hard: true });
  const liveAxis = axis('V169_LIVE_FORWARD', 'السجل الحي / Forward لـV16.9', 25, livePoints, {
    resolvedSessions,
    minimumResolvedSessions: MIN_LIVE_RESOLVED_SESSIONS,
    sampleCompletionPct: round(liveSampleRatio * 100, 1),
    winningSessionPct: round(liveWin, 2),
    averageNetReturnPct: round(liveAvg, 4),
    profitFactor: round(livePf, 3),
    maximumDrawdownPct: round(liveDd, 3),
    promotionEligible: live.promotionEligible === true,
    hardGatePassed: liveGatePassed,
  }, liveReq);

  // AXIS 4 — Intelligence, explainability and recommendation review coverage (15)
  const analyzerTechnical = analyzer.includes('technicalAnalysis') && analyzer.includes('fibonacci') && analyzer.includes('portfolioDecision');
  const financialCapability = analyzer.includes('fundamentalScore') && analyzer.includes('trailingPE') && analyzer.includes('priceToBook');
  const newsCapability = analyzer.includes('newsSummary') && analyzer.includes('sentimentForTitle');
  const chartCapability = chart.includes('EMA20') && chart.includes('RSI(14)') && chart.includes('Fibonacci') && chart.includes('tc-wick');
  const decisionCapability = decisionUi.includes('مستوى إلغاء القرار') && decisionUi.includes('الهدف الأقرب');
  const historyCovered = tickers.filter(historyExists).length;
  const historyCoveragePct = tickers.length ? historyCovered / tickers.length * 100 : 0;
  const consensusCovered = Array.isArray(consensus?.current?.mainAppAnnotations)
    && consensus.current.mainAppAnnotations.length === tickers.length;
  const consensusRegressionPassed = consensusRegression.pass === true;
  const persistedIntelligence = fileExists('data/stable/v16-main-app-intelligence-snapshot.json');
  let intelligencePoints = 0;
  intelligencePoints += analyzerTechnical ? 2.5 : 0;
  intelligencePoints += chartCapability ? 2 : 0;
  intelligencePoints += decisionCapability ? 1.5 : 0;
  intelligencePoints += financialCapability ? 2 : 0;
  intelligencePoints += newsCapability ? 2 : 0;
  intelligencePoints += 2 * historyCoveragePct / 100;
  intelligencePoints += consensusCovered && consensusRegressionPassed ? 1 : 0;
  intelligencePoints += persistedIntelligence ? 2 : 0;
  const intelligenceReq = [];
  if (!analyzerTechnical) intelligenceReq.push({ code: 'TECH_ANALYZER', labelAr: 'اكتمال طبقة التحليل الفني/Fibonacci وإدارة المركز', hard: false });
  if (!financialCapability) intelligenceReq.push({ code: 'FINANCIAL_CAPABILITY', labelAr: 'اكتمال التحليل المالي داخل محلل السهم', hard: false });
  if (!newsCapability) intelligenceReq.push({ code: 'NEWS_CAPABILITY', labelAr: 'اكتمال تحليل الأخبار وتأثيرها', hard: false });
  if (historyCoveragePct < 100) intelligenceReq.push({ code: 'RECOMMENDATION_HISTORY_COVERAGE', labelAr: `تغطية تاريخ OHLCV لكل توصيات اليوم؛ الحالي ${historyCovered}/${tickers.length}`, hard: false });
  if (!consensusCovered || !consensusRegressionPassed) intelligenceReq.push({ code: 'CONSENSUS_REVIEW', labelAr: 'اكتمال مقارنة المحركات لكل توصيات MAIN APP مع Regression PASS', hard: false });
  if (!persistedIntelligence) intelligenceReq.push({
    code: 'AUDITABLE_INTELLIGENCE_SNAPSHOT',
    labelAr: 'أرشفة Snapshot مالي/إخباري موثق زمنيًا ومصدرًا لكل توصية بدل الاعتماد على الاستعلام الحي فقط',
    hard: false,
  });
  const intelligenceAxis = axis('INTELLIGENCE_EXPLAINABILITY', 'التحليل الشامل وقابلية التفسير', 15, intelligencePoints, {
    analyzerTechnical,
    chartCapability,
    decisionCapability,
    financialCapability,
    newsCapability,
    recommendationHistoryCoveragePct: round(historyCoveragePct, 1),
    consensusCovered,
    consensusRegressionPassed,
    persistedAuditableIntelligenceSnapshot: persistedIntelligence,
  }, intelligenceReq);

  // AXIS 5 — Risk governance and operational reliability (10)
  const engineLocked = snap?.governance?.activeEngine === ENGINE;
  const canonical = snap.canonicalSnapshot === true;
  const failClosed = snap?.governance?.failClosed === true;
  const immutableLedger = snap?.governance?.immutableLedger === true && snap?.immutableSignal?.ledgerConflict !== true;
  const allocationGuard = snap?.governance?.allocationGuardPassed === true && n(snap?.portfolioPolicy?.plannedAllocationPct, 999) <= 50.0001;
  const automaticOrdersDisabled = snap?.portfolioPolicy?.automaticOrders === false;
  const stackPass = stack.status === 'PASS' || (engineLocked && canonical && failClosed && immutableLedger && allocationGuard);
  let riskPoints = 0;
  riskPoints += engineLocked && canonical ? 2 : 0;
  riskPoints += failClosed ? 2 : 0;
  riskPoints += immutableLedger ? 2 : 0;
  riskPoints += allocationGuard ? 1.5 : 0;
  riskPoints += automaticOrdersDisabled ? 1.5 : 0;
  riskPoints += stackPass ? 1 : 0;
  const riskReq = [];
  if (!engineLocked || !canonical) riskReq.push({ code: 'ENGINE_CANONICAL_LOCK', labelAr: 'قفل MAIN APP على V16.9 وCanonical Snapshot واحد', hard: true });
  if (!failClosed) riskReq.push({ code: 'FAIL_CLOSED', labelAr: 'تفعيل Fail-Closed عند نقص أو تضارب البيانات', hard: true });
  if (!immutableLedger) riskReq.push({ code: 'IMMUTABLE_LEDGER', labelAr: 'عدم وجود تعارض في Immutable Signal Ledger', hard: true });
  if (!allocationGuard) riskReq.push({ code: 'ALLOCATION_GUARD', labelAr: 'اجتياز حد التعرض الأقصى 50%', hard: true });
  if (!automaticOrdersDisabled) riskReq.push({ code: 'NO_AUTOMATIC_ORDERS', labelAr: 'إبقاء الأوامر التلقائية معطلة في هذه المرحلة', hard: true });
  if (!stackPass) riskReq.push({ code: 'STACK_PASS', labelAr: 'نجاح اختبارات Stack/Regression التشغيلية', hard: true });
  const riskAxis = axis('RISK_GOVERNANCE', 'إدارة المخاطر والحوكمة', 10, riskPoints, {
    engineLocked,
    canonical,
    failClosed,
    immutableLedger,
    allocationGuard,
    plannedAllocationPct: round(n(snap?.portfolioPolicy?.plannedAllocationPct, 0), 4),
    automaticOrdersDisabled,
    stackPass,
  }, riskReq);

  const axes = [dataAxis, wfAxis, liveAxis, intelligenceAxis, riskAxis];
  const foundationScore = round(axes.reduce((sum, item) => sum + item.points, 0), 1);
  const criticalDataGate = executionGrade && sessionAligned;
  const historicalGate = wfReq.filter(item => item.hard).length === 0;
  const governanceGate = riskReq.filter(item => item.hard).length === 0;
  const professionalHardGates = {
    engineIsV169: engineLocked,
    dataAndSessionIntegrity: criticalDataGate,
    walkForwardEvidence: historicalGate,
    liveForwardMinimum: liveGatePassed,
    governanceAndRisk: governanceGate,
  };
  const hardGatePass = Object.values(professionalHardGates).every(Boolean);

  // A strong engineering foundation must not visually masquerade as a completed
  // professional evidence claim. Until the mandatory live/forward gate passes,
  // the professional score is capped below 80. Data or governance failure caps
  // it even lower.
  let professionalReadinessScore = foundationScore;
  let capReason = null;
  if (!engineLocked || !governanceGate) {
    professionalReadinessScore = Math.min(professionalReadinessScore, 39);
    capReason = 'ENGINE_OR_GOVERNANCE_HARD_GATE';
  } else if (!criticalDataGate) {
    professionalReadinessScore = Math.min(professionalReadinessScore, 59);
    capReason = 'DATA_SESSION_HARD_GATE';
  } else if (!historicalGate || !liveGatePassed) {
    professionalReadinessScore = Math.min(professionalReadinessScore, 79);
    capReason = !historicalGate ? 'WALK_FORWARD_HARD_GATE' : 'LIVE_FORWARD_HARD_GATE';
  }
  professionalReadinessScore = round(professionalReadinessScore, 0);

  const allRequirements = axes.flatMap(item => item.requirements.map(req => ({ ...req, axis: item.id })));
  const hardBlockers = allRequirements.filter(item => item.hard);
  const softGaps = allRequirements.filter(item => !item.hard);
  const professionalClaimAllowed = hardGatePass && professionalReadinessScore >= 90;
  const stage = professionalClaimAllowed
    ? 'PROFESSIONAL_READY'
    : professionalReadinessScore >= 70
      ? 'ADVANCED_PILOT'
      : professionalReadinessScore >= 50
        ? 'PILOT'
        : 'RESEARCH_ONLY';
  const stageAr = {
    PROFESSIONAL_READY: 'جاهز مهنيًا وفق البوابات الحالية',
    ADVANCED_PILOT: 'Pilot متقدم — الاعتماد المهني غير مكتمل',
    PILOT: 'Pilot — يحتاج أدلة إضافية',
    RESEARCH_ONLY: 'بحثي / مراجعة فقط',
  }[stage];

  const output = {
    schemaVersion: '16.9.2-professional-readiness-v2',
    generatedAt: now,
    engine: ENGINE,
    sessionDate: snap.sessionDate || basket.currentSignalDate || price.expectedSession || null,
    professionalReadinessScore,
    foundationQualityScore: foundationScore,
    stage,
    stageAr,
    professionalClaimAllowed,
    capReason,
    axes,
    hardGates: professionalHardGates,
    hardBlockers,
    softGaps,
    requirementsTo100: [...hardBlockers, ...softGaps],
    interpretation: {
      scoreMeaningAr: 'يقيس جاهزية MAIN APP التشغيلية والمهنية وجودة الأدلة، وليس احتمال نجاح التوصية القادمة.',
      accuracyMeaningAr: 'لا يرفع ترتيب الأسهم أو Alpha تلقائيًا. أي تغيير في الترتيب يتطلب Challenger/Ablation واختبارًا خارج العينة قبل الترقية.',
      qualityImpactAr: 'يرفع جودة التطبيق فعليًا عبر منع الادعاء المهني عند نقص البيانات أو السجل الحي، وإظهار الفجوات القابلة للقياس بدل درجة تجميلية.',
    },
    evidence: {
      priceTruthGeneratedAt: price.generatedAt || null,
      basketGeneratedAt: basket.generatedAt || null,
      liveGeneratedAt: live.generatedAt || null,
      canonicalSnapshotHash: snap.snapshotHash || null,
      consensusGeneratedAt: consensus.generatedAt || null,
      liveReleaseLock: live.releaseLock || null,
    },
  };
  output.readinessHash = sha({
    engine: output.engine,
    sessionDate: output.sessionDate,
    score: output.professionalReadinessScore,
    foundation: output.foundationQualityScore,
    axes: output.axes.map(item => ({ id: item.id, points: item.points, scorePct: item.scorePct })),
    hardGates: output.hardGates,
    requirements: output.requirementsTo100.map(item => item.code),
  });

  writeJsonAtomic(FILES.output, output);
  console.log(JSON.stringify({
    professionalReadinessScore: output.professionalReadinessScore,
    foundationQualityScore: output.foundationQualityScore,
    stage: output.stage,
    professionalClaimAllowed: output.professionalClaimAllowed,
    capReason: output.capReason,
    axes: output.axes.map(item => ({ id: item.id, scorePct: item.scorePct, points: item.points, weight: item.weight })),
    hardBlockers: output.hardBlockers.map(item => item.code),
    softGaps: output.softGaps.map(item => item.code),
  }, null, 2));
  return output;
}

if (require.main === module) buildProfessionalReadiness();
module.exports = { buildProfessionalReadiness };
