#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function read(rel){const f=path.join(ROOT,rel);if(!fs.existsSync(f))throw new Error(`Missing ${rel}`);return JSON.parse(fs.readFileSync(f,'utf8'))}
function A(v){return Array.isArray(v)?v:[]};function fail(m){console.error(`V13.17 ACCEPTANCE FAILURE: ${m}`);process.exit(1)}
const policy=read('data/v13-17-intelligence-policy.json'),center=read('data/quant/unified-autonomous-center-v13-14.json'),search=read('data/quant/market-search-index-v13-17.json'),flow=read('data/lab/momentum-money-flow-v13-17.json');
if(center.patchVersion!=='13.17.0')fail(`unexpected center patch ${center.patchVersion}`);if(center.liveExecutionEnabled!==false||center.automaticOrderSubmission!==false)fail('live execution safety changed');
for(const obj of [search,flow]){if(obj.affectsProductionRanking!==false||obj.affectsProductionDecision!==false)fail('new intelligence affects production')}
if(flow.changesStrategyRules!==false||flow.changesEntryStopTargets!==false)fail('strategy or plan rules changed');if(flow.identityInference!==false)fail('institution identity inference enabled');
if(policy.marketSearch.forceOutsideStocksIntoTier!==false)fail('outside stocks can be forced into tiers');if(policy.productionSafety.changesActivationThresholds!==false)fail('activation thresholds changed');
const tickers=A(search.stocks).map(x=>x.ticker);if(new Set(tickers).size!==tickers.length)fail('duplicate search tickers');if(!tickers.length)fail('empty full-market search index');
const candidateSet=new Set(A(center.candidates).map(x=>x.ticker));for(const x of A(search.stocks)){if(candidateSet.has(x.ticker)!==Boolean(x.inTodayRecommendations))fail(`${x.ticker} recommendation membership mismatch`);if(!x.inTodayRecommendations&&x.decisionCode!=='NOT_RECOMMENDED_TODAY')fail(`${x.ticker} outside recommendation decision invalid`)}
for(const x of A(flow.stocks)){if(x.identityInference!==false)fail(`${x.ticker} identity inference flag invalid`);if(x.moneyFlowQualityScore!==null&&(x.moneyFlowQualityScore<0||x.moneyFlowQualityScore>100))fail(`${x.ticker} score outside 0-100`)}
console.log(`V13.17 acceptance passed: searchable=${tickers.length}, outsideToday=${search.summary?.outsideToday||0}, flow=${flow.summary?.analyzedStocks||0}.`);
