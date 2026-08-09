#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { buildNewsDataset } = require('./engine.cjs');

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const market = JSON.parse(fs.readFileSync(path.join(root, 'data/v17/historical-recovery/long-history/compact-market.json'), 'utf8'));
  const input = JSON.parse(fs.readFileSync(path.join(root, 'data/v17/historical-recovery/news/verified-events.json'), 'utf8'));
  const output = buildNewsDataset({ universe: market.results, events: input.events, asOf: new Date(), sourceHealth: input.sourceHealth });
  fs.writeFileSync(path.join(root, 'data/v17/historical-recovery/news/current.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output.summary, null, 2));
}
