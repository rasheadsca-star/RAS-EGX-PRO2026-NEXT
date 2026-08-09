'use strict';
const crypto = require('crypto');

const LEVELS_AR = Object.freeze({ INFO: 'معلومة', NOTICE: 'تنبيه', IMPORTANT: 'تنبيه مهم', CRITICAL: 'تنبيه حرج' });

function alertFingerprint(ticker, type, evidenceKey = '') {
  return crypto.createHash('sha256').update(`${ticker}:${type}:${evidenceKey}`).digest('hex').slice(0, 24);
}

function severityFor(decision) {
  if (decision.changeTypes.includes('MATERIAL_NEGATIVE_NEWS') || decision.changeTypes.includes('BREAK_BELOW_POST_PEAK_TROUGH') || decision.risk?.classification === 'VERY_HIGH') return 'CRITICAL';
  if (decision.changeTypes.includes('CLASSIFICATION_DOWNGRADE') || decision.changeTypes.includes('RISK_INCREASE')) return 'IMPORTANT';
  if (decision.changeTypes.includes('CLASSIFICATION_UPGRADE') || decision.changeTypes.includes('DATA_QUALITY_DETERIORATED')) return 'NOTICE';
  return 'INFO';
}

function buildAlerts(snapshot, previousAlertState = null) {
  const prior = new Map((previousAlertState?.alerts || []).map(alert => [alert.fingerprint, alert]));
  const candidates = [];
  for (const decision of snapshot.decisions.filter(row => row.decisionChanged)) {
    for (const type of decision.changeTypes) {
      const evidenceKey = `${decision.currentDecision}:${decision.risk?.classification || 'UNAVAILABLE'}`;
      const fingerprint = alertFingerprint(decision.ticker, type, evidenceKey);
      const severity = severityFor(decision);
      const old = prior.get(fingerprint);
      if (old && old.severity === severity) continue;
      candidates.push({
        fingerprint,
        ticker: decision.ticker,
        type,
        severity,
        severityAr: LEVELS_AR[severity],
        createdAt: snapshot.generatedAt,
        decisionAr: decision.currentDecisionAr,
        explanationAr: decision.changeReasonsAr.join(' '),
        evidenceReferences: decision.evidenceReferences,
        state: 'ACTIVE',
      });
    }
  }
  return {
    schemaVersion: '17.4.0-alerts-1',
    generatedAt: snapshot.generatedAt,
    alerts: [...candidates, ...(previousAlertState?.alerts || [])].slice(0, 500),
    newAlertCount: candidates.length,
    criticalNewCount: candidates.filter(x => x.severity === 'CRITICAL').length,
  };
}

module.exports = { LEVELS_AR, alertFingerprint, severityFor, buildAlerts };
