/* EGX Pro V13.17.1 — Production Data Gateway
 * Fetch -> sanitize -> OHLC integrity gate -> atomic snapshot -> last-good fallback.
 * This gateway never promotes a snapshot based on row count alone.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const RUN_AT = new Date().toISOString();
const FULL_ROWS = Number(process.env.EGX_GATEWAY_FULL_ROWS || 180);
const CONDITIONAL_ROWS = Number(process.env.EGX_GATEWAY_CONDITIONAL_ROWS || 100);
const UNIVERSE = Number(process.env.EGX_EXPECTED_UNIVERSE || 224);
const MIN_PRICE_VALID_PCT = Number(process.env.EGX_GATEWAY_MIN_PRICE_VALID_PCT || 98);
const MIN_OHLC_VALID_PCT = Number(process.env.EGX_GATEWAY_MIN_OHLC_VALID_PCT || 80);
const MIN_PARTIAL_OHLC_VALID_PCT = Number(process.env.EGX_GATEWAY_MIN_PARTIAL_OHLC_VALID_PCT || 65);
const MAX_LAST_GOOD_AGE_MINUTES = Number(process.env.EGX_GATEWAY_MAX_LAST_GOOD_AGE_MINUTES || 10080);

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function rowsOf(value) { return Array.isArray(value?.rows) ? value.rows : []; }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function positive(value) { const number = finite(value); return number !== null && number > 0 ? number : null; }
function pct(part, total) { return total ? Number((part / total * 100).toFixed(2)) : 0; }
function ageMinutes(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? Number(((Date.now() - date.getTime()) / 60000).toFixed(1)) : null;
}
function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, part) => (acc[part.type] = part.value, acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function symbolOf(row) {
  return String(row?.symbol || row?.ticker || '').trim().toUpperCase();
}

function inspectRow(row) {
  const price = positive(row?.price ?? row?.last ?? row?.close);
  const open = positive(row?.open);
  const high = positive(row?.high);
  const low = positive(row?.low);
  const previousClose = positive(row?.previousClose);
  const volume = finite(row?.volume);
  const eps = price ? Math.max(price * 1e-6, 1e-9) : 1e-9;
  const ohlcComplete = Boolean(price && open && high && low);
  const ohlcValid = Boolean(ohlcComplete && high + eps >= Math.max(price, open, low) && low - eps <= Math.min(price, open, high));
  const previousCloseValid = previousClose === null || (price && previousClose / price >= 0.2 && previousClose / price <= 5);
  const volumeValid = volume === null || volume >= 0;
  const reasons = [];
  if (!symbolOf(row)) reasons.push('missing_symbol');
  if (!price) reasons.push('invalid_price');
  if (ohlcComplete && !ohlcValid) reasons.push('invalid_ohlc_relation');
  if (!previousCloseValid) reasons.push('implausible_previous_close');
  if (!volumeValid) reasons.push('negative_volume');
  return { price, open, high, low, previousClose, volume, ohlcComplete, ohlcValid, previousCloseValid, volumeValid, reasons };
}

function sanitizeRow(row) {
  const inspection = inspectRow(row);
  if (!inspection.price || !symbolOf(row)) return null;
  const clean = { ...row, symbol: symbolOf(row), price: inspection.price, last: inspection.price };
  if (!inspection.ohlcValid) {
    clean.open = null;
    clean.high = null;
    clean.low = null;
    clean.ohlcQuality = inspection.ohlcComplete ? 'INVALID_REMOVED' : 'INCOMPLETE';
  } else {
    clean.open = inspection.open;
    clean.high = inspection.high;
    clean.low = inspection.low;
    clean.ohlcQuality = 'VALID';
  }
  clean.previousClose = inspection.previousCloseValid ? inspection.previousClose : null;
  if (!inspection.volumeValid) clean.volume = null;
  clean.marketDataQualityVersion = '13.17.1';
  return clean;
}

function uniqueRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const clean = sanitizeRow(row);
    if (!clean) continue;
    const symbol = symbolOf(clean);
    if (!map.has(symbol)) map.set(symbol, clean);
  }
  return [...map.values()];
}

function qualityOf(rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const seen = new Set();
  let duplicateSymbols = 0;
  let priceValidRows = 0;
  let ohlcCompleteRows = 0;
  let ohlcValidRows = 0;
  let invalidOhlcRows = 0;
  let invalidPreviousCloseRows = 0;
  let invalidVolumeRows = 0;
  const invalidExamples = [];
  for (const row of rows) {
    const symbol = symbolOf(row);
    if (symbol && seen.has(symbol)) duplicateSymbols += 1;
    if (symbol) seen.add(symbol);
    const inspection = inspectRow(row);
    if (inspection.price) priceValidRows += 1;
    if (inspection.ohlcComplete) ohlcCompleteRows += 1;
    if (inspection.ohlcValid) ohlcValidRows += 1;
    if (inspection.ohlcComplete && !inspection.ohlcValid) invalidOhlcRows += 1;
    if (!inspection.previousCloseValid) invalidPreviousCloseRows += 1;
    if (!inspection.volumeValid) invalidVolumeRows += 1;
    if (inspection.reasons.length && invalidExamples.length < 25) invalidExamples.push({ symbol, reasons: inspection.reasons, price: row?.price ?? row?.last, open: row?.open, high: row?.high, low: row?.low });
  }
  return {
    totalRows: rows.length,
    uniqueSymbols: seen.size,
    duplicateSymbols,
    priceValidRows,
    priceValidPct: pct(priceValidRows, rows.length),
    ohlcCompleteRows,
    ohlcValidRows,
    ohlcValidPct: pct(ohlcValidRows, Math.max(priceValidRows, 1)),
    invalidOhlcRows,
    invalidPreviousCloseRows,
    invalidVolumeRows,
    invalidExamples
  };
}

function classify(quality, realFetch) {
  const full = realFetch && quality.uniqueSymbols >= FULL_ROWS && quality.priceValidPct >= MIN_PRICE_VALID_PCT && quality.ohlcValidPct >= MIN_OHLC_VALID_PCT && quality.invalidOhlcRows === 0;
  const partial = realFetch && quality.uniqueSymbols >= CONDITIONAL_ROWS && quality.priceValidPct >= MIN_PRICE_VALID_PCT && quality.ohlcValidPct >= MIN_PARTIAL_OHLC_VALID_PCT && quality.invalidOhlcRows === 0;
  if (full) return { accepted: true, executionGrade: true, status: 'accepted_execution_grade', level: 'ok' };
  if (partial) return { accepted: true, executionGrade: false, status: 'accepted_operational_partial', level: 'warn' };
  return { accepted: false, executionGrade: false, status: 'rejected_quality_or_coverage', level: 'bad' };
}

function sourceName(fetchReport, fetchStatus, sourceHealth) {
  return fetchReport.sourceName || fetchStatus.sourceName || sourceHealth.sourceName || fetchReport.mode || fetchStatus.mode || 'unknown';
}

function validLastGood(snapshot) {
  if (!snapshot || !rowsOf(snapshot).length) return { valid: false, reason: 'missing_snapshot', quality: qualityOf([]), age: null };
  const quality = qualityOf(rowsOf(snapshot));
  const age = ageMinutes(snapshot.updatedAt || snapshot.generatedAt);
  const valid = quality.uniqueSymbols >= CONDITIONAL_ROWS && quality.priceValidPct >= MIN_PRICE_VALID_PCT && quality.invalidOhlcRows === 0 && quality.ohlcValidPct >= MIN_PARTIAL_OHLC_VALID_PCT && (age === null || age <= MAX_LAST_GOOD_AGE_MINUTES);
  return { valid, reason: valid ? null : 'snapshot_failed_quality_or_age', quality, age };
}

function updateAlerts(report, previous) {
  const priorFailures = Number(previous?.consecutiveFailures || 0);
  const failed = report.level === 'bad' || report.fallbackUsed;
  const consecutiveFailures = failed ? priorFailures + 1 : 0;
  const alerts = [];
  if (report.quality.invalidOhlcRows > 0) alerts.push({ level: 'critical', type: 'invalid_ohlc', title: 'تم رفض علاقات OHLC غير منطقية', text: `${report.quality.invalidOhlcRows} صفوف`, action: 'راجع مصدر الأسعار قبل أي قرار تنفيذي' });
  if (report.fallbackUsed) alerts.push({ level: 'warning', type: 'last_good_fallback', title: 'تم استخدام آخر لقطة سليمة', text: `العمر ${report.lastGoodAgeMinutes ?? '—'} دقيقة`, action: 'لا تعتمد على الإغلاق حتى عودة المصدر الحالي' });
  if (!report.ok) alerts.push({ level: 'critical', type: 'gateway_blocked', title: 'بوابة البيانات أوقفت التحديث', text: report.message, action: 'القرار التنفيذي مغلق تلقائيًا' });
  if (report.executionGrade) alerts.push({ level: 'info', type: 'execution_grade', title: 'بيانات السوق اجتازت بوابة الجودة', text: `OHLC صالح ${report.quality.ohlcValidPct}%`, action: 'يمكن استكمال بوابات الجلسة والأدلة' });
  return { ok: true, generatedAt: RUN_AT, consecutiveFailures, recovered: !failed && priorFailures > 0, alerts, lastGatewayStatus: report.status, lastGatewayLevel: report.level };
}

function main() {
  const beforeMarket = read('data/market.json', {});
  const beforeLastGood = read('data/last-good-market.json', null);
  const previousAlerts = read('data/source-alerts.json', {});

  let fetchExit = null;
  let fetchStdout = '';
  let fetchStderr = '';
  if (fs.existsSync('scripts/fetch-market-data.js')) {
    const result = cp.spawnSync(process.execPath, ['scripts/fetch-market-data.js'], {
      encoding: 'utf8', timeout: Number(process.env.EGX_FETCH_TIMEOUT_MS || 360000), env: process.env
    });
    fetchExit = result.status;
    fetchStdout = result.stdout || '';
    fetchStderr = result.stderr || '';
  }

  const candidateMarket = read('data/market.json', {});
  const fetchReport = read('data/source-fetch-report.json', {});
  const fetchStatus = read('data/fetch-status.json', {});
  const sourceHealth = read('data/source-health.json', {});
  const rawRows = rowsOf(candidateMarket);
  const quality = qualityOf(rawRows);
  const sanitizedRows = uniqueRows(rawRows);
  const realFetch = Boolean(fetchReport.realFetch || fetchStatus.realFetch);
  const classification = classify(quality, realFetch);
  const selectedSource = sourceName(fetchReport, fetchStatus, sourceHealth);
  const selectedUrl = fetchReport.selected?.url || fetchStatus.sourceUrl || sourceHealth.sourceUrl || candidateMarket.sourceUrl || null;

  const report = {
    ok: false,
    engine: 'v13.17.1_production_data_gateway',
    generatedAt: RUN_AT,
    marketDate: cairoDate(),
    status: classification.status,
    level: classification.level,
    accepted: classification.accepted,
    executionGrade: classification.executionGrade,
    selectedSource,
    selectedUrl,
    marketRows: sanitizedRows.length,
    expectedUniverse: UNIVERSE,
    coveragePct: pct(sanitizedRows.length, UNIVERSE),
    fallbackUsed: false,
    lastGoodSnapshotUsed: false,
    lastGoodAt: null,
    lastGoodAgeMinutes: null,
    quality,
    thresholds: { FULL_ROWS, CONDITIONAL_ROWS, MIN_PRICE_VALID_PCT, MIN_OHLC_VALID_PCT, MIN_PARTIAL_OHLC_VALID_PCT, MAX_LAST_GOOD_AGE_MINUTES },
    fetchExit,
    fetchStdout: fetchStdout.slice(-4000),
    fetchStderr: fetchStderr.slice(-4000),
    message: ''
  };

  if (classification.accepted) {
    const market = {
      ...candidateMarket,
      ok: true,
      generatedAt: RUN_AT,
      updatedAt: RUN_AT,
      marketDate: report.marketDate,
      source: selectedSource,
      sourceUrl: selectedUrl,
      rows: sanitizedRows,
      gatewayAccepted: true,
      executionGrade: classification.executionGrade,
      marketDataQualityVersion: '13.17.1',
      qualitySummary: quality,
      snapshotHash: hash(sanitizedRows),
      note: classification.executionGrade ? 'Production-grade public/delayed snapshot passed coverage and OHLC integrity gates. Manual broker verification remains required.' : 'Operational partial snapshot accepted for monitoring only; post-close execution gate remains closed.'
    };
    writeAtomic('data/market.json', market);
    report.ok = true;
    report.message = classification.executionGrade ? 'Execution-grade market snapshot accepted.' : 'Operational partial snapshot accepted; execution grade not reached.';
    if (classification.executionGrade) {
      writeAtomic('data/last-good-market.json', { ...market, lastGoodPromotedAt: RUN_AT, immutableSnapshotHash: market.snapshotHash });
      report.lastGoodAt = RUN_AT;
      report.lastGoodAgeMinutes = 0;
    }
  } else {
    writeAtomic('data/quarantine/latest-rejected-market.json', {
      generatedAt: RUN_AT,
      source: selectedSource,
      sourceUrl: selectedUrl,
      quality,
      sampleRows: rawRows.slice(0, 40),
      reason: classification.status
    });
    const lastGoodCheck = validLastGood(beforeLastGood);
    const previousCheck = validLastGood(beforeMarket);
    const fallback = lastGoodCheck.valid ? beforeLastGood : previousCheck.valid ? beforeMarket : null;
    const fallbackCheck = lastGoodCheck.valid ? lastGoodCheck : previousCheck;
    if (fallback) {
      const fallbackRows = uniqueRows(rowsOf(fallback));
      writeAtomic('data/market.json', {
        ...fallback,
        ok: true,
        generatedAt: RUN_AT,
        source: 'last_good_market_snapshot',
        rows: fallbackRows,
        gatewayAccepted: false,
        executionGrade: false,
        fallbackUsed: true,
        marketDataQualityVersion: '13.17.1',
        note: 'Current source rejected by quality gate. A previously validated snapshot is shown for monitoring only; post-close execution is blocked.'
      });
      report.ok = true;
      report.status = 'degraded_validated_last_good';
      report.level = 'warn';
      report.fallbackUsed = true;
      report.lastGoodSnapshotUsed = true;
      report.marketRows = fallbackRows.length;
      report.coveragePct = pct(fallbackRows.length, UNIVERSE);
      report.lastGoodAt = fallback.updatedAt || fallback.generatedAt || null;
      report.lastGoodAgeMinutes = fallbackCheck.age;
      report.message = 'Current source rejected; validated last-good snapshot restored for monitoring only.';
    } else {
      writeAtomic('data/market.json', {
        ok: false,
        generatedAt: RUN_AT,
        updatedAt: candidateMarket.updatedAt || RUN_AT,
        source: selectedSource,
        sourceUrl: selectedUrl,
        rows: sanitizedRows,
        gatewayAccepted: false,
        executionGrade: false,
        marketDataQualityVersion: '13.17.1',
        qualitySummary: quality,
        note: 'No validated last-good snapshot exists. Data is quarantined and all execution gates are closed.'
      });
      report.ok = false;
      report.status = 'blocked_no_valid_snapshot';
      report.level = 'bad';
      report.message = 'Current source failed quality checks and no validated fallback exists.';
    }
  }

  writeAtomic('data/market-quality-report.json', report);
  writeAtomic('data/source-gateway-report.json', report);
  writeAtomic('data/source-alerts.json', updateAlerts(report, previousAlerts));
  writeAtomic('data/source-health.json', {
    ok: report.ok,
    generatedAt: RUN_AT,
    lastSuccessAt: report.executionGrade ? RUN_AT : report.lastGoodAt,
    mode: report.status,
    sourceName: report.selectedSource,
    sourceUrl: report.selectedUrl,
    marketRows: report.marketRows,
    totalUniverse: UNIVERSE,
    universeCoveragePct: report.coveragePct,
    coveragePct: report.coveragePct,
    executionGrade: report.executionGrade,
    fallbackUsed: report.fallbackUsed,
    delayed: true,
    quality: report.quality
  });
  writeAtomic('data/fetch-status.json', {
    ...fetchStatus,
    ok: report.ok,
    realFetch: realFetch && report.accepted,
    generatedAt: RUN_AT,
    mode: report.status,
    sourceName: report.fallbackUsed ? 'last_good_market_snapshot' : selectedSource,
    marketRows: report.marketRows,
    coveragePct: report.coveragePct,
    executionGrade: report.executionGrade,
    message: report.message
  });

  console.log('V13.17.1 Data Gateway', {
    status: report.status,
    executionGrade: report.executionGrade,
    rows: report.marketRows,
    coveragePct: report.coveragePct,
    ohlcValidPct: report.quality.ohlcValidPct,
    invalidOhlcRows: report.quality.invalidOhlcRows,
    fallbackUsed: report.fallbackUsed
  });
}

main();
