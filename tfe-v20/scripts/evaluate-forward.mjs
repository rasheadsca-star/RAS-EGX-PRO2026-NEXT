import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateFrozenSignal, summarizeForwardEvidence } from '../sidecars/forward-evidence.js';

const snapshotPath=process.argv[2];
if(!snapshotPath) throw new Error('USAGE: node scripts/evaluate-forward.mjs <snapshot.json> [baseUrl]');
const base=(process.argv[3]||process.env.TFE_BASE_URL||'https://egx-tfe-v20-fusion-rc2.vercel.app').replace(/\/$/,'');
const snapshot=JSON.parse(await readFile(resolve(snapshotPath),'utf8'));
if(snapshot.immutable!==true||snapshot.scoringImpact!=='NONE') throw new Error('INVALID_FORWARD_SNAPSHOT');

async function history(ticker){
  const r=await fetch(`${base}/api/index?route=history&ticker=${encodeURIComponent(ticker)}&limit=500`,{cache:'no-store',headers:{'user-agent':'TFE-RC2-FORWARD-EVALUATOR'}});
  if(!r.ok) throw new Error(`HISTORY_HTTP_${r.status}:${ticker}`);
  return await r.json();
}

const results=[];
for(const signal of snapshot.signals||[]){
  const h=await history(signal.ticker);
  results.push(evaluateFrozenSignal(signal,h.bars||[]));
}
console.log(JSON.stringify({
  ok:true,
  schemaVersion:'tfe.forward-evaluation.1',
  sourceSnapshotHash:snapshot.snapshotHash,
  sourceCommit:snapshot.sourceCommit,
  scoringImpact:'NONE',
  summary:summarizeForwardEvidence(results),
  results,
},null,2));
