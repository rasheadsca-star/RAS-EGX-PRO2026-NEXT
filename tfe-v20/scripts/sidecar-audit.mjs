import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { freezeDecisionRows } from '../sidecars/forward-evidence.js';
import { verifyOfficialSnapshot } from '../sidecars/data-verification.js';
import { auditHistoryDepth } from '../sidecars/history-depth.js';

const arg = (name) => process.argv.find((x)=>x.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;
const has = (name) => process.argv.includes(`--${name}`);
const base = (arg('base') || process.env.TFE_BASE_URL || 'https://egx-tfe-v20-fusion-rc2.vercel.app').replace(/\/$/,'');

async function get(route) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),30_000);
  try {
    const r = await fetch(`${base}/api/index?${route}`,{headers:{'user-agent':'TFE-RC2-SIDECAR-AUDIT'},signal:controller.signal,cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP_${r.status}:${route}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

const health = await get('route=health');
const market = await get('route=market-index');
const decision = await get('route=decision-log');
const depth = auditHistoryDepth(market.symbols);
const snapshot = freezeDecisionRows(decision.rows,{generatedAt:decision.generatedAt,sourceCommit:decision.sourceCommit});

let officialVerification = null;
const officialPath = arg('official');
if (officialPath) {
  const officialRows = JSON.parse(await readFile(resolve(officialPath),'utf8'));
  const marketRows=[];
  for (const ref of officialRows) {
    const ticker=String(ref.ticker??'').toUpperCase();
    if(!ticker) continue;
    const h=await get(`route=history&ticker=${encodeURIComponent(ticker)}&limit=2`);
    const last=h.bars?.at(-1);
    marketRows.push({ticker,lastSession:last?.date??null,close:last?.close??null});
  }
  officialVerification=verifyOfficialSnapshot({marketRows,officialRows});
}

let writtenForwardSnapshot = null;
if (has('write-forward')) {
  const output = resolve(arg('output') || `evidence/forward/${snapshot.signals[0]?.sessionDate || 'unknown'}-${String(snapshot.sourceCommit||'unknown').slice(0,12)}.json`);
  try { await access(output); throw new Error(`IMMUTABLE_FORWARD_SNAPSHOT_EXISTS:${output}`); } catch (e) { if(String(e.message).startsWith('IMMUTABLE_')) throw e; }
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
  writtenForwardSnapshot=output;
}

const report={
  ok:true,
  schemaVersion:'tfe.sidecar-audit.1',
  base,
  engine:health.engine,
  sourceCommit:health.sourceCommit,
  scoringImpact:'NONE',
  productionRuntimeMutation:false,
  depth:{total:depth.total,robustRegimeCoveragePct:depth.robustRegimeCoveragePct,counts:depth.counts},
  forward:{sessionDate:snapshot.signals[0]?.sessionDate??null,signals:snapshot.signals.length,snapshotHash:snapshot.snapshotHash,writtenForwardSnapshot},
  officialVerification:officialVerification?{total:officialVerification.total,counts:officialVerification.counts,scoringImpact:'NONE'}:{status:'NOT_SUPPLIED',scoringImpact:'NONE'},
};
console.log(JSON.stringify(report,null,2));
