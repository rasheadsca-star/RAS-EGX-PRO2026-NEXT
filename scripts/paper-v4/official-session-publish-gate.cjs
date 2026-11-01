#!/usr/bin/env node
'use strict';
// Fail closed: a new generatedAt is not a new market session.
// This workflow must not rewrite frozen 29 October data before a validated
// official EGX PDF extractor and price/volume/ISIN reconciliation exist.
const fs=require('node:fs'),path=require('node:path');
const status=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../paper-v4/market-status.json'),'utf8'));
if(!/^\d{4}-\d{2}-\d{2}$/.test(status.lastVerifiedMarketSession))throw Error('Invalid frozen session');
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'publish=false\n');
console.log('V4_PRESERVE_FROZEN_SESSION '+status.lastVerifiedMarketSession+'; no validated official EGX PDF ingestion, so no new price or recommendation publication.');
