#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { validateDecisionHistory } = require('./validate.cjs');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const dir = path.join(root, 'data/v17/historical-recovery/intelligence');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'history/index.json'), 'utf8'));
const snapshots = Object.fromEntries(index.snapshots.map(item => [item.snapshotId, JSON.parse(fs.readFileSync(path.join(dir, item.file), 'utf8'))]));
const result = validateDecisionHistory(index, snapshots);
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exit(1);
