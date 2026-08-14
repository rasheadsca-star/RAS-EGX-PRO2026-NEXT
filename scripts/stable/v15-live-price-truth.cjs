#!/usr/bin/env node
'use strict';

// Compatibility entry point. All existing V15/V16 workflows keep calling this
// filename, but the implementation now requires explicit market-session
// evidence from the source before a row can be stamped into history.
require('./v16-session-aware-price-truth.cjs');
