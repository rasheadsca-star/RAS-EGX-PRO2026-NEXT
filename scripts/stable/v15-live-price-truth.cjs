#!/usr/bin/env node
'use strict';

const evaluator = require.resolve('./v16-session-aware-price-truth.cjs');

// First pass collects per-symbol source-page session evidence into data/market.json.
require(evaluator);

// Use that collected evidence to establish the current-session quorum.
require('./v16-source-session-quorum.cjs');

// Re-evaluate price truth after sourceSessionDate has been established.
delete require.cache[evaluator];
require(evaluator);
