#!/usr/bin/env python3
import json
import math
import os
import runpy
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
BASE = runpy.run_path(
    str(ROOT / 'scripts/research/v16-probabilistic-model-impact.py'),
    run_name='v16_probability_base',
)

rd = BASE['rd']
wr = BASE['wr']
mean = BASE['m']
median = BASE['med']
round_value = BASE['r']
clip = BASE['clip']
pct = BASE['pct']
sigmoid = BASE['sigmoid']
norm_hist = BASE['norm_hist']
base_feature = BASE['feat']
base_flags = BASE['flags']
base_vector = BASE['vector']
MODELS = BASE['MODELS']

HISTORY_DIR = ROOT / 'data/history'
OLD_REPORT = ROOT / 'data/research/v16-probabilistic-model-impact.json'
CURRENT_DECISION = ROOT / 'data/stable/v15-practical-decision.json'
OUT = ROOT / 'data/research/v16-two-stage-recommendations.json'

TOP_K = 10
MIN_UNIVERSE = 60
MIN_SIGNAL_SESSIONS = 50
WARMUP_SESSIONS = 20
COST_PCT = 0.60
LARGE_LOSS_PCT = -2.0


def robust_volume_metrics(rows, index):
    history = [max(0.0, rows[i].get('volume', 0.0)) for i in range(index - 20, index)]
    current = max(0.0, rows[index].get('volume', 0.0))
    positive = [value for value in history if value > 0]
    if len(positive) < 10:
        return 0.0, 1.0
    med_raw = statistics.median(positive)
    robust_ratio = current / med_raw if med_raw > 0 else 1.0
    logs = [math.log1p(value) for value in positive]
    center = statistics.median(logs)
    deviations = [abs(value - center) for value in logs]
    mad = statistics.median(deviations)
    current_log = math.log1p(current)
    if mad > 1e-9:
        shock_z = 0.6745 * (current_log - center) / mad
    else:
        shock_z = math.log(max(robust_ratio, 1e-6), 2)
    return clip(shock_z, -8.0, 12.0), clip(robust_ratio, 0.0, 100.0)


def augment_feature(history, index, feature):
    row = history['rows'][index]
    shock_z, robust_ratio = robust_volume_metrics(history['rows'], index)
    candle_range = max(row['high'] - row['low'], feature['close'] * 0.001)
    close_position = clip((row['close'] - row['low']) / candle_range, 0.0, 1.0)
    bearish_candle = 1.0 if row['close'] < row['open'] else 0.0
    extension_s10_atr = (feature['close'] - feature['s10']) / feature['a14'] if feature['a14'] > 0 else 0.0

    failure = 0.0
    failure += 0.20 * clip((feature['rsi'] - 70.0) / 15.0, 0.0, 1.0)
    failure += 0.18 * clip((feature['ret20'] - 25.0) / 55.0, 0.0, 1.0)
    failure += 0.15 * clip((feature['ret5'] - 8.0) / 22.0, 0.0, 1.0)
    failure += 0.12 * clip((feature['breakout'] - 2.0) / 8.0, 0.0, 1.0)
    failure += 0.12 if feature['ret1'] < 0 and feature['ret5'] > 5 else 0.0
    failure += 0.08 * bearish_candle
    failure += 0.07 * clip((0.85 - feature['vr']) / 0.50, 0.0, 1.0) if feature['ret5'] > 8 else 0.0
    failure += 0.08 * clip((extension_s10_atr - 1.5) / 2.5, 0.0, 1.0)
    failure += 0.08 * clip((0.35 - close_position) / 0.35, 0.0, 1.0)
    failure = clip(failure, 0.0, 1.0)

    volume_shock_signal = (
        shock_z >= 3.0
        and robust_ratio >= 2.0
        and feature['turn'] >= 1_000_000
        and -4.0 <= feature['ret1'] <= 12.0
        and feature['rsi'] <= 80.0
    )

    feature.update({
        'volumeShockZ': shock_z,
        'robustVolumeRatio': robust_ratio,
        'volumeShockSignal': volume_shock_signal,
        'closePosition': close_position,
        'bearishCandle': bearish_candle,
        'extensionS10Atr': extension_s10_atr,
        'momentumFailureRisk': failure,
    })
    return feature


def extended_flags(feature):
    return base_flags(feature) + [1 if feature['volumeShockSignal'] else 0]


