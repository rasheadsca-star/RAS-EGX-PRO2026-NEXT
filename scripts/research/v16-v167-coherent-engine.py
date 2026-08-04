#!/usr/bin/env python3
from v167_core import *

def predict_entry(weights, row):
    z = sum(a * b for a, b in zip(weights, row['x']))
    return 1.0 / (1.0 + math.exp(-clip(z, -35.0, 35.0)))


def predict_classes(weights, row):
    return softmax([sum(a * b for a, b in zip(w, row['x'])) for w in weights])


def score_row(row, models, config, correlations, lifts):
    p_entry = predict_entry(models['entry'], row)
    p_target, p_stop, p_time = predict_classes(models['multi'], row)
    time_return = clip(sum(a * b for a, b in zip(models['time'], row['x'])), -5.0, 5.0)
    feature = row['feature']
    target_net = pct(feature['close'] + config['targetAtr'] * feature['a14'], feature['close']) - ROUND_TRIP_COST_PCT
    stop_net = pct(feature['close'] - config['stopAtr'] * feature['a14'], feature['close']) - ROUND_TRIP_COST_PCT
    conditional_ev = p_target * target_net + p_stop * stop_net + p_time * time_return
    unconditional_ev = p_entry * conditional_ev
    support = effective_model_support(row['flags'], correlations, lifts)
    target_lift = p_target / max(models['baseClass'][0], 1e-6)
    risk_penalty = 0.25 * feature['momentumFailureRisk'] + 0.10 * feature['_regime']['riskOff']
    quality = conditional_ev + 0.08 * min(support, 3.0) + 0.10 * (target_lift - 1.0) - risk_penalty
    technical_reasons = execution_reasons(feature)
    reasons = list(technical_reasons)
    if p_entry < MIN_ENTRY_PROB:
        reasons.append('LOW_ENTRY_PROBABILITY')
    if conditional_ev < MIN_CONDITIONAL_EV_PCT:
        reasons.append('NON_POSITIVE_CONDITIONAL_EV')
    return {
        **row,
        'pEntry': p_entry,
        'pTarget': p_target,
        'pStop': p_stop,
        'pTime': p_time,
        'timeReturnPct': time_return,
        'targetNetPct': target_net,
        'stopNetPct': stop_net,
        'conditionalEvPct': conditional_ev,
        'unconditionalEvPct': unconditional_ev,
        'targetLift': target_lift,
        'effectiveSupport': support,
        'qualityScore': quality,
        'technicalReasons': technical_reasons,
        'exclusionReasons': sorted(set(reasons)),
    }


def ticker_return_series(feature, length=25):
    history = feature['_history']
    index = feature['_index']
    rows = history['rows']
    start = max(1, index - length + 1)
    return [pct(rows[i]['close'], rows[i - 1]['close']) for i in range(start, index + 1)]


def pair_correlation(left, right):
    lret = ticker_return_series(left['feature'])
    rret = ticker_return_series(right['feature'])
    n = min(len(lret), len(rret))
    return pearson(lret[-n:], rret[-n:]) if n >= 8 else 0.0


def choose_portfolio(scored):
    candidates = [r for r in scored if not r['exclusionReasons']]
    candidates.sort(key=lambda r: (r['qualityScore'], r['conditionalEvPct']), reverse=True)
    candidates = candidates[:10]
    if not candidates:
        return [], {'reason': 'NO_POSITIVE_EV_CANDIDATE'}
    best = [candidates[0]]
    best_utility = candidates[0]['conditionalEvPct']
    for left, right in combinations(candidates, 2):
        corr = max(0.0, pair_correlation(left, right))
        joint_stop = left['pStop'] * right['pStop']
        avg_ev = (left['conditionalEvPct'] + right['conditionalEvPct']) / 2.0
        utility = avg_ev - 0.20 * corr - 0.35 * joint_stop
        if utility > best_utility + 0.03:
            best = [left, right]
            best_utility = utility
    return best[:MAX_POSITIONS], {'utilityPct': best_utility}


def score_session(session_rows, models, config, correlations, lifts):
    scored = [score_row(r, models, config, correlations, lifts) for r in session_rows]
    selection, meta = choose_portfolio(scored)
    return scored, selection, meta


def session_return(selection):
    entered = [r['outcome']['netReturnPct'] for r in selection if r['outcome']['entered']]
    return safe_mean(entered, 0.0) if entered else 0.0


