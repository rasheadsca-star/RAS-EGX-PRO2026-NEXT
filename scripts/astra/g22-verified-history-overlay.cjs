'use strict';
// Restore observed historical inputs missing from the pinned runtime without
// manufacturing bars or changing the strategy. Execution-price certification is
// deliberately left to price truth and the independent-source gates.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const VALID_STATUSES = new Set(['single_source_validated','cross_verified_latest_close','precise_public_source_confirmed','precise_public_source_session_confirmed','historical_seed_single_source_validated','public_egx_database_exact_symbol_validated','starta_exact_egx_source_validated','g11_approved_current_source_validated']);
const PROVIDERS = {yahoo:['query1.finance.yahoo.com','query2.finance.yahoo.com'],mubasher_symbol_pages_precise_enriched:['english.mubasher.info','www.mubasher.info'],mubasher_symbol_pages:['english.mubasher.info','www.mubasher.info'],kaggle_yahoo_seed:['www.kaggle.com','kaggle.com'],starta_ohlc_api:['starta.46-224-223-172.sslip.io'],stockanalysis_egx_independent_session_confirmation:['stockanalysis.com']};
const KEYS = ['open', 'high', 'low', 'close', 'volume'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dateOf = row => String(row?.date || row?.sessionDate || '').slice(0, 10);
const numeric = value => typeof value !== 'boolean' && value !== null && !(typeof value === 'string' && value.trim() === '') && Number.isFinite(Number(value));
function validRow(row, ticker, expected) {
  const date = dateOf(row);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date || date > expected) return 'SESSION_INVALID_OR_FUTURE';
  if ([5,6].includes(new Date(date + 'T00:00:00Z').getUTCDay())) return 'NON_TRADING_WEEKDAY';
  if (row.ticker && row.ticker !== ticker) return 'ROW_IDENTITY_MISMATCH';
  if (!KEYS.every(key => Object.hasOwn(row, key) && numeric(row[key]))) return 'OBSERVED_OHLCV_REQUIRED';
  const [o,h,l,c,v] = KEYS.map(key => Number(row[key]));
  if (!(o > 0 && h > 0 && l > 0 && c > 0 && v >= 0 && h >= Math.max(o,c) && l <= Math.min(o,c))) return 'OHLCV_INVALID';
  if (v === 0 && o === h && h === l && l === c) return 'FLAT_ZERO_VOLUME_ROW';
  if (!VALID_STATUSES.has(row.validationStatus)) return 'SOURCE_VALIDATION_REQUIRED';
  if (/reconstruct|synthe|carry.?forward|fabricat|imput/i.test(JSON.stringify(row.warnings || []))) return 'UNOBSERVED_PRICE_WARNING';
  const provider = row.primarySource || row.source;
  let host; try { const url = new URL(row.sourceUrls?.primary); if (url.protocol !== 'https:') return 'SOURCE_LINEAGE_REQUIRED'; host = url.hostname; } catch { return 'SOURCE_LINEAGE_REQUIRED'; }
  if (!PROVIDERS[provider]?.includes(host)) return 'SOURCE_PROVIDER_NOT_RECOGNIZED';
  if (provider !== 'kaggle_yahoo_seed') {
    const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if (!new RegExp('(?:/|=)' + escaped + '(?:[./?&#]|$)','i').test(decodeURIComponent(row.sourceUrls.primary))) return 'SOURCE_URL_TICKER_MISMATCH';
  }
  if (row.sourceSessionDate && row.sourceSessionDate !== date) return 'SOURCE_SESSION_MISMATCH';
  return null;
}
function samePrices(a,b) { return KEYS.every(key => Number(a[key]) === Number(b[key])); }
function mergeHistory(target, source, ticker, expected) {
  const rejected = [], added = [], duplicateDates = new Set();
  if ((source?.exchange && source.exchange !== 'EGX') || (target?.exchange && target.exchange !== 'EGX') || source?.symbolVerified !== true || target?.symbolVerified !== true || source.ticker !== ticker || target.ticker !== ticker || (source.isin && target.isin && source.isin !== target.isin)) {
    return { document: target, added, rejected: [{ticker, reason:'IDENTITY_NOT_VERIFIED_OR_CONFLICT'}] };
  }
  const sourceDates = new Map();
  for (const row of source.sessions || []) {
    const date = dateOf(row);
    const previous = sourceDates.get(date);
    if (previous && !samePrices(previous,row)) duplicateDates.add(date);
    else if (!previous) sourceDates.set(date,row);
  }
  const dates = new Map((target.sessions || []).map(row => [dateOf(row),row]));
  for (const [date,row] of sourceDates) {
    const reason = duplicateDates.has(date) ? 'CONFLICTING_SOURCE_DUPLICATE' : validRow(row,ticker,expected);
    if (reason) { rejected.push({ticker,date,reason}); continue; }
    if (dates.has(date)) {
      if (!samePrices(dates.get(date),row)) rejected.push({ticker,date,reason:'PINNED_SOURCE_PRICE_CONFLICT'});
      continue;
    }
    dates.set(date,JSON.parse(JSON.stringify(row))); added.push(date);
  }
  const sessions = [...dates.values()].sort((a,b) => dateOf(a).localeCompare(dateOf(b)));
  // Preserve source identities, validation statuses and URLs verbatim.
  const document = {...target,sessions,availableSessions:sessions.length,firstSession:dateOf(sessions[0]),lastSession:dateOf(sessions.at(-1))};
  return {document,added,rejected};
}
function overlay(sourceRoot,targetRoot,expected) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new Error('Expected session is required');
  if (path.resolve(sourceRoot) === path.resolve(targetRoot)) throw new Error('Separate pinned runtime workspace required');
  const report = {schemaVersion:'g22-verified-history-overlay-1',session:expected,executionCertification:false,identityMethods:{EXACT_MATCHING_ISIN:0,VERIFIED_TICKER_PINNED_IDENTITY:0},missingSourceIsin:0,addedRows:0,changedTickers:[],rejected:[],sourceHashes:{}};
  const sourceDir = path.join(sourceRoot,'data/history'), targetDir = path.join(targetRoot,'data/history');
  for (const name of fs.readdirSync(sourceDir).filter(name => name.endsWith('.json')).sort()) {
    const ticker=name.slice(0,-5), targetPath=path.join(targetDir,name);
    if (!fs.existsSync(targetPath)) {report.rejected.push({ticker,reason:'PINNED_IDENTITY_MISSING'});continue;}
    const source=JSON.parse(fs.readFileSync(path.join(sourceDir,name),'utf8')), target=JSON.parse(fs.readFileSync(targetPath,'utf8'));
    const result=mergeHistory(target,source,ticker,expected);
    if (source?.symbolVerified === true && target?.symbolVerified === true && source.ticker === ticker && target.ticker === ticker) {
      const exact = Boolean(source.isin && target.isin && source.isin === target.isin);
      report.identityMethods[exact ? 'EXACT_MATCHING_ISIN' : 'VERIFIED_TICKER_PINNED_IDENTITY']++;
      if (!source.isin) report.missingSourceIsin++;
    }
    report.rejected.push(...result.rejected);
    report.sourceHashes[ticker]=digest(source);
    if (!result.added.length) continue;
    fs.writeFileSync(targetPath,JSON.stringify(result.document,null,2)+'\n');
    report.addedRows+=result.added.length;report.changedTickers.push({ticker,rows:result.added.length,first:result.added[0],last:result.added.at(-1)});
  }
  report.materialHash=digest(report);
  return report;
}
if (require.main === module) {
  const source=process.env.PROD_DATA_ROOT, target=process.env.CERT_ROOT;
  if (!source || !target) throw new Error('PROD_DATA_ROOT and CERT_ROOT required');
  const expected=JSON.parse(fs.readFileSync(path.join(source,'data/stable/v15-price-truth.json'),'utf8')).expectedSession;
  const report=overlay(source,target,expected);
  const output=process.env.G22_HISTORY_OVERLAY_REPORT || path.join(process.cwd(),'artifacts/history-recovery/g22-verified-history-overlay.json');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log('G22_VERIFIED_HISTORY_OVERLAY',JSON.stringify({session:expected,addedRows:report.addedRows,changedTickers:report.changedTickers.length,rejections:report.rejected.length,materialHash:report.materialHash}));
}
module.exports={validRow,mergeHistory,overlay};
