'use strict';
const crypto = require('node:crypto');
const SOURCE = 'v16_session_aware_price_truth';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const tickerSort = (a,b) => a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function dateOf(row) { return String(row?.date || row?.sessionDate || '').slice(0, 10); }
function validDate(d) { return typeof d === 'string' && DATE.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d+'T00:00:00Z').toISOString().slice(0,10) === d; }
function acceptedManifest(rows) {
  if (!Array.isArray(rows)) throw new Error('INVALID_ACCEPTED_ROWS');
  const map = new Map();
  for (const row of rows) {
    if (!row?.ticker || !validDate(dateOf(row))) throw new Error('INVALID_ACCEPTED_ROW');
    if (map.has(row.ticker)) throw new Error('DUPLICATE_ACCEPTED_TICKER');
    map.set(row.ticker, { ticker: row.ticker, date: dateOf(row), rowSha256: hash(row) });
  }
  return [...map.values()].sort(tickerSort);
}
function evaluation({runId, expectedSession, sourceEligible, acceptedRows, accepted, rejected, missingHistory = []}) {
  if (!runId || !validDate(expectedSession) || !Number.isInteger(acceptedRows) || acceptedRows < 0
    || !Array.isArray(accepted) || !Array.isArray(rejected) || !Array.isArray(missingHistory)) throw new Error('INVALID_EVALUATION');
  const manifest=acceptedManifest(accepted);
  const missing=new Set();
  for(const ticker of missingHistory){
    if(typeof ticker!=='string'||!/^[A-Z0-9._-]+$/.test(ticker)||missing.has(ticker)||manifest.some(x=>x.ticker===ticker))throw new Error('INVALID_MISSING_HISTORY');
    missing.add(ticker);
  }
  if (manifest.length + missing.size !== acceptedRows || manifest.some(x=>x.date!==expectedSession)) throw new Error('MANIFEST_COUNT_OR_SESSION_MISMATCH');
  const rejectedMap=new Map();
  for(const entry of rejected) {
    if(!entry?.ticker || !entry?.reason || rejectedMap.has(entry.ticker) || manifest.some(x=>x.ticker===entry.ticker) || missing.has(entry.ticker))
      throw new Error('INVALID_REJECTED_ENTRY');
    rejectedMap.set(entry.ticker,entry.reason);
  }
  return {runId,expectedSession,sourceEligible:sourceEligible===true,acceptedRows,manifest,missingHistory:[...missing].sort(),
    manifestSha256:hash({runId,expectedSession,manifest,missingHistory:[...missing].sort()}),rejected:rejectedMap};
}
function reconcile({document,ticker,expectedSession,assessment,generatedAt}) {
  if(!validDate(expectedSession) || !ticker || !Array.isArray(document?.sessions)) throw new Error('INVALID_RECONCILIATION_INPUT');
  if(!assessment || assessment.expectedSession!==expectedSession || !assessment.runId || !(assessment.rejected instanceof Map)
    || !Array.isArray(assessment.manifest) || !Array.isArray(assessment.missingHistory) || assessment.manifest.length+assessment.missingHistory.length!==assessment.acceptedRows
    || assessment.manifestSha256!==hash({runId:assessment.runId,expectedSession,manifest:assessment.manifest,missingHistory:assessment.missingHistory}))
    throw new Error('INVALID_EVALUATION');
  // A failed/ineligible scan cannot quarantine existing historical candles.
  if(!assessment.sourceEligible) return {document,quarantined:[]};
  const reason=assessment.rejected.get(ticker);
  if(!reason) return {document,quarantined:[]}; // NOT_IN_MARKET and DROPPED are explicitly untouched.
  if(!generatedAt || Number.isNaN(Date.parse(generatedAt))) throw new Error('INVALID_GENERATED_AT');
  const quarantined=[];
  const sessions=document.sessions.filter(row=>{
    const affected=row?.source===SOURCE && dateOf(row)===expectedSession;
    if(affected) quarantined.push({ticker,session:expectedSession,rowSha256:hash(row),row,
      rejectionReason:reason,runId:assessment.runId});
    return !affected;
  });
  if(!quarantined.length) return {document,quarantined};
  const latest=sessions.at(-1)||null;
  return {document:{...document,sessions,availableSessions:sessions.length,
    firstSession:sessions.length?dateOf(sessions[0]):null,lastSession:latest?dateOf(latest):null,
    staleData:!latest||dateOf(latest)!==expectedSession,generatedAt,
    priceTruthLatest:latest?{date:dateOf(latest),close:latest.close,
      source:latest.primarySource||latest.source||null,validationStatus:latest.validationStatus||null,
      confidence:latest.confidence?.overall??null,sourceSessionDate:latest.sourceSessionDate||null}:null
  },quarantined};
}
function verifyManifest(manifest,historyByTicker) {
  if(!Array.isArray(manifest)) throw new Error('INVALID_MANIFEST');
  const seen=new Set();
  for(const entry of manifest) {
    if(!entry?.ticker||!validDate(entry.date)||!entry.rowSha256||seen.has(entry.ticker)) throw new Error('INVALID_MANIFEST_ENTRY');
    seen.add(entry.ticker);
    const sessions=historyByTicker[entry.ticker]?.sessions;
    if(!Array.isArray(sessions)) throw new Error('MANIFEST_HISTORY_HASH_MISMATCH:'+entry.ticker);
    const sameDate=sessions.filter(row=>dateOf(row)===entry.date);
    if(sameDate.length!==1 || hash(sameDate[0])!==entry.rowSha256) throw new Error('MANIFEST_HISTORY_HASH_MISMATCH:'+entry.ticker);
  }
  return true;
}
module.exports={SOURCE,hash,acceptedManifest,evaluation,reconcile,verifyManifest};
