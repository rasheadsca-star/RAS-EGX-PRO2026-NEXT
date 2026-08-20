import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDecisionLogRows, toDecisionLogCsv } from '../src/decisionLog.js';

const base = process.env.TFE_BASE_URL || 'https://egx-tfe-v20-fusion-rc2.vercel.app';
const r = await fetch(`${base}/scan?limit=50`, { headers: { 'user-agent': 'TFE-RC2-DECISION-LOG' } });
if (!r.ok) throw new Error(`SCAN_HTTP_${r.status}`);
const scan = await r.json();
if (!scan.ok) throw new Error(scan.error || 'SCAN_FAILED');

const sourceCommit = r.headers.get('x-tfe-source-commit') || scan.sourceCommit || null;
const sessionDate = scan.universe?.sessionDate || new Date().toISOString().slice(0, 10);
const rows = buildDecisionLogRows(scan.recommendations || [], {
  sessionDate,
  generatedAt: scan.generatedAt,
  sourceCommit,
});

const dir = path.resolve('data');
await mkdir(dir, { recursive: true });
const csv = toDecisionLogCsv(rows);
await writeFile(path.join(dir, `decision-log-${sessionDate}.csv`), csv, 'utf8');
await writeFile(path.join(dir, 'decision-log-current.csv'), csv, 'utf8');
console.log(JSON.stringify({ ok: true, sessionDate, rows: rows.length, sourceCommit, files: [`data/decision-log-${sessionDate}.csv`, 'data/decision-log-current.csv'] }, null, 2));
