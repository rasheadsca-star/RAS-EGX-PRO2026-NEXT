#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const evaluator = path.join(__dirname, 'v16-session-aware-price-truth.cjs');
const quorum = path.join(__dirname, 'v16-source-session-quorum.cjs');

function run(script, label, allowedStatuses = [0]) {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  const status = Number.isInteger(result.status) ? result.status : 1;
  if (!allowedStatuses.includes(status)) {
    throw new Error(`${label} failed with exit code ${status}`);
  }
  return status;
}

// Pass 1 may legitimately be fail-closed (exit 2): its job here is to collect
// fresh per-symbol Mubasher sourceMarketTime/session evidence into data/market.json.
run(evaluator, 'source evidence collection pass', [0, 2]);

// Establish the current-session date only after the source-page evidence exists.
// Exit 2 remains fail-closed and is not converted into a success.
const quorumStatus = run(quorum, 'source session quorum', [0, 2]);

// Pass 2 evaluates the normal price-truth guards after explicit/quorum session
// evidence has been written. Its status is the authoritative wrapper result.
const finalResult = spawnSync(process.execPath, [evaluator], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit'
});
if (finalResult.error) throw finalResult.error;
const finalStatus = Number.isInteger(finalResult.status) ? finalResult.status : 1;

if (quorumStatus !== 0 && finalStatus === 0) {
  throw new Error('price truth cannot open when source-session quorum is fail-closed');
}
process.exitCode = finalStatus;
