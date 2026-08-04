#!/usr/bin/env python3
import json
import math
import os
import runpy
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
BASE = runpy.run_path(str(ROOT / 'scripts/research/v16-v166-triple-barrier.py'), run_name='v166_diag_base')

build_dataset = BASE['build_dataset']
fit_models = BASE['fit_models']
score_row = BASE['score_row']
model_lifts = BASE['model_lifts']
execution_reasons = BASE['execution_reasons']
round_value = BASE['round_value']
wr = BASE['wr']
WARMUP = BASE['WARMUP_SESSIONS']
EMBARGO = BASE['EMBARGO_SESSIONS']
MIN_ENTRY = BASE['MIN_ENTRY_PROB']
MIN_TARGET = BASE['MIN_TARGET_PROB']
MIN_RATIO = BASE['MIN_TARGET_STOP_RATIO']
MIN_EV = BASE['MIN_EV_PCT']
OUT = ROOT / 'data/research/v16-v166-gate-diagnostic.json'


def mean(values, default=0.0):
    values = [x for x in values if isinstance(x, (int, float)) and math.isfinite(x)]
    return statistics.fmean(values) if values else default


def qtile(values, q):
    values = sorted(x for x in values if isinstance(x, (int, float)) and math.isfinite(x))
    if not values:
        return None
    pos = (len(values) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(values) - 1)
    frac = pos - lo
    return values[lo] * (1 - frac) + values[hi] * frac


