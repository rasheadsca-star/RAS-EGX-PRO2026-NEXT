'use strict';
const fs = require('fs');
const path = require('path');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function normalizeTicker(value) {
  return String(value || '').trim().toUpperCase();
}

function dailyRowsFromDataset(dataset) {
  const rows = [
    ...(dataset?.paperCandidates || []),
    ...(dataset?.watchCandidates || []),
    ...(dataset?.recommendations || []),
    ...(dataset?.selected || []),
    ...(dataset?.basket || []),
  ];
  return rows.map(row => ({
    ...row,
    ticker: normalizeTicker(row.ticker || row.symbol),
    sessionId: dataset?.sessionId || dataset?.marketDate || null,
    liveExecutionEnabled: dataset?.liveExecutionEnabled === true,
  })).filter(row => row.ticker);
}

function readDailyOutput(root) {
  const candidates = [
    'data/quant/daily-recommendations.json',
    'data/reports/daily/latest.json',
    'data/recommendations.json',
  ];
  for (const rel of candidates) {
    const full = path.join(root, rel);
    const json = readJson(full);
    const rows = dailyRowsFromDataset(json);
    if (rows.length) return { file: rel, dataset: json, rows };
  }
  return { file: null, dataset: null, rows: [] };
}

function readHistoricalIntelligence(root) {
  const rel = 'data/v17/historical-recovery/intelligence/current.json';
  const snapshot = readJson(path.join(root, rel), { decisions: [] });
  const byTicker = new Map((snapshot.decisions || []).map(row => [normalizeTicker(row.ticker), row]));
  const sharedHistoryDir = path.join(root, 'data/history');
  const inventoryTickers = new Set(fs.existsSync(sharedHistoryDir)
    ? fs.readdirSync(sharedHistoryDir).filter(file => file.endsWith('.json')).map(file => normalizeTicker(path.basename(file, '.json')))
    : []);
  return { file: rel, snapshot, byTicker, inventoryTickers };
}

function readPreviousBridge(root) {
  const rel = 'data/v17/investment-bridge/current.json';
  return { file: rel, dataset: readJson(path.join(root, rel), null) };
}

function readCurrentDailyCards(root) {
  const rel = 'data/v17/current.json';
  const dataset = readJson(path.join(root, rel), { recommendations: [] });
  return { file: rel, rows: dailyRowsFromDataset(dataset) };
}

module.exports = {
  readJson,
  writeJsonAtomic,
  normalizeTicker,
  dailyRowsFromDataset,
  readDailyOutput,
  readHistoricalIntelligence,
  readPreviousBridge,
  readCurrentDailyCards,
};
