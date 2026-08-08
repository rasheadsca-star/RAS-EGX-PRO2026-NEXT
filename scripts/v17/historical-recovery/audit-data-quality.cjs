#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const output = read('data/v17/historical-recovery/current.json');
const actions = read('data/corporate-actions.json');
const approvals = read('data/history-adjustment-approval.json');
const actionSet = new Set((actions.candidates || []).map(row => row.ticker));
const approvalMap = new Map((approvals.items || []).map(row => [row.ticker, row]));
const codeMap = {
  stale_history: 'STALE_HISTORY', insufficient_history: 'INSUFFICIENT_HISTORY', corporate_action_review: 'CORPORATE_ACTION_REVIEW',
  missing_adjusted_close: 'MISSING_ADJUSTED_CLOSE', symbol_not_verified: 'SYMBOL_NOT_VERIFIED', split_like_discontinuity: 'ADJUSTMENT_ANOMALY',
};
const rows = output.results.filter(row => row.stage === 'DATA_REVIEW_REQUIRED').map(row => {
  const document = read(`data/history/${row.symbol}.json`);
  const sessions = Array.isArray(document.sessions) ? document.sessions : [];
  const adjusted = sessions.filter(item => item.adjustedClose !== null && item.adjustedClose !== undefined && item.adjustedClose !== '' && Number.isFinite(Number(item.adjustedClose)) && Number(item.adjustedClose) > 0).length;
  const reasons = [...new Set((row.reasons || []).map(reason => codeMap[String(reason).split(':')[0]] || 'OTHER'))];
  return {
    symbol: row.symbol,
    latestSessionDate: sessions.at(-1)?.date || null,
    sessionCount: sessions.length,
    adjustedCloseValidSessions: adjusted,
    adjustedCloseCoveragePct: sessions.length ? Number((adjusted / sessions.length * 100).toFixed(4)) : 0,
    symbolVerified: document.symbolVerified === true,
    staleStatus: reasons.includes('STALE_HISTORY'),
    sourceStaleFlag: document.staleData === true,
    updateFailed: document.updateFailed === true,
    corporateActionStatus: actionSet.has(row.symbol) ? 'REVIEW_REQUIRED' : 'NONE',
    adjustmentReviewStatus: approvalMap.has(row.symbol) ? (approvalMap.get(row.symbol).approved ? 'APPROVED' : 'NOT_APPROVED') : 'NOT_LISTED',
    exclusionReasons: reasons,
    rawReasons: row.reasons || [],
  };
});
const reasonCounts = Object.fromEntries(['STALE_HISTORY','INSUFFICIENT_HISTORY','CORPORATE_ACTION_REVIEW','MISSING_ADJUSTED_CLOSE','SYMBOL_NOT_VERIFIED','ADJUSTMENT_ANOMALY','OTHER'].map(code => [code, rows.filter(row => row.exclusionReasons.includes(code)).length]));
const combinationCounts = {};
for (const row of rows) { const key = row.exclusionReasons.slice().sort().join('+') || 'OTHER'; combinationCounts[key] = (combinationCounts[key] || 0) + 1; }
const audit = { schemaVersion: '17.0.0-short-window-data-review-audit-1', generatedAt: new Date().toISOString(), auditedOutputGeneratedAt: output.generatedAt, reviewedSymbols: rows.length, reasonCounts, combinationCounts, rows };
const dataDir = path.join(root, 'data/v17/historical-recovery');
fs.writeFileSync(path.join(dataDir, 'data-review-audit-before-fix.json'), `${JSON.stringify(audit, null, 2)}\n`);
const lines = ['# Short-window data-review audit before validity correction', '', `Reviewed symbols: ${rows.length}`, '', '## Reason frequencies', '', '| Reason | Count |', '|---|---:|', ...Object.entries(reasonCounts).map(([reason,count]) => `| ${reason} | ${count} |`), '', '## Symbol details', '', '| Symbol | Latest session | Sessions | Adjusted coverage | Verified | Stale | Corporate action | Adjustment review | Reasons |', '|---|---|---:|---:|---|---|---|---|---|', ...rows.map(row => `| ${row.symbol} | ${row.latestSessionDate || 'N/A'} | ${row.sessionCount} | ${row.adjustedCloseCoveragePct}% | ${row.symbolVerified} | ${row.staleStatus} | ${row.corporateActionStatus} | ${row.adjustmentReviewStatus} | ${row.exclusionReasons.join(', ')} |`)];
fs.writeFileSync(path.join(root, 'docs/v17/SHORT_WINDOW_DATA_REVIEW_AUDIT_BEFORE_FIX.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify({ reviewedSymbols: rows.length, reasonCounts, combinationCounts }, null, 2));
