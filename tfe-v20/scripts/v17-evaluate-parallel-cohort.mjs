import fs from 'node:fs';
import path from 'node:path';
import { freezeV17ParallelCohort, evaluateParallelCohort } from '../src/v17ParallelSequentialValidation.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const snapshotsDir = path.join(root, 'forward-ledger', 'snapshots');
const reportDir = path.join(root, 'reports');
const signalDate = String(process.env.SIGNAL_DATE || process.argv[2] || '').slice(0, 10);
const barsPathArg = process.env.BARS_PATH || process.argv[3] || '';

if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate)) throw new Error('SIGNAL_DATE_REQUIRED_YYYY_MM_DD');
if (!barsPathArg) throw new Error('BARS_PATH_REQUIRED');

const candidates = fs.readdirSync(snapshotsDir)
  .filter((x) => x.startsWith(`${signalDate}-`) && x.endsWith('.json'))
  .sort();
if (candidates.length !== 1) throw new Error(`EXPECTED_EXACTLY_ONE_FROZEN_SNAPSHOT:${signalDate}:${candidates.length}`);

const snapshotPath = path.join(snapshotsDir, candidates[0]);
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const cohort = freezeV17ParallelCohort(snapshot);
const barsPath = path.resolve(barsPathArg);
const rawBars = JSON.parse(fs.readFileSync(barsPath, 'utf8'));
const barsByTicker = rawBars.barsByTicker || rawBars;
if (!barsByTicker || typeof barsByTicker !== 'object' || Array.isArray(barsByTicker)) throw new Error('BARS_BY_TICKER_INVALID');

const firstExpectedDate = cohort.nextTradingSessionDate;
for (const ticker of cohort.signals.map((x) => x.ticker)) {
  const bars = barsByTicker[ticker];
  if (!Array.isArray(bars) || bars.length === 0) throw new Error(`MISSING_BARS:${ticker}`);
  const dates = bars.map((b) => String(b.sessionDate || b.date || '').slice(0, 10));
  if (dates[0] !== firstExpectedDate) throw new Error(`FIRST_BAR_NOT_NEXT_SESSION:${ticker}:${dates[0]}:${firstExpectedDate}`);
  if (bars.length > 3) throw new Error(`TOO_MANY_BARS_FOR_FROZEN_HORIZON:${ticker}:${bars.length}`);
  if (new Set(dates).size !== dates.length) throw new Error(`DUPLICATE_BAR_DATE:${ticker}`);
  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i] <= dates[i - 1]) throw new Error(`NON_MONOTONIC_BAR_DATES:${ticker}`);
  }
}

const result = evaluateParallelCohort({ cohort, barsByTicker });
const allComplete = Object.values(result.arms).every((arm) => arm.complete === true);
const output = {
  ...result,
  sourceSnapshotHash: cohort.sourceSnapshotHash,
  contractHash: cohort.contractHash,
  evaluatedFromBarsFile: path.relative(root, barsPath).replaceAll('\\', '/'),
  readyToPersistResult: allComplete,
  researchOnly: true,
  productionAuthority: false,
  automaticOrders: false,
  automaticPromotion: false,
};

fs.mkdirSync(reportDir, { recursive: true });
const outputPath = path.join(reportDir, `v17-parallel-result-${signalDate}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(JSON.stringify({
  signalSessionDate: signalDate,
  cohortHash: cohort.cohortHash,
  contractHash: cohort.contractHash,
  readyToPersistResult: allComplete,
  arms: Object.fromEntries(Object.entries(result.arms).map(([id, arm]) => [id, {
    complete: arm.complete,
    entered: arm.entered,
    stops: arm.stops,
    targets: arm.targets,
    vetoes: arm.vetoes,
    noEntries: arm.noEntries,
    portfolioNetReturnPct: arm.portfolioNetReturnPct,
  }])),
  outputPath: path.relative(root, outputPath).replaceAll('\\', '/'),
}, null, 2));
