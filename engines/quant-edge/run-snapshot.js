'use strict';

const fs = require('node:fs');
const path = require('node:path');
const QE = require('./index');
const { loadIndependentSnapshot, toUniverse } = require('./data-boundary');

function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input) throw new Error('Usage: node engines/quant-edge/run-snapshot.js <independent-snapshot.json> [output.json]');
  QE.assertShadowSafety();
  const { snapshot, sha256 } = loadIndependentSnapshot(input);
  const result = QE.rankMarket(toUniverse(snapshot));
  const payload = {
    ...result,
    source: {
      origin: snapshot.origin,
      sourceGrade: snapshot.sourceGrade,
      asOf: snapshot.asOf || null,
      snapshotSha256: sha256,
    },
    executionAllowed: false,
  };
  const text = JSON.stringify(payload, null, 2);
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, text + '\n', 'utf8');
  } else {
    process.stdout.write(text + '\n');
  }
}

if (require.main === module) main();
module.exports = { main };
