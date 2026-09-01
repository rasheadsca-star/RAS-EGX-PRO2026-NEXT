#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-/tmp/egx-one-live}"
rm -rf "$OUT"
mkdir -p \
  "$OUT/data/research/ui" \
  "$OUT/data/research/strategy" \
  "$OUT/data/research/published" \
  "$OUT/data/research/simulator" \
  "$OUT/data/research/shadow-ledger/policies" \
  "$OUT/data/research/live" \
  "$OUT/.vercel"

cp index.html "$OUT/index.html"
cp technical-chart-v2.js "$OUT/technical-chart-v2.js"
cp technical-chart-v2-core.js "$OUT/technical-chart-v2-core.js"
cp technical-chart-v21-alignment.js "$OUT/technical-chart-v21-alignment.js"
cp realized-kpi.js "$OUT/realized-kpi.js"
cp championship-board.js "$OUT/championship-board.js"
cp data/research/ui/latest.json "$OUT/data/research/ui/latest.json"
cp data/research/strategy/latest.json "$OUT/data/research/strategy/latest.json"
cp data/research/published/latest.json "$OUT/data/research/published/latest.json"
cp data/research/simulator/latest.json "$OUT/data/research/simulator/latest.json"
cp data/research/shadow-ledger/latest.json "$OUT/data/research/shadow-ledger/latest.json"
cp data/research/live/latest.json "$OUT/data/research/live/latest.json"

STRATEGY_HASH="$(node --input-type=module -e "import fs from 'node:fs';const s=JSON.parse(fs.readFileSync('data/research/strategy/latest.json','utf8'));process.stdout.write(String(s.strategySnapshotHash||''));")"
if [[ ! "$STRATEGY_HASH" =~ ^[a-f0-9]{64}$ ]]; then
  echo "BUNDLE_STRATEGY_HASH_INVALID:$STRATEGY_HASH"
  exit 1
fi
POLICY_SRC="data/research/shadow-ledger/policies/${STRATEGY_HASH}.json"
if [[ ! -s "$POLICY_SRC" ]]; then
  echo "BUNDLE_FORWARD_POLICY_MISSING:$POLICY_SRC"
  exit 1
fi
cp "$POLICY_SRC" "$OUT/data/research/shadow-ledger/policies/${STRATEGY_HASH}.json"

cat > "$OUT/vercel.json" <<'JSON'
{"cleanUrls":true,"trailingSlash":false}
JSON

if [[ -n "${VERCEL_PROJECT_ID:-}" && -n "${VERCEL_ORG_ID:-}" ]]; then
  printf '%s\n' '{"projectId":"'"$VERCEL_PROJECT_ID"'","orgId":"'"$VERCEL_ORG_ID"'"}' > "$OUT/.vercel/project.json"
fi

for f in \
  index.html \
  technical-chart-v2.js \
  technical-chart-v2-core.js \
  technical-chart-v21-alignment.js \
  realized-kpi.js \
  championship-board.js \
  data/research/ui/latest.json \
  data/research/strategy/latest.json \
  data/research/published/latest.json \
  data/research/simulator/latest.json \
  data/research/shadow-ledger/latest.json \
  data/research/live/latest.json \
  "data/research/shadow-ledger/policies/${STRATEGY_HASH}.json"; do
  test -s "$OUT/$f" || { echo "BUNDLE_FILE_MISSING:$f"; exit 1; }
done

