#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanMarket } from '../src/engine.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { explainConcentrationPool, selectConcentratedRecommendations } from '../src/concentration.js';
import { readJson, writeJsonAtomic, appendHistory } from '../src/store.js';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..'),dataDir=path.join(root,'data');
const limitArg=process.argv.find(x=>x.startsWith('--limit='));const limit=limitArg?Number(limitArg.split('=')[1]):null;const noWrite=process.argv.includes('--no-write');
const previous=readJson(path.join(dataDir,'current-scan.json'),null);
const scan=await scanMarket({limit,previousScan:previous});
const concentrationAudit=explainConcentrationPool(scan.all||[],DEFAULT_CONFIG.concentration);
const concentrated=selectConcentratedRecommendations(scan.all||[],DEFAULT_CONFIG.concentration);
scan.concentration_audit=concentrationAudit;
scan.top_recommendations=concentrated;
scan.top5_now=concentrated;
scan.best_one=concentrated[0]||null;
scan.no_high_conviction_setup=concentrated.length<(DEFAULT_CONFIG.concentration?.baseCount??3);
scan.concentration_policy={mode:'TOP_3_OR_5_HIGH_CONVICTION',baseCount:DEFAULT_CONFIG.concentration?.baseCount??3,maxCount:DEFAULT_CONFIG.concentration?.maxCount??5,selected:concentrated.length,targetRMultiples:DEFAULT_CONFIG.concentration?.targetRMultiples??[2,3,4],paddingLowQualityCandidates:false};
if(!noWrite){writeJsonAtomic(path.join(dataDir,'current-scan.json'),scan);appendHistory(path.join(dataDir,'recommendation-history.json'),scan);writeJsonAtomic(path.join(dataDir,'engine-errors.json'),scan.errors);writeJsonAtomic(path.join(dataDir,'state-transitions.json'),scan.transitions);}
console.log(JSON.stringify({engineId:scan.engineId,generatedAt:scan.generatedAt,market:scan.market_status,coverage:scan.market_coverage,concentration:scan.concentration_policy,concentrationAudit,top:scan.top_recommendations.map(x=>({rank:x.conviction_rank,symbol:x.symbol,score:x.final_score,conviction:x.concentration_score,status:x.status,target:x.target_plan?.primaryTarget?.price,rr:x.reward_risk})),noHighConviction:scan.no_high_conviction_setup},null,2));
