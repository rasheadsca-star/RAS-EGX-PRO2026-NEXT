#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const MARKET_PATH = path.join(ROOT, 'data/market.json');
const REPORT_PATH = path.join(ROOT, 'data/stable/v16-mubasher-session-evidence-enrichment.json');
const TIMEOUT_MS = Number(process.env.EGX_SESSION_EVIDENCE_TIMEOUT_MS || 15000);
const CONCURRENCY = Math.max(2, Math.min(Number(process.env.EGX_SESSION_EVIDENCE_CONCURRENCY || 8), 16));
const VOLUME_TOLERANCE = Number(process.env.EGX_SESSION_EVIDENCE_VOLUME_TOLERANCE || 0.005);

const MONTHS = new Map([
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
  ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12]
]);

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function n(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
function dateOnly(value) {
  return (String(value || '').match(/^(20\d{2}-\d{2}-\d{2})/) || [])[1] || null;
}
function parseDate(value) {
  const iso = dateOnly(value);
  if (iso) return iso;
  const match = String(value || '').match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (!match) return null;
  const month = MONTHS.get(match[2].toLowerCase());
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
}
function normSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.CA$/i, '').replace(/[^A-Z0-9._-]/g, '');
}
function isMubasherRow(row) {
  return /mubasher/i.test(String(row?.source || row?.priceSource || '')) || /mubasher\.info/i.test(String(row?.sourceUrl || ''));
}
function volumeMatches(sourceVolume, snapshotVolume) {
  const a = n(sourceVolume);
  const b = n(snapshotVolume);
  if (a === null || b === null) return false;
  if (a === b) return true;
  return Math.abs(a - b) / Math.max(1, a, b) <= VOLUME_TOLERANCE;
}
function statsUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname
    .replace(/\/$/, '')
    .replace(/\/(profile|financial-statements|volume-statistics)$/i, '') + '/volume-statistics';
  return url.toString();
}
function parseVolumeStatistics(html) {
  const source = String(html || '');
  const table = source.match(/<h2[^>]*>\s*Volume Statistics\s*<\/h2>[\s\S]{0,10000}?<\/table>/i)?.[0] || source;
  const dateMatch = table.match(/<td[^>]*>\s*Last Update\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i);
  const volumeMatch = table.match(/<td[^>]*>\s*Volume\s*<\/td>\s*<td[^>]*>\s*([0-9][0-9,]*)\s*<\/td>/i);
  return {
    sourceSessionDate: parseDate(dateMatch?.[1]),
    sourceDateText: dateMatch?.[1]?.trim() || null,
    sourceVolume: n(volumeMatch?.[1])
  };
}
async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: 'text/html,application/xhtml+xml,*/*',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      referer: 'https://english.mubasher.info/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 EGXProV16SessionEvidence/1.0'
    }
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.text();
}
async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      result[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return result;
}

async function enrichRow(row) {
  const ticker = normSymbol(row?.symbol || row?.ticker || row?.code);
  const existingDate = dateOnly(row?.sourceSessionDate || row?.marketSessionDate || row?.sessionDate);
  if (existingDate) {
    return { row, audit: { ticker, status: 'EXISTING_EXPLICIT_DATE_PRESERVED', sourceSessionDate: existingDate } };
  }
  if (!isMubasherRow(row)) {
    return { row, audit: { ticker, status: 'NON_MUBASHER_ROW_SKIPPED' } };
  }
  if (!row?.sourceUrl || !/^https?:\/\//i.test(String(row.sourceUrl))) {
    return { row, audit: { ticker, status: 'MISSING_SOURCE_URL' } };
  }

  const evidenceUrl = statsUrl(row.sourceUrl);
  try {
    const evidence = parseVolumeStatistics(await fetchText(evidenceUrl));
    if (!evidence.sourceSessionDate) {
      return { row, audit: { ticker, status: 'EXPLICIT_DATE_NOT_FOUND', evidenceUrl } };
    }
    if (!volumeMatches(evidence.sourceVolume, row.volume)) {
      return {
        row,
        audit: {
          ticker,
          status: 'VOLUME_MISMATCH',
          sourceSessionDate: evidence.sourceSessionDate,
          sourceVolume: evidence.sourceVolume,
          snapshotVolume: n(row.volume),
          evidenceUrl
        }
      };
    }

    const verifiedAt = new Date().toISOString();
    const enriched = {
      ...row,
      sourceSessionDate: evidence.sourceSessionDate,
      marketSessionDate: evidence.sourceSessionDate,
      sourceSessionEvidence: 'mubasher_volume_statistics_explicit_date_volume_match',
      sourceSessionEvidenceUrl: evidenceUrl,
      sourceSessionEvidenceVolume: evidence.sourceVolume,
      sourceSessionEvidenceVerifiedAt: verifiedAt
    };
    return {
      row: enriched,
      audit: {
        ticker,
        status: 'VERIFIED',
        sourceSessionDate: evidence.sourceSessionDate,
        sourceVolume: evidence.sourceVolume,
        snapshotVolume: n(row.volume),
        evidenceUrl
      }
    };
  } catch (error) {
    return { row, audit: { ticker, status: 'EVIDENCE_FETCH_FAILED', error: error.message, evidenceUrl } };
  }
}

(async () => {
  const market = readJson(MARKET_PATH, null);
  if (!market || !Array.isArray(market.rows)) {
    throw new Error('data/market.json missing rows');
  }

  const results = await mapLimit(market.rows, CONCURRENCY, enrichRow);
  market.rows = results.map(result => result.row);
  market.sessionEvidenceEnrichedAt = new Date().toISOString();
  writeJson(MARKET_PATH, market);

  const audits = results.map(result => result.audit);
  const verified = audits.filter(row => row.status === 'VERIFIED');
  const bySession = {};
  for (const item of verified) bySession[item.sourceSessionDate] = (bySession[item.sourceSessionDate] || 0) + 1;

  const report = {
    schemaVersion: '16.3.6-mubasher-explicit-session-evidence',
    generatedAt: new Date().toISOString(),
    source: 'mubasher_volume_statistics_html',
    policy: {
      explicitCalendarDateRequired: true,
      volumeMatchRequired: true,
      volumeTolerancePct: Number((VOLUME_TOLERANCE * 100).toFixed(4)),
      fetchTimestampInferenceForbidden: true,
      staleDatesPreservedForDownstreamRejection: true
    },
    totalMarketRows: market.rows.length,
    verifiedRows: verified.length,
    bySourceSession: Object.entries(bySession).sort(([a], [b]) => a.localeCompare(b)).map(([session, count]) => ({ session, count })),
    statusCounts: audits.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {}),
    failures: audits.filter(item => item.status !== 'VERIFIED' && item.status !== 'EXISTING_EXPLICIT_DATE_PRESERVED').slice(0, 100)
  };
  writeJson(REPORT_PATH, report);
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