node --input-type=module - "$OUT" "${GITHUB_SHA:-}" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=process.argv[2],sourceCommit=(process.argv[3]||null);
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const u=read('data/research/ui/latest.json');
const s=read('data/research/strategy/latest.json');
const p=read('data/research/published/latest.json');
const l=read('data/research/live/latest.json');
const shadow=read('data/research/shadow-ledger/latest.json');
const sim=read('data/research/simulator/latest.json');
const policyPath=`data/research/shadow-ledger/policies/${s.strategySnapshotHash}.json`;
const policy=read(policyPath);
if(s.signalSession!==p.signalSession||s.signalSession!==u.session)throw new Error('BUNDLE_SESSION_MISMATCH');
if(l.expectedSession!==s.signalSession||l.targetSession!==s.signalSession)throw new Error('BUNDLE_LIVE_SESSION_MISMATCH');
if(u.authorityMode!=='RESEARCH'||u.researchOnly!==true||u.productionAuthority!==false||u.notARecommendation!==true)throw new Error('BUNDLE_UI_AUTHORITY_BOUNDARY_FAILED');
if(s.authorityMode!=='RESEARCH'||s.productionAuthority!==false||s.automaticOrders!==false||s.validation?.accepted!==true||!Array.isArray(s.recommendations)||!s.recommendations.length)throw new Error('BUNDLE_STRATEGY_BOUNDARY_FAILED');
if(p.authorityMode!=='RESEARCH'||p.productionAuthority!==false||p.automaticOrders!==false)throw new Error('BUNDLE_PUBLICATION_BOUNDARY_FAILED');
if(l.authorityMode!=='RESEARCH'||l.researchOnly!==true||l.productionAuthority!==false)throw new Error('BUNDLE_LIVE_AUTHORITY_BOUNDARY_FAILED');
if(p.sourceStrategySnapshotHash!==s.strategySnapshotHash)throw new Error('BUNDLE_LINEAGE_MISMATCH');
if(shadow.authorityMode!=='RESEARCH'||shadow.productionAuthority!==false||shadow.automaticOrders!==false)throw new Error('BUNDLE_SHADOW_AUTHORITY_BOUNDARY_FAILED');
if(policy.strategySnapshotHash!==s.strategySnapshotHash||policy.authorityMode!=='RESEARCH'||policy.productionAuthority!==false||policy.automaticOrders!==false||policy.sameBarAmbiguity!=='STOP_FIRST'||policy.costAssumptionBps!==25)throw new Error('BUNDLE_FORWARD_POLICY_BOUNDARY_FAILED');
const perf=sim.performance?.allDailySignals;
if(!perf||!Number.isFinite(perf.triggered)||!Number.isFinite(perf.target1OrBetter)||!Number.isFinite(perf.stops)||!Number.isFinite(perf.timeouts))throw new Error('BUNDLE_SIMULATOR_PERFORMANCE_MISSING');
const files=[
  'index.html','technical-chart-v2.js','technical-chart-v2-core.js','technical-chart-v21-alignment.js','realized-kpi.js','championship-board.js',
  'data/research/ui/latest.json','data/research/strategy/latest.json','data/research/published/latest.json','data/research/simulator/latest.json',
  'data/research/shadow-ledger/latest.json','data/research/live/latest.json',policyPath,'vercel.json'
];
const fileHashes=Object.fromEntries(files.map(file=>[file,{sha256:sha(file),bytes:fs.statSync(path.join(root,file)).size}]));
const body={
  schemaVersion:'egx-one-production-bundle-manifest-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,
  sourceCommit,signalSession:s.signalSession,strategySnapshotHash:s.strategySnapshotHash,publicationHash:p.publicationHash??null,forwardPolicyHash:policy.policyHash,
  chartContract:'TECHNICAL_CHART_V2_1_SESSION_ALIGNMENT',chartCurrentBarPolicy:'READY_RESEARCH_EXACT_SESSION_ONLY',kpiContract:'REALIZED_OUTCOMES_KPI_V1',championshipContract:'EGX_ONE_CHAMPIONSHIP_BOARD',
  forwardResolution:{sameBarAmbiguity:policy.sameBarAmbiguity,costAssumptionBps:policy.costAssumptionBps,costConvention:policy.costConvention,fillConvention:policy.fillConvention},
  files:fileHashes
};
const canonical=JSON.stringify(body);
const manifest={...body,bundleManifestHash:crypto.createHash('sha256').update(canonical).digest('hex')};
fs.writeFileSync(path.join(root,'egx-one-production-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`EGX_ONE_BUNDLE_VERIFIED:SESSION=${s.signalSession}:RECS=${s.recommendations.length}:TRIGGERED=${perf.triggered}:TARGET=${perf.target1HitRatePct}:STOP=${perf.stopRatePct}:MANIFEST=${manifest.bundleManifestHash}`);
NODE

grep -q 'EGXOneTechnicalV2Loader' "$OUT/technical-chart-v2.js"
grep -q 'championship-board.js' "$OUT/technical-chart-v2.js"
grep -q 'EGXOneTechnicalV2' "$OUT/technical-chart-v2-core.js"
grep -q 'EGXOneTechnicalV21' "$OUT/technical-chart-v21-alignment.js"
grep -q 'READY_RESEARCH_EXACT_SESSION_ONLY' "$OUT/technical-chart-v21-alignment.js"
grep -q 'EGXOneRealizedKPI' "$OUT/realized-kpi.js"
grep -q "scoringImpact:'NONE'" "$OUT/realized-kpi.js"
grep -q 'EGXOneChampionshipBoard' "$OUT/championship-board.js"
grep -q "productionAuthority:false" "$OUT/championship-board.js"
grep -q "scoringImpact:'NONE'" "$OUT/championship-board.js"
test -s "$OUT/egx-one-production-manifest.json"

echo "EGX_ONE_COMPLETE_LIVE_BUNDLE_READY:$OUT"