def main():
    histories, dates, labeled_dates, by_date, rows, rows_by_date = build_dataset()
    entered = [r for r in rows if r['yEntry']]
    targets = [r for r in entered if r['yTarget']]
    stops = [r for r in entered if r['yStop']]
    time_exits = [r for r in entered if r['outcome']['status'] == 'TIME_EXIT']
    positives = [r for r in entered if r['yPositive']]

    outcome_distribution = {
        'allLabeledRows': len(rows),
        'enteredRows': len(entered),
        'entryRatePct': round_value(len(entered) / max(1, len(rows)) * 100, 3),
        'targets': len(targets),
        'targetRateAmongEnteredPct': round_value(len(targets) / max(1, len(entered)) * 100, 3),
        'stops': len(stops),
        'stopRateAmongEnteredPct': round_value(len(stops) / max(1, len(entered)) * 100, 3),
        'timeExits': len(time_exits),
        'timeExitRateAmongEnteredPct': round_value(len(time_exits) / max(1, len(entered)) * 100, 3),
        'positiveTrades': len(positives),
        'positiveRateAmongEnteredPct': round_value(len(positives) / max(1, len(entered)) * 100, 3),
        'averageNetReturnEnteredPct': round_value(mean([r['outcome']['netReturnPct'] for r in entered]), 4),
        'averageTimeExitNetReturnPct': round_value(mean([r['outcome']['netReturnPct'] for r in time_exits]), 4),
    }

    sessions = []
    for current_index in range(WARMUP + EMBARGO, len(labeled_dates)):
        signal_date = labeled_dates[current_index]
        training_dates = labeled_dates[:current_index - EMBARGO]
        training_rows = [row for d in training_dates for row in rows_by_date[d]]
        models = fit_models(training_rows)
        if not models:
            continue
        correlations, lifts = model_lifts(training_rows)
        scored = [score_row(row, models, correlations, lifts) for row in rows_by_date[signal_date]]

        counts = {
            'universe': len(scored),
            'actualEntered': sum(r['yEntry'] for r in scored),
            'actualTargets': sum(r['yTarget'] for r in scored),
            'actualStops': sum(r['yStop'] for r in scored),
            'actualPositiveTrades': sum(r['yPositive'] for r in scored),
            'passedTechnicalOnly': 0,
            'passedEntryOnly': 0,
            'passedTargetOnly': 0,
            'passedRatioOnly': 0,
            'passedEvOnly': 0,
            'passedAllOriginal': 0,
        }
        for row in scored:
            technical_ok = not execution_reasons(row['feature'])
            if technical_ok:
                counts['passedTechnicalOnly'] += 1
            if technical_ok and row['pEntry'] >= MIN_ENTRY:
                counts['passedEntryOnly'] += 1
            if technical_ok and row['pTarget'] >= MIN_TARGET:
                counts['passedTargetOnly'] += 1
            if technical_ok and row['targetStopRatio'] >= MIN_RATIO:
                counts['passedRatioOnly'] += 1
            if technical_ok and row['expectedValuePct'] >= MIN_EV:
                counts['passedEvOnly'] += 1
            if not row['exclusionReasons']:
                counts['passedAllOriginal'] += 1

        ranked_quality = sorted(scored, key=lambda r: (r['qualityScore'], r['expectedValuePct']), reverse=True)
        ranked_ev = sorted(scored, key=lambda r: r['expectedValuePct'], reverse=True)
        top2_quality = ranked_quality[:2]
        top2_ev = ranked_ev[:2]
        session_max_ev = ranked_ev[0]['expectedValuePct'] if ranked_ev else None
        sessions.append({
            'signalDate': signal_date,
            **counts,
            'modelTimeExitMeanPct': round_value(models['timeMean'], 4),
            'maxPredictedEvPct': round_value(session_max_ev, 4),
            'maxPredictedTargetPct': round_value(max((r['pTarget'] for r in scored), default=0) * 100, 3),
            'maxTargetStopRatio': round_value(max((r['targetStopRatio'] for r in scored), default=0), 4),
            'top2QualityTickers': [r['ticker'] for r in top2_quality],
            'top2QualityActualNetPct': round_value(mean([r['outcome']['netReturnPct'] for r in top2_quality if r['yEntry']]), 4),
            'top2EvTickers': [r['ticker'] for r in top2_ev],
            'top2EvActualNetPct': round_value(mean([r['outcome']['netReturnPct'] for r in top2_ev if r['yEntry']]), 4),
        })

    totals = {
        'evaluatedSessions': len(sessions),
        'sessionsWithAtLeastOneActualPositiveTrade': sum(s['actualPositiveTrades'] > 0 for s in sessions),
        'sessionsWithAtLeastOneActualTarget': sum(s['actualTargets'] > 0 for s in sessions),
        'sessionsWithAnyOriginalCandidate': sum(s['passedAllOriginal'] > 0 for s in sessions),
        'averageActualPositiveTradesPerSession': round_value(mean([s['actualPositiveTrades'] for s in sessions]), 3),
        'averageActualTargetsPerSession': round_value(mean([s['actualTargets'] for s in sessions]), 3),
        'averageTechnicalCandidatesPerSession': round_value(mean([s['passedTechnicalOnly'] for s in sessions]), 3),
        'averageEntryGateCandidatesPerSession': round_value(mean([s['passedEntryOnly'] for s in sessions]), 3),
        'averageTargetGateCandidatesPerSession': round_value(mean([s['passedTargetOnly'] for s in sessions]), 3),
        'averageRatioGateCandidatesPerSession': round_value(mean([s['passedRatioOnly'] for s in sessions]), 3),
        'averageEvGateCandidatesPerSession': round_value(mean([s['passedEvOnly'] for s in sessions]), 3),
        'medianSessionMaxPredictedEvPct': round_value(qtile([s['maxPredictedEvPct'] for s in sessions], 0.5), 4),
        'maximumSessionPredictedEvPct': round_value(max((s['maxPredictedEvPct'] for s in sessions), default=0), 4),
        'medianModelTimeExitMeanPct': round_value(qtile([s['modelTimeExitMeanPct'] for s in sessions], 0.5), 4),
        'averageTop2QualityActualNetPct': round_value(mean([s['top2QualityActualNetPct'] for s in sessions]), 4),
        'averageTop2EvActualNetPct': round_value(mean([s['top2EvActualNetPct'] for s in sessions]), 4),
    }

    report = {
        'schemaVersion': '16.6.1-gate-diagnostic',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'conclusion': 'ZERO_RECOMMENDATIONS_WAS_A_GATE_OR_CALIBRATION_RESULT_NOT_PROOF_OF_ZERO_MARKET_OPPORTUNITIES',
        'originalGates': {
            'minimumEntryProbability': MIN_ENTRY,
            'minimumTargetProbability': MIN_TARGET,
            'minimumTargetStopRatio': MIN_RATIO,
            'minimumExpectedValuePct': MIN_EV,
        },
        'outcomeDistribution': outcome_distribution,
        'walkForwardGateAudit': totals,
        'recentSessions': sessions[-15:],
        'confirmedIssues': [
            'The fixed target/stop ratio gate ignores the payoff asymmetry and duplicates the expected-value test.',
            'The fixed 28% target-probability gate is not referenced to the historical target base rate.',
            'A single global mean is used for every time-exit expected return, suppressing cross-sectional differences.',
            'The original production run computed model lifts and correlations on the full dataset instead of training-only folds.',
            'Independent target and stop binary models are not a coherent three-class probability distribution.',
            'Pair penalties mix percentage-point expected value with unitless correlation constants.',
        ],
    }
    wr(OUT, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
