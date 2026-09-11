import fs from 'node:fs/promises';
import path from 'node:path';
import { createV17ResearchObservationState, summarizeV17ResearchObservationState } from '../src/v17ResearchObservationEngine.js';

const SNAPSHOT_FILE = 'forward-ledger/snapshots/2026-08-30-89a9e2ae85a9.json';
const EXPECTED_HASH = '89a9e2ae85a94b6a18ffeb08daff691577db452dd10abd2b7de9e352a188573e';
const EXPECTED_SIGNAL_DATE = '2026-08-30';
const EXPECTED_NEXT_DATE = '2026-08-31';

const snapshot = JSON.parse(await fs.readFile(path.resolve(SNAPSHOT_FILE), 'utf8'));
if (snapshot.snapshotHash !== EXPECTED_HASH) throw new Error('V17_FROZEN_SNAPSHOT_HASH_MISMATCH');
if (snapshot.signalSessionDate !== EXPECTED_SIGNAL_DATE) throw new Error('V17_SIGNAL_DATE_MISMATCH');
if (snapshot?.marketCalendar?.nextTradingSessionDate !== EXPECTED_NEXT_DATE) throw new Error('V17_NEXT_SESSION_DATE_MISMATCH');
if (snapshot.capturedBeforeNextSessionOpen !== true) throw new Error('V17_PREOPEN_BOUNDARY_INVALID');

const state = createV17ResearchObservationState({ snapshot });
const summary = summarizeV17ResearchObservationState(state);
if (!summary.readiness.ready) throw new Error(`V17_DATA_READINESS_BLOCKED:${summary.readiness.blockers.join('|')}`);

const report = {
  schemaVersion: 'egx.v17-research-shell-report.1',
  generatedAt: new Date().toISOString(),
  status: 'FROZEN_PREOPEN_RESEARCH_SHELL_READY',
  researchOnly: true,
  productionAuthority: false,
  automaticOrders: false,
  championCore: summary.championCore,
  snapshotHash: summary.snapshotHash,
  signalSessionDate: summary.signalSessionDate,
  nextTradingSessionDate: summary.nextTradingSessionDate,
  readiness: summary.readiness,
  maxConcurrentObservedPositions: summary.maxConcurrentObservedPositions,
  executionStudyContract: {
    nextSessionOnly: true,
    noGapDownRecoveryFill: true,
    noChaseAboveEntryZoneWithoutRetrace: true,
    maxHoldSessions: 3,
    sameBarTargetStop: 'STOP_FIRST',
    roundTripCostPct: 0.6,
    noSameObservationSlotReuse: true,
    outcomeRetuningAllowed: false,
  },
  frozenRecommendations: state.signals.map((signal) => ({
    ticker: signal.ticker,
    rank: signal.rank,
    category: signal.category,
    score: signal.score,
    entryLow: signal.entryLow,
    entryHigh: signal.entryHigh,
    stopLoss: signal.stopLoss,
    target1: signal.target1,
    metaShadow: signal.metaShadow ? {
      decision: signal.metaShadow.decision,
      metaScore: signal.metaShadow.metaScore,
      sourceConsensus: signal.metaShadow.sourceConsensus,
    } : null,
  })),
};

await fs.mkdir(path.resolve('reports'), { recursive: true });
await fs.writeFile(path.resolve('reports/v17-research-shell.json'), JSON.stringify(report, null, 2) + '\n');

const rows = report.frozenRecommendations.map((r) => `
<tr>
  <td><b>${r.ticker}</b></td><td>${r.category}</td><td>${r.entryLow.toFixed(4)}–${r.entryHigh.toFixed(4)}</td>
  <td>${r.stopLoss.toFixed(4)}</td><td>${r.target1.toFixed(4)}</td><td>${r.score?.toFixed?.(3) ?? ''}</td>
  <td>${r.metaShadow ? `${r.metaShadow.decision} (${r.metaShadow.metaScore})` : 'N/A'}</td>
  <td class="pending">AWAITING 31-AUG OBSERVATION</td>
</tr>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>V17 Professional Decision Engine — Research</title>
<style>body{font-family:Arial,sans-serif;background:#08111f;color:#e8eefc;margin:0;padding:24px}.wrap{max-width:1200px;margin:auto}.badge{display:inline-block;padding:7px 11px;border-radius:999px;background:#23314e;font-weight:700}.card{background:#111b2e;border:1px solid #293955;border-radius:16px;padding:20px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.kpi{background:#0d1728;border-radius:12px;padding:16px}.kpi b{font-size:22px;display:block;margin-top:6px}.good{color:#7ee787}.warn{color:#ffd166}.pending{color:#79c0ff;font-weight:700}.muted{color:#9fb0cb}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;min-width:900px}th,td{padding:11px;border-bottom:1px solid #283750;text-align:left;white-space:nowrap}.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{padding:7px 10px;border-radius:999px;background:#0d1728;border:1px solid #293955;font-size:13px}.hash{font-family:monospace;word-break:break-all}</style></head>
<body><div class="wrap"><span class="badge">V17 RESEARCH / NO PRODUCTION AUTHORITY</span><h1>V17 Professional Decision Engine</h1>
<p class="muted">V16 selection core + frozen execution observation layer + data readiness + two-position portfolio governor + append-only evidence ledger.</p>
<div class="grid"><div class="kpi">Champion Core<b>V16</b></div><div class="kpi">Signal Session<b>30 Aug 2026</b></div><div class="kpi">Forward Session<b>31 Aug 2026</b></div><div class="kpi">Data Gate<b class="good">${report.readiness.status}</b></div></div>
<div class="card"><h2>Frozen Forward Cohort</h2><div class="scroll"><table><tr><th>Ticker</th><th>Role</th><th>Entry Zone</th><th>Frozen Stop</th><th>Target 1</th><th>V16 Score</th><th>Meta Shadow</th><th>V17 Research State</th></tr>${rows}</table></div></div>
<div class="card"><h2>Frozen Research Contract</h2><div class="chips"><span class="chip">NEXT SESSION ONLY</span><span class="chip">NO GAP-DOWN RECOVERY FILL</span><span class="chip">NO CHASE</span><span class="chip">MAX 2 OBSERVED POSITIONS</span><span class="chip">3 SESSIONS</span><span class="chip">STOP FIRST</span><span class="chip">0.60% COST</span><span class="chip">NO RETUNING</span></div>
<p class="warn"><b>Research observation only.</b> No automatic orders, no production promotion and no positive alpha weight.</p></div>
<div class="card"><h2>Evidence Anchor</h2><p>Snapshot SHA-256</p><p class="hash">${report.snapshotHash}</p><p class="muted">Optional V20 input is stale and remains explicitly degraded; V16, regime and Triple are the critical same-session sources.</p></div>
</div></body></html>`;

await fs.mkdir(path.resolve('v17-research'), { recursive: true });
await fs.writeFile(path.resolve('v17-research/index.html'), html);

console.log(JSON.stringify({
  ok: true,
  status: report.status,
  snapshotHash: report.snapshotHash,
  signalSessionDate: report.signalSessionDate,
  nextTradingSessionDate: report.nextTradingSessionDate,
  readiness: report.readiness,
  recommendations: report.frozenRecommendations.map((x) => x.ticker),
  outputs: ['reports/v17-research-shell.json', 'v17-research/index.html'],
}, null, 2));
