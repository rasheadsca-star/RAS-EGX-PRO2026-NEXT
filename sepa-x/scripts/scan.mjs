#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanMarket } from '../src/engine.js';
import { readJson, writeJsonAtomic, appendHistory } from '../src/store.js';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..'),dataDir=path.join(root,'data');
const limitArg=process.argv.find(x=>x.startsWith('--limit='));const limit=limitArg?Number(limitArg.split('=')[1]):null;const noWrite=process.argv.includes('--no-write');
const previous=readJson(path.join(dataDir,'current-scan.json'),null);
const scan=await scanMarket({limit,previousScan:previous});
if(!noWrite){writeJsonAtomic(path.join(dataDir,'current-scan.json'),scan);appendHistory(path.join(dataDir,'recommendation-history.json'),scan);writeJsonAtomic(path.join(dataDir,'engine-errors.json'),scan.errors);writeJsonAtomic(path.join(dataDir,'state-transitions.json'),scan.transitions);}
console.log(JSON.stringify({engineId:scan.engineId,generatedAt:scan.generatedAt,market:scan.market_status,coverage:scan.market_coverage,top5:scan.top5_now.map(x=>({symbol:x.symbol,score:x.final_score,status:x.status})),noHighConviction:scan.no_high_conviction_setup},null,2));
