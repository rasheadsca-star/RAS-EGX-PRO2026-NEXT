import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashEntry(previousHash, payload, sequence, recordedAt) {
  return crypto.createHash('sha256')
    .update(`${previousHash}\n${sequence}\n${recordedAt}\n${stable(payload)}`)
    .digest('hex');
}

export class RecommendationLedger {
  constructor(filePath, { now = () => new Date() } = {}) {
    this.filePath = filePath;
    this.now = now;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf8');
  }

  readVerified() {
    const text = fs.readFileSync(this.filePath, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const entries = [];
    let previousHash = 'GENESIS';

    for (let i = 0; i < lines.length; i += 1) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        throw new Error('LEDGER_INVALID_JSON');
      }
      const expectedSequence = i + 1;
      if (entry.sequence !== expectedSequence || entry.previousHash !== previousHash) {
        throw new Error('LEDGER_CHAIN_INVALID');
      }
      const expectedHash = hashEntry(previousHash, entry.payload, entry.sequence, entry.recordedAt);
      if (entry.entryHash !== expectedHash) {
        throw new Error('LEDGER_HASH_INVALID');
      }
      entries.push(entry);
      previousHash = entry.entryHash;
    }
    return entries;
  }

  append(payload) {
    const entries = this.readVerified();
    const previousHash = entries.at(-1)?.entryHash || 'GENESIS';
    const sequence = entries.length + 1;
    const recordedAt = this.now().toISOString();
    const entryHash = hashEntry(previousHash, payload, sequence, recordedAt);
    const entry = { sequence, recordedAt, previousHash, payload, entryHash };
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', flag: 'a' });
    return entry;
  }

  appendIfNew(payload, fingerprint) {
    const entries = this.readVerified();
    const existing = [...entries].reverse().find((entry) => entry.payload?.fingerprint === fingerprint);
    if (existing) return { entry: existing, appended: false };
    return { entry: this.append({ ...payload, fingerprint }), appended: true };
  }
}
