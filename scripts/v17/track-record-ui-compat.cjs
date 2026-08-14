#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const filePath = path.join(root, 'data/v17/recommendation-track-record.json');

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
if (data?.schemaVersion !== '17.0.0-recommendation-track-record-1') {
  throw new Error('Unexpected recommendation track-record schema');
}

const summary = data?.recordedRecommendationBackfill?.summary;
if (!summary) throw new Error('Missing recorded recommendation summary');

// Keep the current UI contract while the normalized field name is rolled out.
// The value is the number of rows with an actual stored/trusted return only;
// pending rows remain null and are never counted as evaluated/resolved.
summary.resolvedWithStoredOrTrustedBackfill = summary.evaluatedWithStoredOrTrustedReturn ?? 0;

data.uiCompatibility = {
  ...(data.uiCompatibility || {}),
  version: 'TRACK_RECORD_UI_COMPAT_V1',
  generatedAt: new Date().toISOString(),
  legacySummaryFieldMirrorsEvaluatedReturnCount: true,
};

const temp = `${filePath}.tmp`;
fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
JSON.parse(fs.readFileSync(temp, 'utf8'));
fs.renameSync(temp, filePath);

console.log(JSON.stringify({
  evaluatedWithStoredOrTrustedReturn: summary.evaluatedWithStoredOrTrustedReturn ?? 0,
  resolvedWithStoredOrTrustedBackfill: summary.resolvedWithStoredOrTrustedBackfill,
  pendingTrustedHistory: summary.pendingTrustedHistory ?? 0,
}, null, 2));
