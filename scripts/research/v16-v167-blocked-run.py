#!/usr/bin/env python3
import json
import runpy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ns = runpy.run_path(
    str(ROOT / 'scripts/research/v16-v167-coherent-engine.py'),
    run_name='v167_blocked_impl',
)

CONFIGS = [
    {'id': 'FAST_2D', 'horizon': 2, 'targetAtr': 1.00, 'stopAtr': 0.80},
    {'id': 'BALANCED_3D', 'horizon': 3, 'targetAtr': 1.25, 'stopAtr': 0.90},
    {'id': 'BALANCED_5D', 'horizon': 5, 'targetAtr': 1.50, 'stopAtr': 1.00},
]
EMBARGO = 3
WARMUP = 28
INNER_VALIDATION = 4
BLOCK_SIZE = 5
MIN_EV = 0.03
OUT = ROOT / 'data/research/v16-v167-coherent-engine.json'

_original_entry = ns['train_entry_logit']
_original_softmax = ns['train_softmax']
_original_time = ns['train_time_regression']


def fit_fast(rows):
    rows = rows[-1400:]
    if not rows:
        return None
    entry = _original_entry(rows, epochs=5, lr=0.045, l2=0.016)
    multi = _original_softmax(rows, epochs=8, lr=0.055, l2=0.018)
    time_model = _original_time(rows, epochs=10, lr=0.022, l2=0.032)
    if entry is None or multi is None or time_model is None:
        return None
    entered = [row for row in rows if row['entered'] and row['class'] is not None]
    base_class = [
        sum(row['class'] == klass for row in entered) / max(1, len(entered))
        for klass in range(3)
    ]
    return {'entry': entry, 'multi': multi, 'time': time_model, 'baseClass': base_class}


ns['fit_models'] = fit_fast
ns['CONFIGS'] = CONFIGS
ns['MIN_CONDITIONAL_EV_PCT'] = MIN_EV


def build_datasets(dates, by_date):
    datasets = {}
    for config in CONFIGS:
        labeled, rows, rows_by_date = ns['build_dataset_for_config'](dates, by_date, config)
        datasets[config['id']] = {'labeledDates': labeled, 'rows': rows, 'rowsByDate': rows_by_date}
    return datasets


def evaluate_latest_configs(common_dates, datasets):
    available = common_dates[:-EMBARGO]
    validation = available[-INNER_VALIDATION:]
    training = available[:-INNER_VALIDATION]
    results = [ns['evaluate_config'](config, training, validation, datasets) for config in CONFIGS]
    results = [item for item in results if item]
    results.sort(key=lambda item: (item['objective'], item['metrics']['selectedTrades']), reverse=True)
    return results