def summarize_sessions(sessions):
    traded = [s for s in sessions if s['positions']]
    returns = [s['portfolioNetReturnPct'] for s in traded]
    trades = [t for s in traded for t in s['trades']]
    gains = sum(max(0.0, r) for r in returns)
    losses = abs(sum(min(0.0, r) for r in returns))
    equity = peak = 1.0
    max_dd = 0.0
    for value in returns:
        equity *= 1.0 + value / 100.0
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
    return {
        'evaluatedSessions': len(sessions),
        'tradedSessions': len(traded),
        'noTradeSessions': len(sessions) - len(traded),
        'averagePositionsPerTradedSession': round_value(safe_mean([s['positions'] for s in traded]), 3),
        'sessionWinRatePct': round_value(sum(r > 0 for r in returns) / max(1, len(returns)) * 100.0, 3),
        'averageNetPortfolioReturnPct': round_value(safe_mean(returns), 4),
        'medianNetPortfolioReturnPct': round_value(safe_median(returns), 4),
        'compoundedNetReturnPct': round_value((equity - 1.0) * 100.0, 3),
        'maximumDrawdownPct': round_value(max_dd, 3),
        'profitFactor': round_value(gains / losses if losses > 0 else None, 3),
        'selectedTrades': len(trades),
        'tradeWinRatePct': round_value(sum(t['netReturnPct'] > 0 for t in trades) / max(1, len(trades)) * 100.0, 3),
        'targets': sum(t['status'] == 'TARGET_HIT' for t in trades),
        'stops': sum(t['status'].startswith('STOP_HIT') for t in trades),
        'timeExits': sum(t['status'] == 'TIME_EXIT' for t in trades),
        'averagePredictedConditionalEvPct': round_value(safe_mean([t['predictedConditionalEvPct'] for t in trades]), 4),
        'averageActualTradeReturnPct': round_value(safe_mean([t['netReturnPct'] for t in trades]), 4),
    }


def evaluate_config(config, training_dates, validation_dates, datasets):
    data = datasets[config['id']]
    train_rows = [r for d in training_dates for r in data['rowsByDate'].get(d, [])]
    models = fit_models(train_rows)
    if not models:
        return None
    correlations, lifts = model_lifts(train_rows)
    sessions = []
    for date in validation_dates:
        rows = data['rowsByDate'].get(date, [])
        if not rows:
            continue
        _, selection, meta = score_session(rows, models, config, correlations, lifts)
        sessions.append({
            'signalDate': date,
            'positions': len(selection),
            'portfolioNetReturnPct': round_value(session_return(selection), 4),
            'selectionMeta': meta,
            'trades': [
                {
                    'ticker': r['ticker'],
                    'status': r['outcome']['status'],
                    'netReturnPct': round_value(r['outcome']['netReturnPct'], 4),
                    'predictedConditionalEvPct': round_value(r['conditionalEvPct'], 4),
                }
                for r in selection
            ],
        })
    metrics = summarize_sessions(sessions)
    trades = metrics['selectedTrades']
    stability_penalty = 0.0
    if trades < 4:
        stability_penalty += 1.0
    if (metrics['maximumDrawdownPct'] or 0) < -10:
        stability_penalty += 0.5
    objective = (
        (metrics['averageNetPortfolioReturnPct'] or -5.0)
        + 0.15 * math.log(max(metrics['profitFactor'] or 0.1, 0.1))
        + 0.002 * (metrics['tradeWinRatePct'] or 0.0)
        - stability_penalty
    )
    return {'config': config, 'metrics': metrics, 'objective': objective}


