'use strict';

const fs = require('fs');
const path = require('path');

function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}
function truthy(value) { return value === true || value === 'true'; }

const center = read('data/quant/unified-autonomous-center-v13-14.json', {});
const marketAcceptance = read('data/market-quality-acceptance-v13-17-1.json', {});
const marketQuality = read('data/market-quality-report.json', {});
const evidence = read('data/quant/strategy-health-v13-15.json', read('data/quant/strategy-health.json', read('data/evidence/strategy-health-v13-15.json', {})));
const policy = read('data/v13-17-1-production-policy.json', {});

const sessionIntegrity = truthy(center?.sessionIntegrity?.ok);
const analysisCurrent = truthy(center?.analysisCurrent);
const marketCurrent = truthy(center?.marketCurrent);
const centerStatus = String(center?.operationalStatus || center?.status || '').toUpperCase();
const finalized = centerStatus === 'CONFIRMED_LATEST_SESSION'
  && truthy(center?.finalizationCurrent)
  && truthy(center?.finalization?.targetPassed);
const marketExecutionGrade = truthy(marketAcceptance?.ok) && truthy(marketQuality?.executionGrade) && !truthy(marketQuality?.fallbackUsed);
const readyCandidate = center?.readyCandidate || center?.primaryCandidate || null;
const candidateReady = Boolean(readyCandidate
  && readyCandidate?.finalDecision?.actionable === true
  && readyCandidate?.finalDecision?.code === 'READY_FOR_PAPER_REVIEW'
  && readyCandidate?.strategyExecutable === true
  && Number(readyCandidate?.hardFailureCount || 0) === 0);
const evidenceGate = String(center?.evidence?.summary?.evidenceGate || evidence?.evidenceGate || evidence?.summary?.evidenceGate || 'RESEARCH_ONLY');
const evidenceAllowsExecutionReview = ['PAPER_GATE_PASSED', 'PAPER_READY', 'LIMITED_READY', 'READY_FOR_LIMITED_EXECUTION_REVIEW'].includes(evidenceGate);

const gates = {
  marketExecutionGrade,
  finalizedCurrentSession: finalized && analysisCurrent && marketCurrent,
  sessionIntegrity,
  candidateRiskGate: candidateReady,
  strategyEvidenceGate: evidenceAllowsExecutionReview
};
const failedGates = Object.entries(gates).filter(([, value]) => !value).map(([name]) => name);
const manualExecutionReviewReady = failedGates.length === 0;

const result = {
  version: '13.17.1',
  generatedAt: new Date().toISOString(),
  systemRole: policy.systemRole || 'production_decision_support',
  releaseChannel: policy.releaseChannel || 'production-gated',
  operational: true,
  operationalState: manualExecutionReviewReady ? 'READY_FOR_MANUAL_EXECUTION_REVIEW' : 'PRODUCTION_GATED',
  operationalLabelAr: manualExecutionReviewReady ? 'تشغيلي — مؤهل للمراجعة التنفيذية اليدوية' : 'تشغيلي — بوابات التنفيذ مغلقة',
  manualExecutionReviewReady,
  automaticBrokerOrders: false,
  manualBrokerConfirmationRequired: true,
  manualPriceVerificationRequired: true,
  gates,
  failedGates,
  evidenceGate,
  candidate: readyCandidate ? {
    ticker: readyCandidate.ticker,
    decision: readyCandidate.finalDecision?.code || null,
    decisionLabelAr: readyCandidate.finalDecision?.labelAr || null,
    tier: readyCandidate.tier || null
  } : null,
  warningAr: 'هذا إصدار تشغيلي لدعم القرار. لا يرسل أوامر شراء أو بيع تلقائيًا، ولا يصبح أي سهم قابلًا للمراجعة التنفيذية إلا بعد اجتياز جودة البيانات والجلسة والأدلة والمخاطر.'
};

write('data/production-readiness-v13-17-1.json', result);
console.log('V13.17.1 production gate', result);