def extended_vector(feature, model_flags):
    original_flags = model_flags[:7]
    values = base_vector(feature, original_flags)
    shock = model_flags[7]
    values.extend([
        shock,
        clip(feature['volumeShockZ'] / 8.0, -1.0, 1.0),
        clip(math.log(max(feature['robustVolumeRatio'], 0.125), 2) / 5.0, -1.0, 1.0),
        feature['closePosition'] * 2.0 - 1.0,
        feature['bearishCandle'],
        clip(feature['extensionS10Atr'] / 4.0, -1.0, 1.0),
        feature['momentumFailureRisk'],
        shock * original_flags[0],
        shock * original_flags[6],
    ])
    return values


def class_weight(rows, target):
    positives = max(1, sum(1 for row in rows if row[target]))
    negatives = max(1, len(rows) - positives)
    return clip(negatives / positives, 1.0, 12.0)


def train(weights, rows, target, vector_key, epochs=12, learning_rate=0.024, l2=0.018):
    positive_weight = class_weight(rows, target)
    for _ in range(epochs):
        gradient = [0.0] * len(weights)
        for row in rows:
            vector = row[vector_key]
            probability = sigmoid(sum(a * b for a, b in zip(weights, vector)))
            error = (probability - row[target]) * (positive_weight if row[target] else 1.0)
            for index, value in enumerate(vector):
                gradient[index] += error * value
        count = max(1, len(rows))
        for index in range(len(weights)):
            penalty = 0.0 if index == 0 else l2 * weights[index]
            weights[index] -= learning_rate * (gradient[index] / count + penalty)
    return weights


def calibrated_probability(weights, row, target_rows, target, vector_key):
    raw_probability = sigmoid(sum(a * b for a, b in zip(weights, row[vector_key])))
    positive_weight = class_weight(target_rows, target)
    raw_odds = raw_probability / max(1e-9, 1.0 - raw_probability)
    corrected_odds = raw_odds / positive_weight
    return corrected_odds / (1.0 + corrected_odds)


def execution_reasons(feature):
    reasons = []
    if feature['turn'] < 1_000_000:
        reasons.append('LOW_TURNOVER')
    if feature['rsi'] > 82:
        reasons.append('RSI_ABOVE_82')
    if feature['ret20'] > 80:
        reasons.append('RETURN20_ABOVE_80')
    if feature['ret5'] > 30:
        reasons.append('RETURN5_ABOVE_30')
    if feature['breakout'] > 8:
        reasons.append('EXTENDED_ABOVE_BREAKOUT')
    if feature['momentumFailureRisk'] >= 0.62:
        reasons.append('MOMENTUM_FAILURE_RISK')
    return reasons


def effective_model_support(model_flags, correlations, lifts):
    active = [index for index, value in enumerate(model_flags) if value]
    raw = sum(max(0.0, math.log(max(lifts[index], 1e-6))) for index in active)
    overlap = 0.0
    for pos, left in enumerate(active):
        for right in active[pos + 1:]:
            correlation = max(0.0, correlations[left][right])
            overlap += 0.5 * correlation * min(
                max(0.0, math.log(max(lifts[left], 1e-6))),
                max(0.0, math.log(max(lifts[right], 1e-6))),
            )
    return max(0.0, raw - overlap)


def build_output_candidate(row, rank, base_rate, category):
    feature = row['feature']
    atr = feature['a14']
    entry_low = feature['close'] - 0.10 * atr
    entry_high = feature['close'] + 0.10 * atr
    stop_loss = feature['close'] - 1.10 * atr
    target_1 = feature['close'] + 1.50 * atr
    risk_reward = (target_1 - entry_high) / max(1e-9, entry_high - stop_loss)
    return {
        'rank': rank,
        'ticker': row['ticker'],
        'companyNameAr': row['name'],
        'category': category,
        'predictionProbabilityTop10Pct': round_value(row['pTop10'] * 100, 3),
        'predictionLiftVsBase': round_value(row['pTop10'] / base_rate, 3),
        'netPositiveProbabilityPct': round_value(row['pNetPositive'] * 100, 3),
        'largeLossProbabilityPct': round_value(row['pLargeLoss'] * 100, 3),
        'executionScore': round_value(row['executionScore'], 6),
        'effectiveModelSupport': round_value(row['effectiveSupport'], 4),
        'matchedModels': row['matchedModels'],
        'modelCount': len(row['matchedModels']),
        'volumeShock': feature['volumeShockSignal'],
        'volumeShockZ': round_value(feature['volumeShockZ'], 2),
        'momentumFailureRiskPct': round_value(feature['momentumFailureRisk'] * 100, 1),
        'close': round_value(feature['close'], 4),
        'entryLow': round_value(entry_low, 4),
        'entryHigh': round_value(entry_high, 4),
        'stopLoss': round_value(stop_loss, 4),
        'target1': round_value(target_1, 4),
        'riskReward': round_value(risk_reward, 2),
        'rsi14': round_value(feature['rsi'], 1),
        'ret5Pct': round_value(feature['ret5'], 2),
        'ret20Pct': round_value(feature['ret20'], 2),
        'relativeStrength20Pct': round_value(feature['rs20'], 2),
        'volumeRatio20': round_value(feature['vr'], 2),
        'robustVolumeRatio20': round_value(feature['robustVolumeRatio'], 2),
        'breakoutPct': round_value(feature['breakout'], 2),
        'averageTurnover20Egp': round_value(feature['turn'], 0),
        'executionExclusionReasons': execution_reasons(feature),
    }


