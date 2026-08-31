#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildResearchUiSummary,assertResearchUiSummary } from '../src/research-ui-summary.js';

const root=path.resolve(process.env.RESEARCH_DATA_ROOT||'data/research');
const featurePath=path.join(root,'features','latest.json');
const livePath=path.join(root,'live','latest.json');
if(!fs.existsSync(featurePath)||!fs.existsSync(livePath))throw new Error('RESEARCH_UI_INPUTS_MISSING');
const features=JSON.parse(fs.readFileSync(featurePath,'utf8'));
const live=JSON.parse(fs.readFileSync(livePath,'utf8'));
const summary=buildResearchUiSummary(features,live);
assertResearchUiSummary(summary);
const outDir=path.join(root,'ui');fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'latest.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({session:summary.session,featureReadiness:summary.featureReadiness,counts:summary.counts,authority:summary.authority,uiSnapshotHash:summary.uiSnapshotHash},null,2));
