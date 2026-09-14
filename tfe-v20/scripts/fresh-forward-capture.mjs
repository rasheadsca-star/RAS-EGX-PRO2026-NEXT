import fs from 'node:fs/promises';
import path from 'node:path';
import { buildFreshForwardSnapshot, sha256 } from '../sidecars/fresh-forward-ledger.js';

const reportPath = process.argv[2] || 'reports/meta-live-shadow.json';
const nextSessionOpenAt = process.env.NEXT_SESSION_OPEN_AT;
const nextTradingSessionDate = process.env.NEXT_TRADING_SESSION_DATE || null;
const sourceDeclaredDateStatus = process.env.SOURCE_DECLARED_DATE_STATUS || 'UNVERIFIED';
const sourceCommit = process.env.SOURCE_COMMIT || process.env.GITHUB_SHA;
if (!nextSessionOpenAt) throw new Error('NEXT_SESSION_OPEN_AT_REQUIRED');
if (!sourceCommit) throw new Error('SOURCE_COMMIT_REQUIRED');

let calendarEvidence = [];
if (process.env.MARKET_CALENDAR_EVIDENCE_JSON) {
  calendarEvidence = JSON.parse(process.env.MARKET_CALENDAR_EVIDENCE_JSON);
  if (!Array.isArray(calendarEvidence)) throw new Error('MARKET_CALENDAR_EVIDENCE_MUST_BE_ARRAY');
}

const metaText = await fs.readFile(path.resolve(reportPath), 'utf8');
const meta = JSON.parse(metaText);
if (meta.status !== 'RESEARCH_SHADOW_ONLY') throw new Error('META_SHADOW_NOT_RESEARCH_ONLY');

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'user-agent': 'egx-fresh-forward-ledger-capture' } });
  if (!response.ok) throw new Error(`FETCH_FAILED_${response.status}:${url}`);
  return response.text();
}

const sourceEntries = await Promise.all(Object.entries(meta.sources ?? {}).map(async ([id, url]) => {
  const text = await fetchText(url);
  const parsed = JSON.parse(text);
  return [id, {
    url,
    digestSha256: sha256(text),
    sessionDate: parsed?.sessionDate ?? parsed?.marketSession ?? parsed?.metrics?.sessionDate ?? null,
    generatedAt: parsed?.generatedAt ?? null,
    parsed,
  }];
}));
const fetched = Object.fromEntries(sourceEntries);
const v16 = fetched.v16?.parsed;
if (!v16) throw new Error('V16_SOURCE_MISSING');
if (v16.sessionDate !== meta.sessionDate) throw new Error(`SOURCE_ALIGNMENT_FAILED:v16=${v16.sessionDate}:meta=${meta.sessionDate}`);

const sources = Object.fromEntries(Object.entries(fetched).map(([id, value]) => [id, {
  url: value.url,
  digestSha256: value.digestSha256,
  sessionDate: value.sessionDate,
  generatedAt: value.generatedAt,
}]));
sources.metaShadow = {
  url: `file:${reportPath}`,
  digestSha256: sha256(metaText),
  sessionDate: meta.sessionDate,
  generatedAt: meta.generatedAt ?? null,
};

const snapshot = buildFreshForwardSnapshot({
  signalSessionDate: meta.sessionDate,
  capturedAt: new Date().toISOString(),
  nextSessionOpenAt,
  sourceCommit,
  sources,
  v16Payload: v16,
  metaShadowPayload: meta,
  marketCalendar: {
    timeZone: 'Africa/Cairo',
    sourceDeclaredDateStatus,
    nextTradingSessionDate,
    evidence: calendarEvidence,
  },
});

const outDir = path.resolve('reports/fresh-forward-ledger');
await fs.mkdir(outDir, { recursive: true });
const out = path.join(outDir, `${snapshot.signalSessionDate}-${snapshot.snapshotHash.slice(0, 12)}.json`);
await fs.writeFile(out, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({
  ok: true,
  status: snapshot.status,
  signalSessionDate: snapshot.signalSessionDate,
  signalDateSemantics: snapshot.signalDateSemantics,
  sourceDeclaredDateStatus: snapshot.marketCalendar.sourceDeclaredDateStatus,
  nextTradingSessionDate: snapshot.marketCalendar.nextTradingSessionDate,
  capturedAt: snapshot.capturedAt,
  nextSessionOpenAt: snapshot.nextSessionOpenAt,
  sourceCommit: snapshot.sourceCommit,
  sourceBundleHash: snapshot.sourceBundleHash,
  snapshotHash: snapshot.snapshotHash,
  v16Signals: snapshot.v16Signals.length,
  metaShadowRows: snapshot.metaShadowRows.length,
  output: out,
}, null, 2));