def output_candidate(row, rank, config, category):
    feature = row['feature']
    atr = feature['a14']
    return {
        'rank': rank,
        'ticker': row['ticker'],
        'companyNameAr': row['name'],
        'category': category,
        'configuration': config['id'],
        'holdingSessions': config['horizon'],
        'entryLow': round_value(feature['close'] - ENTRY_ATR * atr, 4),
        'entryHigh': round_value(feature['close'] + ENTRY_ATR * atr, 4),
        'stopLoss': round_value(feature['close'] - config['stopAtr'] * atr, 4),
        'target1': round_value(feature['close'] + config['targetAtr'] * atr, 4),
        'close': round_value(feature['close'], 4),
        'probabilityEntryPct': round_value(row['pEntry'] * 100, 2),
        'probabilityTargetPct': round_value(row['pTarget'] * 100, 2),
        'probabilityStopPct': round_value(row['pStop'] * 100, 2),
        'probabilityTimeExitPct': round_value(row['pTime'] * 100, 2),
        'predictedTimeExitReturnPct': round_value(row['timeReturnPct'], 3),
        'conditionalExpectedValuePct': round_value(row['conditionalEvPct'], 3),
        'unconditionalExpectedValuePct': round_value(row['unconditionalEvPct'], 3),
        'targetLiftVsTrainingBase': round_value(row['targetLift'], 3),
        'qualityScore': round_value(row['qualityScore'], 4),
        'matchedModels': [MODELS[i][0] if i < len(MODELS) else 'VOLUME_SHOCK'
                          for i, value in enumerate(row['flags']) if value],
        'effectiveModelSupport': round_value(row['effectiveSupport'], 4),
        'rsi14': round_value(feature['rsi'], 1),
        'volumeRatio20': round_value(feature['vr'], 2),
        'momentumFailureRiskPct': round_value(feature['momentumFailureRisk'] * 100, 1),
        'marketRegime': 'RISK_OFF' if feature['_regime']['riskOff'] else 'RISK_ON' if feature['_regime']['riskOn'] else 'NEUTRAL',
        'exclusionReasons': row['exclusionReasons'],
        'morningConfirmation': {
            'status': 'PENDING_OPEN_CONFIRMATION',
            'cancelIfOpenAbove': round_value(feature['close'] + ENTRY_ATR * atr, 4),
            'cancelIfOpenBelow': round_value(feature['close'] - config['stopAtr'] * atr, 4),
            'ruleAr': 'تنفذ فقط إذا افتتح داخل النطاق وبقي فوق وقف الخسارة مع سيولة مؤكدة خلال أول 10–15 دقيقة؛ يمنع مطاردة فجوة صاعدة.',
        },
    }


