#!/usr/bin/env node
'use strict';

// Compatibility entry point. Existing V15/V16 workflows keep calling this
// filename. First establish strict cross-symbol same-day Mubasher session
// evidence for time-only "Last update" labels; then run the unchanged
// session-aware price-truth checks (jump, change consistency, history merge).
require('./v16-source-session-quorum.cjs');
require('./v16-session-aware-price-truth.cjs');
