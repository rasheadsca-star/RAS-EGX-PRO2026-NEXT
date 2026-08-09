#!/usr/bin/env node
'use strict';
const { cairoParts, monitoringWindow, shouldRunMode, shouldRunScheduledMode } = require('./exchange-calendar.cjs');

const args = process.argv.slice(2);
const modeIndex = args.indexOf('--mode');
const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'POST_MARKET';
const executeIfWindow = args.includes('--execute-if-window');
const now = process.env.V17_MONITOR_NOW ? new Date(process.env.V17_MONITOR_NOW) : new Date();
const eligible = shouldRunMode(mode, now);
const report = { mode, cairo: cairoParts(now), window: monitoringWindow(now), eligible, scheduledEligible: shouldRunScheduledMode(mode, now), status: executeIfWindow && !eligible ? 'SAFE_NO_OP_OUTSIDE_WINDOW' : 'READY' };
console.log(JSON.stringify(report, null, 2));
if (!['PRE_MARKET', 'INTRADAY', 'POST_MARKET', 'WEEKLY'].includes(mode)) process.exit(2);
