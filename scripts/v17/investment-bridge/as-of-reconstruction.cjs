'use strict';
const fs = require('fs');
const path = require('path');

function dateOnly(value) { return String(value || '').slice(0, 10); }
function loadHistory(root, ticker) {
  const file = path.join(root, 'data/history', `${String(ticker).toUpperCase()}.json`);
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, 'utf8')).sessions || []).slice().sort((a, b) => dateOnly(a.date).localeCompare(dateOnly(b.date)));
}
function reconstructExecutionAsOf(row, sessions, asOfDate) {
  const signalDate = dateOnly(row.signalDate || row.date || row.sessionId);
  const cutoff = dateOnly(asOfDate);
  const future = sessions.filter(x => dateOnly(x.date) > signalDate && dateOnly(x.date) <= cutoff);
  const first = future[0];
  if (!first) return { ...row, executionStatus: 'AWAITING_SESSION', executed: false, actualExecutionPrice: null, executionEvidenceDate: null, reconstructedAsOf: cutoff };
  const low = Number(row.entryLow ?? row.plan?.entryLow), high = Number(row.entryHigh ?? row.plan?.entryHigh), stop = Number(row.stop ?? row.stopLoss ?? row.plan?.stopLoss);
  if (![low, high].every(Number.isFinite)) return { ...row, executionStatus: 'EXECUTION_UNVERIFIED', executed: false, actualExecutionPrice: null, executionEvidenceDate: first.date, reconstructedAsOf: cutoff };
  if (Number(first.open) > high) return { ...row, executionStatus: 'KEEP_CASH', executed: false, actualExecutionPrice: null, executionEvidenceDate: first.date, reconstructedAsOf: cutoff };
  if (Number.isFinite(stop) && Number(first.open) < stop) return { ...row, executionStatus: 'KEEP_CASH', executed: false, actualExecutionPrice: null, executionEvidenceDate: first.date, reconstructedAsOf: cutoff };
  let price = Number(first.open);
  if (price < low) {
    if (Number(first.high) < low) return { ...row, executionStatus: 'UNFILLED', executed: false, actualExecutionPrice: null, executionEvidenceDate: first.date, reconstructedAsOf: cutoff };
    price = low;
  }
  if (Number(first.low) > high || Number(first.high) < low) return { ...row, executionStatus: 'UNFILLED', executed: false, actualExecutionPrice: null, executionEvidenceDate: first.date, reconstructedAsOf: cutoff };
  return { ...row, executionStatus: 'EXECUTED', executed: true, actualExecutionPrice: price, executionEvidenceDate: first.date, reconstructedAsOf: cutoff };
}
function reconstructDailyRowsAsOf(root, rows, asOfDate) {
  return rows.map(row => reconstructExecutionAsOf(row, loadHistory(root, row.ticker), asOfDate));
}
module.exports = { dateOnly, loadHistory, reconstructExecutionAsOf, reconstructDailyRowsAsOf };
