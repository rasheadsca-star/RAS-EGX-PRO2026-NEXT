#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHistoricalSimulator } from '../src/historical-simulator.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outDir=path.join(root,'data','research');
fs.mkdirSync(outDir,{recursive:true});
const arg=(name,fallback)=>{const p=process.argv.find(x=>x.startsWith(`--${name}=`));return p?p.slice(name.length+3):fallback;};
const maxSymbols=Number(arg('max-symbols','0'))||null;
const stepSessions=Math.max(1,Number(arg('step','5'))||5);
const maxSignalDates=Math.max(1,Number(arg('signals','120'))||120);
const minUniverse=Math.max(20,Number(arg('min-universe','60'))||60);
let lastStage='';let lastBucket=-1;
const onProgress=(p)=>{const bucket=Math.floor((p.index||0)/10);if(p.stage!==lastStage||bucket!==lastBucket){lastStage=p.stage;lastBucket=bucket;console.error(`[SEPA-X HIST] ${p.stage} ${p.index||''}/${p.total||''} ${p.symbol||p.date||''}`);}};
const report=await runHistoricalSimulator({maxSymbols,stepSessions,maxSignalDates,minUniverse,onProgress});
fs.writeFileSync(path.join(outDir,'historical-simulator.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'historical-simulator-summary.json'),JSON.stringify({schemaVersion:report.schemaVersion,engineId:report.engineId,generatedAt:report.generatedAt,methodology:report.methodology,dataset:report.dataset,summary:report.summary},null,2)+'\n');
console.log(JSON.stringify({ok:true,engineId:report.engineId,dataset:report.dataset,summary:report.summary},null,2));
if((report.summary?.signalDates??0)===0)process.exitCode=2;