def main():
    histories, dates, by_date = build_market()
    datasets = {}
    for config in CONFIGS:
        labeled_dates, rows, rows_by_date = build_dataset_for_config(dates, by_date, config)
        datasets[config['id']] = {
            'labeledDates': labeled_dates,
            'rows': rows,
            'rowsByDate': rows_by_date,
        }

    common_labeled = dates[:-max(c['horizon'] for c in CONFIGS)]
    outer_sessions = []
    config_usage = {c['id']: 0 for c in CONFIGS}

    for current_index in range(OUTER_WARMUP + EMBARGO, len(common_labeled)):
        signal_date = common_labeled[current_index]
        available_dates = common_labeled[:current_index - EMBARGO]
        if len(available_dates) < OUTER_WARMUP:
            continue
        inner_validation = available_dates[-INNER_VALIDATION_SESSIONS:]
        inner_training = available_dates[:-INNER_VALIDATION_SESSIONS]
        if len(inner_training) < 20:
            continue

        config_results = []
        for config in CONFIGS:
            result = evaluate_config(config, inner_training, inner_validation, datasets)
            if result:
                config_results.append(result)
        if not config_results:
            continue
        config_results.sort(key=lambda r: (r['objective'], r['metrics']['selectedTrades']), reverse=True)
        selected_config = config_results[0]['config']
        config_usage[selected_config['id']] += 1

        outer_train_rows = [r for d in available_dates for r in datasets[selected_config['id']]['rowsByDate'].get(d, [])]
        models = fit_models(outer_train_rows)
        if not models:
            continue
        correlations, lifts = model_lifts(outer_train_rows)
        session_rows = datasets[selected_config['id']]['rowsByDate'].get(signal_date, [])
        _, selection, meta = score_session(session_rows, models, selected_config, correlations, lifts)
        outer_sessions.append({
            'signalDate': signal_date,
            'configuration': selected_config['id'],
            'positions': len(selection),
            'tickers': [r['ticker'] for r in selection],
            'portfolioNetReturnPct': round_value(session_return(selection), 4),
            'selectionMeta': meta,
            'innerValidation': {
                'objective': round_value(config_results[0]['objective'], 5),
                'metrics': config_results[0]['metrics'],
                'runnerUp': config_results[1]['config']['id'] if len(config_results) > 1 else None,
            },
            'trades': [
                {
                    'ticker': r['ticker'],
                    'status': r['outcome']['status'],
                    'netReturnPct': round_value(r['outcome']['netReturnPct'], 4),
                    'predictedConditionalEvPct': round_value(r['conditionalEvPct'], 4),
                    'pTargetPct': round_value(r['pTarget'] * 100, 2),
                    'pStopPct': round_value(r['pStop'] * 100, 2),
                }
                for r in selection
            ],
        })

    metrics = summarize_sessions(outer_sessions)
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

    available_dates = common_labeled[:-EMBARGO]
    inner_validation = available_dates[-INNER_VALIDATION_SESSIONS:]
    inner_training = available_dates[:-INNER_VALIDATION_SESSIONS]
    latest_config_results = [
        evaluate_config(config, inner_training, inner_validation, datasets)
        for config in CONFIGS
    ]
    latest_config_results = [r for r in latest_config_results if r]
    latest_config_results.sort(key=lambda r: (r['objective'], r['metrics']['selectedTrades']), reverse=True)
    latest_config = latest_config_results[0]['config']

    final_train_rows = [r for d in common_labeled for r in datasets[latest_config['id']]['rowsByDate'].get(d, [])]
    final_models = fit_models(final_train_rows)
    final_correlations, final_lifts = model_lifts(final_train_rows)
    latest_date = dates[-1]
    latest_rows = []
    for feature in by_date[latest_date]:
        flags = extended_flags(feature)
        latest_rows.append({
            'signalDate': latest_date,
            'ticker': feature['ticker'],
            'name': feature['name'],
            'feature': feature,
            'flags': flags,
            'x': v167_vector(feature, flags),
            'outcome': {'entered': 0, 'status': 'FUTURE_UNKNOWN', 'netReturnPct': 0.0},
        })
    scored_latest = [score_row(r, final_models, latest_config, final_correlations, final_lifts) for r in latest_rows]
    current_selection, current_meta = choose_portfolio(scored_latest)
    ranked = sorted(scored_latest, key=lambda r: (r['qualityScore'], r['conditionalEvPct']), reverse=True)

    current_recommendations = [
        output_candidate(row, index, latest_config, 'PRIMARY' if index <= 2 else 'BACKUP')
        for index, row in enumerate(current_selection, 1)
    ]
    watchlist = [
        output_candidate(row, index, latest_config, 'WATCH')
        for index, row in enumerate(ranked[:10], 1)
    ]

    report = {
        'schemaVersion': '16.7.0-coherent-nested-walk-forward',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'status': 'PRODUCTION_GATE_PASSED' if production_eligible else 'RESEARCH_GATE_NOT_PASSED',
        'productionEligible': production_eligible,
        'methodology': {
            'probabilityModel': 'Single coherent 3-class softmax: TARGET, STOP, TIME_EXIT.',
            'timeExitModel': 'Per-stock regularized regression; no global time-exit mean.',
            'configurationSelection': 'Nested walk-forward chooses target/stop/horizon inside training history only.',
            'candidateGate': 'Positive conditional expected value after costs; no fixed target probability or target/stop ratio.',
            'entryPolicy': 'Entry probability reported separately; execution remains conditional on morning confirmation.',
            'purgedEmbargoSessions': EMBARGO,
            'roundTripCostPct': ROUND_TRIP_COST_PCT,
            'configurations': CONFIGS,
        },
        'walkForwardMetrics': metrics,
        'acceptanceGate': acceptance,
        'configurationUsage': config_usage,
        'currentSignalDate': latest_date,
        'currentConfiguration': latest_config,
        'currentSelectionMeta': current_meta,
        'currentRecommendations': current_recommendations if production_eligible else [],
        'currentResearchCandidates': watchlist,
        'recentWalkForwardSessions': outer_sessions[-15:],
        'latestConfigurationValidation': [
            {
                'configuration': item['config']['id'],
                'objective': round_value(item['objective'], 5),
                'metrics': item['metrics'],
            }
            for item in latest_config_results
        ],
        'notesAr': [
            'عدم اجتياز بوابة الإنتاج يعني أن النموذج لم يثبت قدرته على اختيار الفرص، وليس أن السوق بلا فرص.',
            'أي توصية إنتاجية تحتاج أيضًا تأكيد افتتاح وحجم أول 10–15 دقيقة.',
            'لا يتم تعديل الحدود اعتمادًا على جلسة واحدة؛ اختيار الإعداد يتم داخل التدريب فقط.',
        ],
    }
    wr(OUT, report)
    print(json.dumps({
        'status': report['status'],
        'productionEligible': production_eligible,
        'walkForwardMetrics': metrics,
        'acceptanceGate': acceptance,
        'currentConfiguration': latest_config,
        'currentRecommendations': report['currentRecommendations'],
        'topResearchCandidates': watchlist[:5],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
