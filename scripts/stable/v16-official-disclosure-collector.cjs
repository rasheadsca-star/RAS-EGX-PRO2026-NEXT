#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const OVERRIDES_PATH = path.join(ROOT, 'data/fundamentals/v16-official-overrides.json');
const OUT_PATH = path.join(ROOT, 'data/stable/v16-official-disclosures.json');
const REMOTE_URL = String(process.env.EGX_OFFICIAL_DISCLOSURES_JSON_URL || '').trim();
const TIMEOUT_MS = Math.max(5000, Math.min(Number(process.env.EGX_OFFICIAL_DISCLOSURES_TIMEOUT_MS || 20000), 60000));

const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
const iso = value => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const dateOnly = value => (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
function officialHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'egx.com.eg' || host.endsWith('.egx.com.eg')) return { valid: true, authority: 'EGX' };
    if (host === 'fra.gov.eg' || host.endsWith('.fra.gov.eg')) return { valid: true, authority: 'FRA' };
    return { valid: false, authority: 'COMPANY_IR_OR_OTHER' };
  } catch { return { valid: false, authority: 'INVALID_URL' }; }
}
function cleanFinancialObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') out[key] = item;
    else if (num(item) !== null) out[key] = num(item);
    else if (typeof item === 'object' && !Array.isArray(item)) out[key] = cleanFinancialObject(item);
  }
  return out;
}
function normalize(ticker, input, sourceName) {
  const officialUrl = String(input?.officialUrl || input?.url || '').trim();
  const host = officialHost(officialUrl);
  const officialPublishedAt = iso(input?.officialPublishedAt || input?.publishedAt);
  const officialPeriodEnd = dateOnly(input?.officialPeriodEnd || input?.periodEnd);
  const audited = input?.audited === true;
  const reviewType = String(input?.reviewType || (audited ? 'AUDITED' : 'LIMITED_REVIEW')).toUpperCase();
  const statementScope = String(input?.statementScope || input?.scope || 'UNKNOWN').toUpperCase();
  const sourceType = String(input?.sourceType || '').toUpperCase();
  const authorityVerified = host.valid || sourceType === 'OFFICIAL_COMPANY_IR';
  const errors = [];
  if (!/^[A-Z0-9.\-]{2,12}$/.test(ticker)) errors.push('INVALID_TICKER');
  if (!officialUrl) errors.push('MISSING_OFFICIAL_URL');
  if (!authorityVerified) errors.push('UNVERIFIED_SOURCE_DOMAIN');
  if (!officialPublishedAt) errors.push('MISSING_PUBLISHED_AT');
  if (!officialPeriodEnd) errors.push('MISSING_PERIOD_END');
  if (!['AUDITED', 'LIMITED_REVIEW', 'MANAGEMENT_ACCOUNTS'].includes(reviewType)) errors.push('INVALID_REVIEW_TYPE');
  if (!['CONSOLIDATED', 'STANDALONE', 'UNKNOWN'].includes(statementScope)) errors.push('INVALID_STATEMENT_SCOPE');
  const valid = errors.length === 0;
  return {
    ticker,
    valid,
    errors,
    sourceName,
    authority: host.valid ? host.authority : sourceType === 'OFFICIAL_COMPANY_IR' ? 'COMPANY_IR' : host.authority,
    officialUrl,
    officialPublishedAt,
    officialPeriodEnd,
    audited,
    reviewType,
    statementScope,
    notes: input?.notes || null,
    classification: cleanFinancialObject(input?.classification),
    latest: cleanFinancialObject(input?.latest),
    annual: cleanFinancialObject(input?.annual),
    calculated: cleanFinancialObject(input?.calculated)
  };
}
async function fetchRemote() {
  if (!REMOTE_URL) return { records: {}, status: 'NOT_CONFIGURED', error: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(REMOTE_URL, { signal: controller.signal, cache: 'no-store', headers: { accept: 'application/json', 'user-agent': 'EGX-Pro-Official-Disclosure-Gate/16.2' } });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const json = await response.json();
    return { records: json.records || json.disclosures || {}, status: 'FETCHED', error: null };
  } catch (error) {
    return { records: {}, status: 'FAILED', error: String(error?.message || error) };
  } finally { clearTimeout(timer); }
}

async function main() {
  const local = readJson(OVERRIDES_PATH, { records: {} });
  const remote = await fetchRemote();
  const combined = { ...(local.records || {}), ...(remote.records || {}) };
  const normalized = [];
  for (const [rawTicker, record] of Object.entries(combined)) {
    const ticker = String(rawTicker || record?.ticker || '').trim().toUpperCase();
    normalized.push(normalize(ticker, record, Object.prototype.hasOwnProperty.call(remote.records || {}, rawTicker) ? 'REMOTE_OFFICIAL_FEED' : 'REPOSITORY_REVIEWED_OVERRIDE'));
  }
  const valid = normalized.filter(row => row.valid);
  const invalid = normalized.filter(row => !row.valid);
  const records = {};
  for (const row of valid) {
    records[row.ticker] = {
      ticker: row.ticker,
      officialDisclosureVerified: true,
      officialUrl: row.officialUrl,
      officialPublishedAt: row.officialPublishedAt,
      officialPeriodEnd: row.officialPeriodEnd,
      audited: row.audited,
      reviewType: row.reviewType,
      statementScope: row.statementScope,
      sourceType: row.authority === 'COMPANY_IR' ? 'OFFICIAL_COMPANY_IR' : `OFFICIAL_${row.authority}`,
      notes: row.notes,
      ...(row.classification ? { classification: row.classification } : {}),
      ...(row.latest ? { latest: row.latest } : {}),
      ...(row.annual ? { annual: row.annual } : {}),
      ...(row.calculated ? { calculated: row.calculated } : {})
    };
  }
  const overrideOutput = {
    schemaVersion: '16.2.0',
    generatedAt: new Date().toISOString(),
    description: 'Validated official disclosure overrides only. Invalid or incomplete records are excluded from the financial scoring pipeline.',
    remoteFeedStatus: remote.status,
    records
  };
  writeJson(OVERRIDES_PATH, overrideOutput);
  const out = {
    schemaVersion: '16.2.0',
    generatedAt: overrideOutput.generatedAt,
    methodology: {
      name: 'EGX_PRO_OFFICIAL_DISCLOSURE_GATE_1.0',
      rule: 'A record is official only when ticker, official source URL, publication timestamp, financial period and review type all pass validation.',
      allowedAuthorities: ['EGX', 'FRA', 'OFFICIAL_COMPANY_IR'],
      noInference: true
    },
    remoteFeed: { configured: Boolean(REMOTE_URL), status: remote.status, error: remote.error },
    summary: {
      submittedRecords: normalized.length,
      verifiedRecords: valid.length,
      rejectedRecords: invalid.length,
      auditedRecords: valid.filter(row => row.audited).length,
      consolidatedRecords: valid.filter(row => row.statementScope === 'CONSOLIDATED').length
    },
    verified: valid.map(({ classification, latest, annual, calculated, ...row }) => row),
    rejected: invalid.map(({ classification, latest, annual, calculated, ...row }) => row)
  };
  writeJson(OUT_PATH, out);
  console.log({ remoteFeed: out.remoteFeed, summary: out.summary });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
