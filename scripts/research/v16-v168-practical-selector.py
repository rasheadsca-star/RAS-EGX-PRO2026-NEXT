#!/usr/bin/env python3
from v168_selector_core import *

def main():
    histories = [norm_hist(path) for path in HISTORY_DIR.glob('*.json')]
    histories = [history for history in histories if history['ok'] and len(history['rows']) >= 60]
    by_date = {}
    for history in histories:
        for index in range(55, len(history['rows'])):
            feature = base_feature(history, index)
            if not feature:
                continue
            feature = augment_feature(history, index, feature)
            feature['_history'] = history
            feature['_index'] = index
            by_date.setdefault(feature['date'], []).append(feature)
    dates = sorted(date for date, values in by_date.items() if len(values) >= MIN_UNIVERSE)
    for date in dates:
        market_median = median([feature['ret20'] for feature in by_date[date]])
        for feature in by_date[date]:
            feature['rs20'] = feature['ret20'] - market_median

    rows = []
    rows_by_date = {}
    for date_index, signal_date in enumerate(dates[:-1]):
        outcome_date = dates[date_index + 1]
        outcome_map = {feature['ticker']: feature for feature in by_date[outcome_date]}
        session = []
        for feature in by_date[signal_date]:
            outcome = outcome_map.get(feature['ticker'])
            if not outcome:
                continue
            next_return = pct(outcome['close'], feature['close'])
            flags = extended_flags(feature)
            row = {
                'signalDate': signal_date,
                'outcomeDate': outcome_date,
                'ticker': feature['ticker'],
                'name': feature['name'],
                'feature': feature,
                'history': feature['_history'],
                'historyIndex': feature['_index'],
                'nextReturn': next_return,
                'flags': flags,
                'xNew': extended_vector(feature, flags),
            }
            session.append(row)
        session.sort(key=lambda row: row['nextReturn'], reverse=True)
        top = {row['ticker'] for row in session[:10]}
        for row in session:
            row['yTop10'] = 1 if row['ticker'] in top else 0
            row['yNetPositive'] = 1 if row['nextReturn'] > COST_PCT else 0
            row['yLargeLoss'] = 1 if row['nextReturn'] <= -2.0 else 0
        rows.extend(session)
        rows_by_date[signal_date] = session

    signal_dates = dates[:-1]
    warmup_rows = [row for date in signal_dates[:WARMUP] for row in rows_by_date[date]]
    weights = {
        'top': train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yTop10', 'xNew', 30, 0.03),
        'positive': train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yNetPositive', 'xNew', 30, 0.025),
        'loss': train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yLargeLoss', 'xNew', 30, 0.025),
    }
    seen_rows = list(warmup_rows)
    snapshots = []
    for signal_date in signal_dates[WARMUP:]:
        session = rows_by_date[signal_date]
        scored, pool = score_rows(session, weights, seen_rows)
        snapshots.append({'signalDate': signal_date, 'outcomeDate': session[0]['outcomeDate'], 'scored': scored, 'pool': pool})
        weights['top'] = train(weights['top'], session, 'yTop10', 'xNew', 10, 0.022)
        weights['positive'] = train(weights['positive'], session, 'yNetPositive', 'xNew', 10, 0.020)
        weights['loss'] = train(weights['loss'], session, 'yLargeLoss', 'xNew', 10, 0.020)
        seen_rows.extend(session)

    final_sessions = []
    usage = {strategy: 0 for strategy in STRATEGIES}
    start = INNER_LOOKBACK
    for block_start in range(start, len(snapshots), BLOCK_SIZE):
        validation = snapshots[max(0, block_start - INNER_LOOKBACK):block_start]
        results = []
        for strategy in STRATEGIES:
            metrics = strategy_metrics(validation, strategy)
            results.append((strategy_objective(metrics), strategy, metrics))
        results.sort(reverse=True, key=lambda item: item[0])
        strategy = results[0][1]
        block = snapshots[block_start:block_start + BLOCK_SIZE]
        usage[strategy] += len(block)
        for snapshot in block:
            selection = select_strategy(strategy, snapshot['pool'])
            return_pct = selection_return(selection)
            final_sessions.append({
                'signalDate': snapshot['signalDate'],
                'outcomeDate': snapshot['outcomeDate'],
                'strategy': strategy,
                'positions': len(selection),
                'tickers': [row['ticker'] for row in selection],
                'returnPct': round_value(return_pct, 4),
                'validationMetrics': results[0][2],
                'trades': [
                    {
                        'ticker': row['ticker'],
                        'netReturnPct': round_value(row['nextReturn'] - COST_PCT, 4),
                        'topLift': round_value(row['topLift'], 3),
                        'pLargeLossPct': round_value(row['pLargeLoss'] * 100, 2),
                    }
                    for row in selection
                ],
            })

    metrics = aggregate(final_sessions)
    acceptance = {
        'minimumEvaluatedSessions': metrics['evaluatedSessions'] >= 20,
        'minimumTradedSessions': metrics['tradedSessions'] >= 10,
        'positiveAverageReturn': (metrics['averageNetReturnPct'] or 0.0) > 0.0,
        'positiveCompoundedReturn': (metrics['compoundedNetReturnPct'] or 0.0) > 0.0,
        'profitFactorAtLeast120': (metrics['profitFactor'] or 0.0) >= 1.20,
        'maximumDrawdownAboveMinus12': (metrics['maximumDrawdownPct'] or -100.0) >= -12.0,
        'sessionWinRateAtLeast45': (metrics['sessionWinRatePct'] or 0.0) >= 45.0,
    }
    production_eligible = all(acceptance.values())

    recent = snapshots[-INNER_LOOKBACK:]
    current_results = []
    for strategy in STRATEGIES:
        strategy_result = strategy_metrics(recent, strategy)
        current_results.append((strategy_objective(strategy_result), strategy, strategy_result))
    current_results.sort(reverse=True, key=lambda item: item[0])
    current_strategy = current_results[0][1]

    final_top = train([0.0] * len(rows[0]['xNew']), rows, 'yTop10', 'xNew', 55, 0.028)
    final_positive = train([0.0] * len(rows[0]['xNew']), rows, 'yNetPositive', 'xNew', 55, 0.026)
    final_loss = train([0.0] * len(rows[0]['xNew']), rows, 'yLargeLoss', 'xNew', 55, 0.026)
    latest_date = dates[-1]
    latest_rows = []
    for feature in by_date[latest_date]:
        flags = extended_flags(feature)
        latest_rows.append({
            'ticker': feature['ticker'],
            'name': feature['name'],
            'feature': feature,
            'history': feature['_history'],
            'historyIndex': feature['_index'],
            'flags': flags,
            'xNew': extended_vector(feature, flags),
            'yTop10': 0,
            'yNetPositive': 0,
            'yLargeLoss': 0,
        })
    current_weights = {'top': final_top, 'positive': final_positive, 'loss': final_loss}
    scored_latest, current_pool = score_rows(latest_rows, current_weights, rows)
    current_selection = select_strategy(current_strategy, current_pool)
    current_recommendations = [build_output(row, index, 'PRIMARY' if index == 1 else 'SECONDARY') for index, row in enumerate(current_selection, 1)]
    watchlist = [build_output(row, index, 'WATCH') for index, row in enumerate(current_pool[:8], 1)]

    report = {
        'schemaVersion': '16.8.0-practical-selector',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'status': 'PRODUCTION_GATE_PASSED' if production_eligible else 'RESEARCH_GATE_NOT_PASSED',
        'productionEligible': production_eligible,
        'methodology': {
            'stage1': 'Existing walk-forward probability ranking; candidate pool is top 8.',
            'stage2': 'Liquidity, volume, extension and momentum-failure safety gate.',
            'stage3': 'Blocked selection among four predefined one-or-two position rules.',
            'target': 'Next-session net return after 0.60% estimated round-trip cost.',
            'blockSizeSessions': BLOCK_SIZE,
            'strategyValidationLookbackSessions': INNER_LOOKBACK,
            'strategies': STRATEGIES,
        },
        'walkForwardMetrics': metrics,
        'acceptanceGate': acceptance,
        'strategyUsage': usage,
        'recentSessions': final_sessions[-15:],
        'currentSignalDate': latest_date,
        'currentStrategy': current_strategy,
        'currentStrategyValidation': current_results[0][2],
        'currentRecommendations': current_recommendations if production_eligible else [],
        'currentResearchCandidates': watchlist,
        'notesAr': [
            'الاختيار يبدأ من أعلى المرشحين احتماليًا، ثم يستبعد ضعف السيولة والامتداد وفشل الزخم.',
            'السهم الثاني لا يضاف إلا إذا كانت جودته قريبة وارتباطه بالسهم الأول منخفضًا.',
            'التنفيذ يظل معلقًا على افتتاح داخل النطاق وسيولة مؤكدة أول 10–15 دقيقة.',
        ],
    }
    wr(OUT, report)
    print(json.dumps({
        'status': report['status'],
        'productionEligible': production_eligible,
        'walkForwardMetrics': metrics,
        'acceptanceGate': acceptance,
        'currentStrategy': current_strategy,
        'currentRecommendations': report['currentRecommendations'],
        'topResearchCandidates': watchlist[:5],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
