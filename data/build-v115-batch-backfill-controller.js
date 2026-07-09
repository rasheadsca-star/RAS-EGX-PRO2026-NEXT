#!/usr/bin/env node
// V11.5 Batch Backfill Controller
// Runs the V11.4 historical adapter in controlled batches with checkpoint/resume.
// No manual CSV, no fabricated sessions, no broker-screen data.
process.env.EGX_HISTORY_BACKFILL_BATCH_MODE = 'true';
process.env.EGX_HISTORY_BACKFILL_BATCH_SIZE = process.env.EGX_HISTORY_BACKFILL_BATCH_SIZE || process.env.EGX_HISTORY_BACKFILL_MAX_SYMBOLS || '40';
process.env.EGX_HISTORY_BACKFILL_MAX_SYMBOLS = process.env.EGX_HISTORY_BACKFILL_BATCH_SIZE;
process.env.EGX_HISTORY_BACKFILL_MAX_MS = process.env.EGX_HISTORY_BACKFILL_MAX_MS || '840000';
process.env.EGX_SOURCE_FETCH_TIMEOUT_MS = process.env.EGX_SOURCE_FETCH_TIMEOUT_MS || '7000';
require('./build-v114-history-adapter-fix.js');
