'use strict';
const crypto = require('crypto');
const { DECISION_RANK, LABELS_AR } = require('./integrated-model.cjs');

function decisionFingerprint(row) {
  return crypto.createHash('sha256').update(JSON.stringify({
    ticker: row.ticker,
    classificationCode: row.classificationCode,
    investmentResearchScore: row.investmentResearchScore,
    risk: row.risk?.classification,
    recoveryStage: row.technical?.recoveryStage,
    dataCompleteness: row.dataCompleteness,
    evidenceReferences: row.evidenceReferences,
  })).digest('hex');
}

function stabilizeDecision(current, previous, options = {}) {
  if (!previous) return { ...current, hysteresisApplied: false };
  const threshold = Number(options.minimumScoreDelta ?? 5);
  const currentScore = Number(current.investmentResearchScore);
  const previousScore = Number(previous.investmentResearchScore);
  const scoreDelta = Number.isFinite(currentScore) && Number.isFinite(previousScore) ? currentScore - previousScore : null;
  const materialEvidence = current.severeVerifiedNegativeEvent
    || current.dataCompleteness !== previous.dataCompleteness
    || current.risk?.classification !== previous.risk?.classification
    || current.technical?.recoveryStage !== previous.technical?.recoveryStage;
  const rankDelta = Math.abs((DECISION_RANK[current.classificationCode] || 99) - (DECISION_RANK[previous.classificationCode] || 99));
  if (current.classificationCode !== previous.classificationCode && rankDelta === 1 && !materialEvidence && scoreDelta !== null && Math.abs(scoreDelta) < threshold) {
    return {
      ...current,
      classificationCode: previous.classificationCode,
      classificationAr: previous.classificationAr || LABELS_AR[previous.classificationCode],
      classificationReasonsAr: [...current.classificationReasonsAr, `تم تثبيت التصنيف لأن تغير الدرجة ${Math.abs(scoreDelta).toFixed(1)} نقطة فقط ولم يظهر دليل جوهري جديد.`],
      hysteresisApplied: true,
    };
  }
  return { ...current, hysteresisApplied: false };
}

function describeChange(previous, current) {
  if (!previous) return { changed: false, types: [], reasonsAr: ['هذه أول لقطة قرار متكامل للسهم.'] };
  const types = [];
  const reasonsAr = [];
  const oldRank = DECISION_RANK[previous.classificationCode] || 99;
  const newRank = DECISION_RANK[current.classificationCode] || 99;
  if (newRank < oldRank) { types.push('CLASSIFICATION_UPGRADE'); reasonsAr.push('ارتفع التصنيف البحثي بعد عبور بوابة جوهرية.'); }
  if (newRank > oldRank) { types.push('CLASSIFICATION_DOWNGRADE'); reasonsAr.push('انخفض التصنيف البحثي بسبب تغير جوهري في الأدلة أو اكتمالها.'); }
  if (current.risk?.classification !== previous.risk?.classification) {
    const riskRank = { UNAVAILABLE: 0, RELATIVELY_LOW: 1, MEDIUM: 2, HIGH: 3, VERY_HIGH: 4 };
    if ((riskRank[current.risk?.classification] || 0) > (riskRank[previous.risk?.classification] || 0)) { types.push('RISK_INCREASE'); reasonsAr.push('ارتفع مستوى المخاطرة المالية.'); }
    else { types.push('RISK_DECREASE'); reasonsAr.push('انخفض مستوى المخاطرة المالية.'); }
  }
  if (current.technical?.recoveryStage !== previous.technical?.recoveryStage) {
    types.push('TECHNICAL_CHANGE');
    reasonsAr.push('تغيرت مرحلة التعافي الفنية.');
  }
  const currentPrice = Number(current.historical?.current);
  const priorTrough = Number(previous.historical?.postPeakLow);
  if (Number.isFinite(currentPrice) && Number.isFinite(priorTrough) && currentPrice < priorTrough) {
    types.push('BREAK_BELOW_POST_PEAK_TROUGH');
    reasonsAr.push('كسر السعر قاع دورة الهبوط المسجل في المراجعة السابقة.');
  }
  if (current.dataCompleteness !== previous.dataCompleteness) {
    types.push(current.overallDataConfidence >= previous.overallDataConfidence ? 'DATA_QUALITY_IMPROVED' : 'DATA_QUALITY_DETERIORATED');
    reasonsAr.push('تغير مستوى اكتمال أو موثوقية البيانات.');
  }
  if (current.severeVerifiedNegativeEvent && !previous.severeVerifiedNegativeEvent) {
    types.push('MATERIAL_NEGATIVE_NEWS');
    reasonsAr.push('ظهر حدث سلبي رسمي وجوهري جديد.');
  }
  return { changed: types.length > 0, types, reasonsAr };
}

function buildDecisionSnapshot(rows, previousSnapshot = null, changedAt = new Date(), options = {}) {
  const previousByTicker = new Map((previousSnapshot?.decisions || []).map(row => [row.ticker, row]));
  const decisions = rows.map(raw => {
    const previousEntry = previousByTicker.get(raw.ticker) || null;
    const previous = previousEntry?.detail ? {
      ...previousEntry.detail,
      classificationCode: previousEntry.currentDecision,
      classificationAr: previousEntry.currentDecisionAr,
      investmentResearchScore: previousEntry.investmentResearchScore,
      risk: previousEntry.risk,
    } : previousEntry;
    const current = stabilizeDecision(raw, previous, options);
    const delta = describeChange(previous, current);
    return {
      ticker: current.ticker,
      previousDecision: previous ? previous.classificationCode : null,
      previousDecisionAr: previous ? previous.classificationAr : null,
      currentDecision: current.classificationCode,
      currentDecisionAr: current.classificationAr,
      investmentResearchScore: current.investmentResearchScore,
      risk: current.risk,
      scores: {
        fundamentalQuality: current.fundamental?.fundamentalQualityScore ?? null,
        valuation: current.fundamental?.valuation?.score ?? null,
        recovery: current.technical?.recoveryScore ?? null,
        strength: current.technical?.strengthScore ?? null,
        newsImpact: current.news?.newsImpactScore ?? null,
        overallDataConfidence: current.overallDataConfidence,
      },
      changedAt: delta.changed ? changedAt.toISOString() : null,
      decisionChanged: delta.changed,
      changeTypes: delta.types,
      changeReasonsAr: delta.reasonsAr,
      evidenceReferences: current.evidenceReferences,
      fingerprint: decisionFingerprint(current),
      hysteresisApplied: current.hysteresisApplied,
      detail: current,
    };
  });
  return {
    schemaVersion: '17.4.0-decision-snapshot-1',
    snapshotId: changedAt.toISOString().replace(/[:.]/g, '-'),
    generatedAt: changedAt.toISOString(),
    immutable: true,
    previousSnapshotId: previousSnapshot?.snapshotId || null,
    decisions,
  };
}

module.exports = { decisionFingerprint, stabilizeDecision, describeChange, buildDecisionSnapshot };