def main():
    _, dates, by_date = ns['build_market']()
    datasets = build_datasets(dates, by_date)
    common_dates = dates[:-max(config['horizon'] for config in CONFIGS)]
    sessions = []
    usage = {config['id']: 0 for config in CONFIGS}

    first_block = WARMUP + EMBARGO
    for block_start in range(first_block, len(common_dates), BLOCK_SIZE):
        block_dates = common_dates[block_start:block_start + BLOCK_SIZE]
        available = common_dates[:block_start - EMBARGO]
        if len(available) < WARMUP:
            continue
        validation = available[-INNER_VALIDATION:]
        training = available[:-INNER_VALIDATION]
        results = [ns['evaluate_config'](config, training, validation, datasets) for config in CONFIGS]
        results = [item for item in results if item]
        if not results:
            continue
        results.sort(key=lambda item: (item['objective'], item['metrics']['selectedTrades']), reverse=True)
        config = results[0]['config']
        usage[config['id']] += len(block_dates)

        train_rows = [row for date in available for row in datasets[config['id']]['rowsByDate'].get(date, [])]
        models = fit_fast(train_rows)
        if not models:
            continue
        correlations, lifts = ns['model_lifts'](train_rows[-1400:])
        for date in block_dates:
            rows = datasets[config['id']]['rowsByDate'].get(date, [])
            _, selection, meta = ns['score_session'](rows, models, config, correlations, lifts)
            sessions.append({
                'signalDate': date,
                'configuration': config['id'],
                'positions': len(selection),
                'tickers': [row['ticker'] for row in selection],
                'portfolioNetReturnPct': ns['round_value'](ns['session_return'](selection), 4),
                'selectionMeta': meta,
                'innerValidation': {
                    'objective': ns['round_value'](results[0]['objective'], 5),
                    'metrics': results[0]['metrics'],
                },
                'trades': [
                    {
                        'ticker': row['ticker'],
                        'status': row['outcome']['status'],
                        'netReturnPct': ns['round_value'](row['outcome']['netReturnPct'], 4),
                        'predictedConditionalEvPct': ns['round_value'](row['conditionalEvPct'], 4),
                        'pTargetPct': ns['round_value'](row['pTarget'] * 100, 2),
                        'pStopPct': ns['round_value'](row['pStop'] * 100, 2),
                    }
                    for row in selection
                ],
            })

    metrics = ns['summarize_sessions'](sessions)
    acceptance = {
        'minimumEvaluatedSessions': metrics['evaluatedSessions'] >= 20,
        'minimumTradedSessions': metrics['tradedSessions'] >= 8,
        'positiveAverageNetReturn': (metrics['averageNetPortfolioReturnPct'] or 0.0) > 0.0,
        'positiveCompoundedReturn': (metrics['compoundedNetReturnPct'] or 0.0) > 0.0,
        'profitFactorAtLeast110': (metrics['profitFactor'] or 0.0) >= 1.10,
        'maximumDrawdownAboveMinus12': (metrics['maximumDrawdownPct'] or -100.0) >= -12.0,
        'tradeWinRateAtLeast40': (metrics['tradeWinRatePct'] or 0.0) >= 40.0,
        'calibrationDirectionValid': (
            (metrics['averagePredictedConditionalEvPct'] or 0.0) > 0.0
            and (metrics['averageActualTradeReturnPct'] or -99.0) > -0.25
        ),
    }
    production_eligible = all(acceptance.values())

    config_results = evaluate_latest_configs(common_dates, datasets)
    config = config_results[0]['config']
    train_rows = [row for date in common_dates for row in datasets[config['id']]['rowsByDate'].get(date, [])]
    models = fit_fast(train_rows)
    correlations, lifts = ns['model_lifts'](train_rows[-1400:])
    latest_date = dates[-1]
    latest_rows = []
    for feature in by_date[latest_date]:
        flags = ns['extended_flags'](feature)
        latest_rows.append({
            'signalDate': latest_date,
            'ticker': feature['ticker'],
            'name': feature['name'],
            'feature': feature,
            'flags': flags,
            'x': ns['v167_vector'](feature, flags),
            'outcome': {'entered': 0, 'status': 'FUTURE_UNKNOWN', 'netReturnPct': 0.0},
        })
    scored = [ns['score_row'](row, models, config, correlations, lifts) for row in latest_rows]
    selection, selection_meta = ns['choose_portfolio'](scored)
    ranked = sorted(scored, key=lambda row: (row['qualityScore'], row['conditionalEvPct']), reverse=True)
    approved = [
        ns['output_candidate'](row, index, config, 'PRIMARY')
        for index, row in enumerate(selection, 1)
    ]
    watchlist = [
        ns['output_candidate'](row, index, config, 'WATCH')
        for index, row in enumerate(ranked[:10], 1)
    ]

    report = {
        'schemaVersion': '16.7.1-coherent-blocked-nested-walk-forward',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'status': 'PRODUCTION_GATE_PASSED' if production_eligible else 'RESEARCH_GATE_NOT_PASSED',
        'productionEligible': production_eligible,
        'methodology': {
            'probabilityModel': 'Single coherent softmax for TARGET, STOP and TIME_EXIT.',
            'timeExitModel': 'Per-stock regularized expected return model.',
            'outerValidation': f'Blocked walk-forward with {BLOCK_SIZE}-session fixed deployment blocks.',
            'innerSelection': f'{INNER_VALIDATION}-session inner validation with {EMBARGO}-session embargo.',
            'candidateGate': 'Positive conditional expected value after 0.60% round-trip cost.',
            'configurations': CONFIGS,
        },
        'walkForwardMetrics': metrics,
        'acceptanceGate': acceptance,
        'configurationUsage': usage,
        'currentSignalDate': latest_date,
        'currentConfiguration': config,
        'currentSelectionMeta': selection_meta,
        'currentRecommendations': approved if production_eligible else [],
        'currentResearchCandidates': watchlist,
        'recentWalkForwardSessions': sessions[-15:],
        'latestConfigurationValidation': [
            {
                'configuration': item['config']['id'],
                'objective': ns['round_value'](item['objective'], 5),
                'metrics': item['metrics'],
            }
            for item in config_results
        ],
        'notesAr': [
            'عدم اجتياز البوابة لا يعني غياب الفرص، بل يعني عدم ثبوت جودة اختيار النموذج.',
            'الإعداد يثبت لخمس جلسات خارج العينة بدل إعادة اختياره بعد معرفة نتيجة كل جلسة.',
            'التنفيذ النهائي يحتاج تأكيد الافتتاح والسيولة خلال أول 10–15 دقيقة.',
        ],
    }
    ns['wr'](OUT, report)
    print(json.dumps({
        'status': report['status'],
        'productionEligible': production_eligible,
        'walkForwardMetrics': metrics,
        'acceptanceGate': acceptance,
        'currentConfiguration': config,
        'currentRecommendations': report['currentRecommendations'],
        'topResearchCandidates': watchlist[:5],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
