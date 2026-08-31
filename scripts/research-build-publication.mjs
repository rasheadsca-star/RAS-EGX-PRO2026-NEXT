#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildResearchPublication,verifyResearchPublication } from '../src/research-publication.js';
const input=path.resolve(process.env.RESEARCH_STRATEGY_PATH||'data/research/strategy/latest.json'),output=path.resolve(process.env.RESEARCH_PUBLICATION_PATH||'data/research/published/latest.json');
if(!fs.existsSync(input))throw new Error(`RESEARCH_STRATEGY_INPUT_MISSING:${input}`);
const strategy=JSON.parse(fs.readFileSync(input,'utf8')),publication=buildResearchPublication(strategy);if(!verifyResearchPublication(publication))throw new Error('RESEARCH_PUBLICATION_SELF_VERIFY_FAILED');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(publication,null,2)+'\n');console.log(JSON.stringify({signalSession:publication.signalSession,sourceStrategySnapshotHash:publication.sourceStrategySnapshotHash,publicationHash:publication.publicationHash,validation:publication.validation,counts:publication.counts,recommendations:publication.recommendations.map(r=>({ticker:r.ticker,decision:r.decision,entryLow:r.entryLow,entryHigh:r.entryHigh,stop:r.stop,target1:r.target1,target2:r.target2,netRiskReward:r.netRiskReward,qualityScore:r.qualityScore}))},null,2));
