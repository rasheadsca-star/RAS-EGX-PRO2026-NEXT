import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyFreshForwardSnapshot } from '../sidecars/fresh-forward-ledger.js';

const root = path.resolve(process.argv[2] || 'forward-ledger/snapshots');
let files = [];
try {
  files = (await fs.readdir(root)).filter((name) => name.endsWith('.json')).sort();
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const verdicts = [];
for (const name of files) {
  const snapshot = JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
  const verdict = verifyFreshForwardSnapshot(snapshot);
  verdicts.push({ file: name, snapshotHash: snapshot.snapshotHash ?? null, ...verdict });
}
const failed = verdicts.filter((row) => !row.ok);
console.log(JSON.stringify({ schemaVersion: 'egx.fresh-forward-ledger.verify.1', checked: verdicts.length, failed: failed.length, verdicts }, null, 2));
if (failed.length) process.exitCode = 1;
