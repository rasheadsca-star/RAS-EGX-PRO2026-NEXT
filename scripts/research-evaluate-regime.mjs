#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { evaluateHistoricalRegimeChallenger, verifyHistoricalRegimeEvaluation } from '../src/research-regime-evaluation.js';

const ROOT=process.cwd(),simPath=path.join(ROOT,'data','research','simulator','latest.json'),outDir=path.join(ROOT,'data','research','regime');if(!fs.existsSync(simPath))throw new Error('REGIME_EVALUATION_SIMULATOR_MISSING');const simulation=JSON.parse(fs.readFileSync(simPath,'utf8')),evaluation=evaluateHistoricalRegimeChallenger(simulation);if(!verifyHistoricalRegimeEvaluation(evaluation,simulation))throw new Error('REGIME_EVALUATION_VERIFY_FAILED');fs.mkdirSync(outDir,{recursive:true});fs.writeFileSync(path.join(outDir,'evaluation.json'),JSON.stringify(evaluation,null,2)+'\n');
console.log(JSON.stringify({replacementStatus:evaluation.replacementStatus,filterUsage:evaluation.filterUsage,allDaily:evaluation.comparison.allDailySignals,oneActive:evaluation.comparison.oneActivePlanPerTicker,monthlySignReversals:evaluation.historicalScreen.monthlySignReversals,evaluationHash:evaluation.evaluationHash},null,2));