def main():
    histories = [norm_hist(path) for path in HISTORY_DIR.glob('*.json')]
    histories = [history for history in histories if history['ok'] and len(history['rows']) >= 60]

    by_date = {}
    for history in histories:
        for index in range(55, len(history['rows'])):
            feature = base_feature(history, index)
            if feature:
                by_date.setdefault(feature['date'], []).append(augment_feature(history, index, feature))

    dates = sorted(date for date, values in by_date.items() if len(values) >= MIN_UNIVERSE)
    for date in dates:
        market_median = median([feature['ret20'] for feature in by_date[date]])
        for feature in by_date[date]:
            feature['rs20'] = feature['ret20'] - market_median

    if len(dates) - 1 < MIN_SIGNAL_SESSIONS:
        raise RuntimeError(f'Need at least {MIN_SIGNAL_SESSIONS} signal sessions, found {len(dates) - 1}')

    rows = []
    rows_by_date = {}
    for date_index, signal_date in enumerate(dates[:-1]):
        outcome_date = dates[date_index + 1]
        outcome_map = {feature['ticker']: feature for feature in by_date[outcome_date]}
        session_rows = []
        for feature in by_date[signal_date]:
            outcome = outcome_map.get(feature['ticker'])
            if not outcome:
                continue
            next_return = pct(outcome['close'], feature['close'])
            flags = extended_flags(feature)
            session_rows.append({
                'signalDate': signal_date,
                'outcomeDate': outcome_date,
                'ticker': feature['ticker'],
                'name': feature['name'],
                'feature': feature,
                'nextReturn': next_return,
                'flags': flags,
                'xOld': base_vector(feature, flags[:7]),
                'xNew': extended_vector(feature, flags),
            })
        session_rows.sort(key=lambda row: row['nextReturn'], reverse=True)
        top_tickers = {row['ticker'] for row in session_rows[:TOP_K]}
        for rank, row in enumerate(session_rows, 1):
            row['rank'] = rank
            row['yTop10'] = 1 if row['ticker'] in top_tickers else 0
            row['yNetPositive'] = 1 if row['nextReturn'] > COST_PCT else 0
            row['yLargeLoss'] = 1 if row['nextReturn'] <= LARGE_LOSS_PCT else 0
        rows.extend(session_rows)
        rows_by_date[signal_date] = session_rows

    base_top10 = sum(row['yTop10'] for row in rows) / len(rows)
    base_positive = sum(row['yNetPositive'] for row in rows) / len(rows)
    base_large_loss = sum(row['yLargeLoss'] for row in rows) / len(rows)

    model_names = [model[0] for model in MODELS] + ['VOLUME_SHOCK']
    model_labels = [model[1] for model in MODELS] + ['صدمة حجم مستقلة']
    correlations = []
    for left in range(8):
        line = []
        left_values = [row['flags'][left] for row in rows]
        for right in range(8):
            right_values = [row['flags'][right] for row in rows]
            value = BASE['corr'](left_values, right_values)
            line.append(value if value is not None else 0.0)
        correlations.append(line)

    single_impact = []
    lifts = []
    for index, model_name in enumerate(model_names):
        signals = [row for row in rows if row['flags'][index]]
        hits = sum(row['yTop10'] for row in signals)
        posterior = (hits + base_top10 * 25) / (len(signals) + 25)
        lift = posterior / base_top10
        lifts.append(lift)
        single_impact.append({
            'id': model_name,
            'labelAr': model_labels[index],
            'signals': len(signals),
            'hits': hits,
            'posteriorProbabilityTop10Pct': round_value(posterior * 100, 3),
            'liftVsBase': round_value(lift, 4),
            'averageNextReturnPct': round_value(mean([row['nextReturn'] for row in signals]), 4),
        })
    single_impact.sort(key=lambda item: (item['liftVsBase'], item['signals']), reverse=True)

    signal_dates = dates[:-1]
    warmup_rows = [row for date in signal_dates[:WARMUP_SESSIONS] for row in rows_by_date[date]]

    old_weights = train([0.0] * len(warmup_rows[0]['xOld']), warmup_rows, 'yTop10', 'xOld', 30, 0.03)
    top_weights = train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yTop10', 'xNew', 30, 0.03)
    positive_weights = train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yNetPositive', 'xNew', 30, 0.025)
    loss_weights = train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yLargeLoss', 'xNew', 30, 0.025)
    seen_rows = list(warmup_rows)

    validation_sessions = []
    for signal_date in signal_dates[WARMUP_SESSIONS:]:
        session = rows_by_date[signal_date]
        old_ranked = sorted(
            session,
            key=lambda row: calibrated_probability(old_weights, row, seen_rows, 'yTop10', 'xOld'),
            reverse=True,
        )

        scored = []
        for row in session:
            p_top = calibrated_probability(top_weights, row, seen_rows, 'yTop10', 'xNew')
            p_positive = calibrated_probability(positive_weights, row, seen_rows, 'yNetPositive', 'xNew')
            p_loss = calibrated_probability(loss_weights, row, seen_rows, 'yLargeLoss', 'xNew')
            failure = row['feature']['momentumFailureRisk']
            score = p_top * (0.55 + p_positive) * (1.0 - p_loss) * (1.0 - 0.65 * failure)
            scored.append((score, p_top, row))

        prediction_ranked = [item[2] for item in sorted(scored, key=lambda item: item[1], reverse=True)]
        execution_ranked = [
            item[2]
            for item in sorted(scored, key=lambda item: item[0], reverse=True)
            if not execution_reasons(item[2]['feature'])
        ]

        def result_metrics(selected):
            selected = selected[:5]
            returns = [row['nextReturn'] for row in selected]
            return {
                'count': len(selected),
                'top10Hits': sum(row['yTop10'] for row in selected),
                'averageNextReturnPct': round_value(mean(returns), 4),
                'netWinRatePct': round_value(sum(value > COST_PCT for value in returns) / len(returns) * 100, 2) if returns else None,
                'largeLossRatePct': round_value(sum(value <= LARGE_LOSS_PCT for value in returns) / len(returns) * 100, 2) if returns else None,
            }

        validation_sessions.append({
            'signalDate': signal_date,
            'outcomeDate': session[0]['outcomeDate'],
            'oldTop5': result_metrics(old_ranked),
            'newPredictionTop5': result_metrics(prediction_ranked),
            'newExecutionTop5': result_metrics(execution_ranked),
        })

        old_weights = train(old_weights, session, 'yTop10', 'xOld', 10, 0.022)
        top_weights = train(top_weights, session, 'yTop10', 'xNew', 10, 0.022)
        positive_weights = train(positive_weights, session, 'yNetPositive', 'xNew', 10, 0.020)
        loss_weights = train(loss_weights, session, 'yLargeLoss', 'xNew', 10, 0.020)
        seen_rows.extend(session)

    def aggregate(path):
        valid = [session[path] for session in validation_sessions if session[path]['count']]
        return {
            'evaluatedSessions': len(valid),
            'averageTop10HitsInTop5': round_value(mean([item['top10Hits'] for item in valid]), 4),
            'averageNextReturnTop5Pct': round_value(mean([item['averageNextReturnPct'] for item in valid]), 4),
            'averageNetWinRatePct': round_value(mean([item['netWinRatePct'] for item in valid]), 3),
            'averageLargeLossRatePct': round_value(mean([item['largeLossRatePct'] for item in valid]), 3),
        }

    final_old = train([0.0] * len(rows[0]['xOld']), rows, 'yTop10', 'xOld', 55, 0.028)
    final_top = train([0.0] * len(rows[0]['xNew']), rows, 'yTop10', 'xNew', 55, 0.028)
    final_positive = train([0.0] * len(rows[0]['xNew']), rows, 'yNetPositive', 'xNew', 55, 0.026)
    final_loss = train([0.0] * len(rows[0]['xNew']), rows, 'yLargeLoss', 'xNew', 55, 0.026)

    latest_date = dates[-1]
    current_decision = rd(CURRENT_DECISION, {}) or {}
    current_tickers = {item.get('ticker') for item in current_decision.get('recommendations', [])}

    latest_rows = []
    for feature in by_date[latest_date]:
        flags = extended_flags(feature)
        row = {
            'ticker': feature['ticker'],
            'name': feature['name'],
            'feature': feature,
            'flags': flags,
            'xOld': base_vector(feature, flags[:7]),
            'xNew': extended_vector(feature, flags),
        }
        row['pTop10'] = calibrated_probability(final_top, row, rows, 'yTop10', 'xNew')
        row['pNetPositive'] = calibrated_probability(final_positive, row, rows, 'yNetPositive', 'xNew')
        row['pLargeLoss'] = calibrated_probability(final_loss, row, rows, 'yLargeLoss', 'xNew')
        row['effectiveSupport'] = effective_model_support(flags, correlations, lifts)
        row['matchedModels'] = [model_names[index] for index, value in enumerate(flags) if value]
        row['executionScore'] = (
            row['pTop10']
            * (0.55 + row['pNetPositive'])
            * (1.0 - row['pLargeLoss'])
            * (1.0 - 0.65 * feature['momentumFailureRisk'])
            * (1.0 + 0.08 * min(row['effectiveSupport'], 3.0))
        )
        row['currentScannerRecommendation'] = row['ticker'] in current_tickers
        latest_rows.append(row)

    prediction_ranked = sorted(latest_rows, key=lambda row: row['pTop10'], reverse=True)
    executable = [row for row in latest_rows if not execution_reasons(row['feature'])]
    execution_ranked = sorted(executable, key=lambda row: row['executionScore'], reverse=True)

    recommendations = []
    categories = ['PRIMARY_1', 'PRIMARY_2', 'CONDITIONAL', 'RESERVE_1', 'RESERVE_2']
    for index, row in enumerate(execution_ranked[:5], 1):
        candidate = build_output_candidate(row, index, base_top10, categories[index - 1])
        candidate['currentScannerRecommendation'] = row['currentScannerRecommendation']
        recommendations.append(candidate)

    prediction_watch = []
    for index, row in enumerate(prediction_ranked[:15], 1):
        item = build_output_candidate(row, index, base_top10, 'PREDICTION_WATCH')
        item['currentScannerRecommendation'] = row['currentScannerRecommendation']
        prediction_watch.append(item)

    old_report = rd(OLD_REPORT, {}) or {}
    output = {
        'schemaVersion': '16.5.0-two-stage-research',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'sessionDate': latest_date,
        'targetSession': 'NEXT_TRADING_SESSION',
        'status': 'SHADOW_RESEARCH_NOT_AUTOMATIC_ORDER',
        'methodology': {
            'signalSessions': len(signal_dates),
            'firstSignalSession': signal_dates[0],
            'lastHistoricalSignalSession': signal_dates[-1],
            'histories': len(histories),
            'labeledRows': len(rows),
            'noFutureLeakage': True,
            'stage1': 'Probability of entering next-session top 10 gainers',
            'stage2': 'Probability of net-positive return minus large-loss and momentum-failure risks',
            'newIndependentModel': 'VOLUME_SHOCK using robust median and MAD of log volume',
            'executionRule': 'Prediction and execution are separated; unsafe momentum is watch-only',
            'costAssumptionPct': COST_PCT,
        },
        'baseRates': {
            'top10Pct': round_value(base_top10 * 100, 3),
            'netPositivePct': round_value(base_positive * 100, 3),
            'largeLossPct': round_value(base_large_loss * 100, 3),
        },
        'walkForwardComparison': {
            'oldPredictionModel': aggregate('oldTop5'),
            'newPredictionStage': aggregate('newPredictionTop5'),
            'newExecutionStage': aggregate('newExecutionTop5'),
            'priorPublishedMetrics': old_report.get('walkForwardValidation', {}).get('metrics'),
            'recentSessions': validation_sessions[-15:],
        },
        'singleModelImpactIncludingVolumeShock': single_impact,
        'modelCorrelationMatrix': [
            {
                'model': model_names[left],
                'correlations': {
                    model_names[right]: round_value(correlations[left][right], 5)
                    for right in range(8)
                },
            }
            for left in range(8)
        ],
        'newRecommendations': recommendations,
        'predictionWatchList': prediction_watch,
        'notesAr': [
            'القائمة بحثية وتحتاج تأكيد الافتتاح ولا تمثل أمر شراء آليًا.',
            'الأسهم شديدة الزخم قد تظهر في قائمة التنبؤ لكنها تُستبعد من التنفيذ عند ارتفاع مخاطر الفشل.',
            'الأساسيان فقط للتنفيذ المبدئي، والثالث مشروط، والاحتياطي يستبدل فرصة لم تتفعل ولا يضاف إليها.',
        ],
    }
    wr(OUT, output)
    print(json.dumps({
        'sessionDate': latest_date,
        'walkForwardComparison': output['walkForwardComparison'],
        'recommendations': recommendations,
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
