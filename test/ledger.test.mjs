import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RecommendationLedger } from '../src/infrastructure/ledger.mjs';

test('ledger appends a verifiable hash chain and deduplicates fingerprint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egx-ledger-'));
  const file = path.join(dir, 'ledger.jsonl');
  let tick = 0;
  const ledger = new RecommendationLedger(file, {
    now: () => new Date(`2026-08-16T12:00:0${tick++}Z`),
  });

  const first = ledger.appendIfNew({ decision: 'BUY' }, 'abc');
  const duplicate = ledger.appendIfNew({ decision: 'BUY' }, 'abc');
  const second = ledger.appendIfNew({ decision: 'SELL' }, 'def');

  assert.equal(first.appended, true);
  assert.equal(duplicate.appended, false);
  assert.equal(second.entry.sequence, 2);
  assert.equal(ledger.readVerified().length, 2);
});

test('tampering is detected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egx-ledger-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new RecommendationLedger(file);
  ledger.append({ decision: 'BUY' });
  const text = fs.readFileSync(file, 'utf8').replace('"BUY"', '"SELL"');
  fs.writeFileSync(file, text);
  assert.throws(() => ledger.readVerified(), /LEDGER_HASH_INVALID/);
});
