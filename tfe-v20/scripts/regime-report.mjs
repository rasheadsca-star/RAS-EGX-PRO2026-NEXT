import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { classifyRegimeAtDate, segmentEvidenceByRegime } from '../sidecars/regime-analysis.js';

const benchmarkPath=process.argv[2];
const evaluationPath=process.argv[3];
if(!benchmarkPath||!evaluationPath) throw new Error('USAGE: node scripts/regime-report.mjs <benchmark-history.json> <forward-evaluation.json>');
const benchmarkRaw=JSON.parse(await readFile(resolve(benchmarkPath),'utf8'));
const benchmark=benchmarkRaw.sessions??benchmarkRaw.rows??benchmarkRaw.bars??[];
const evaluation=JSON.parse(await readFile(resolve(evaluationPath),'utf8'));
const rows=(evaluation.results??[]).map((x)=>({
  ...x,
  ...classifyRegimeAtDate(benchmark,x.signalDate),
}));
console.log(JSON.stringify({
  ok:true,
  schemaVersion:'tfe.regime-report.1',
  scoringImpact:'NONE',
  futureBenchmarkRowsExcluded:true,
  summary:segmentEvidenceByRegime(rows),
  rows,
},null,2));
