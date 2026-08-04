#!/usr/bin/env python3
import json
import math
import os
import runpy
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
BASE = runpy.run_path(str(ROOT / 'scripts/research/v16-two-stage-predictor.py'), run_name='v169_base')

wr = BASE['wr']
median = BASE['median']
round_value = BASE['round_value']
pct = BASE['pct']
norm_hist = BASE['norm_hist']
base_feature = BASE['base_feature']
augment_feature = BASE['augment_feature']
extended_flags = BASE['extended_flags']
extended_vector = BASE['extended_vector']
train = BASE['train']
calibrated_probability = BASE['calibrated_probability']

HISTORY_DIR = ROOT / 'data/history'
OUT = ROOT / 'data/research/v16-v169-basket-engine.json'
MIN_UNIVERSE = 60
WARMUP = 20
COST_PCT = 0.60
BASKET_SIZES = [3, 4, 5]
BLOCK_SIZE = 5
LOOKBACK = 8


def safe_mean(values, default=0.0):
    values = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    return statistics.fmean(values) if values else default


def aggregate(sessions, field):
    returns = [session[field] for session in sessions]
    gains = sum(max(0.0, value) for value in returns)
    losses = abs(sum(min(0.0, value) for value in returns))
    equity = peak = 1.0
    max_dd = 0.0
    for value in returns:
        equity *= 1.0 + value / 100.0
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
    return {
        'sessions': len(returns),
        'averageNetReturnPct': round_value(safe_mean(returns), 4),
        'medianNetReturnPct': round_value(statistics.median(returns) if returns else 0.0, 4),
        'sessionWinRatePct': round_value(sum(value > 0 for value in returns) / max(1, len(returns)) * 100.0, 3),
        'profitFactor': round_value(gains / losses if losses > 0 else None, 3),
        'compoundedNetReturnPct': round_value((equity - 1.0) * 100.0, 3),
        'maximumDrawdownPct': round_value(max_dd, 3),
        'bestSessionPct': round_value(max(returns) if returns else 0.0, 3),
        'worstSessionPct': round_value(min(returns) if returns else 0.0, 3),
    }


def objective(metrics):
    return (
        (metrics['averageNetReturnPct'] or -5.0)
        + 0.15 * math.log(max(metrics['profitFactor'] or 0.1, 0.1))
        + 0.002 * (metrics['sessionWinRatePct'] or 0.0)
        + 0.01 * max(metrics['maximumDrawdownPct'] or -100.0, -20.0)
    )


def main():
    histories = [norm_hist(path) for path in HISTORY_DIR.glob('*.json')]
    histories = [history for history in histories if history['ok'] and len(history['rows']) >= 60]
    by_date = {}
    for history in histories:
        for index in range(55, len(history['rows'])):
            feature = base_feature(history, index)
            if feature:
                feature = augment_feature(history, index, feature)
                by_date.setdefault(feature['date'], []).append(feature)
    dates = sorted(date for date, values in by_date.items() if len(values) >= MIN_UNIVERSE)
    for date in dates:
        med20 = median([feature['ret20'] for feature in by_date[date]])
        for feature in by_date[date]:
            feature['rs20'] = feature['ret20'] - med20

    rows = []
    rows_by_date = {}
    for date_index, signal_date in enumerate(dates[:-1]):
        outcome_date = dates[date_index + 1]
        outcomes = {feature['ticker']: feature for feature in by_date[outcome_date]}
        session = []
        for feature in by_date[signal_date]:
            outcome = outcomes.get(feature['ticker'])
            if not outcome:
                continue
            next_return = pct(outcome['close'], feature['close'])
            flags = extended_flags(feature)
            session.append({
                'signalDate': signal_date,
                'outcomeDate': outcome_date,
                'ticker': feature['ticker'],
                'name': feature['name'],
                'feature': feature,
                'flags': flags,
                'xNew': extended_vector(feature, flags),
                'nextReturn': next_return,
            })
        session.sort(key=lambda row: row['nextReturn'], reverse=True)
        top10 = {row['ticker'] for row in session[:10]}
        for row in session:
            row['yTop10'] = 1 if row['ticker'] in top10 else 0
        rows.extend(session)
        rows_by_date[signal_date] = session

    signal_dates = dates[:-1]
    warmup_rows = [row for date in signal_dates[:WARMUP] for row in rows_by_date[date]]
    weights = train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yTop10', 'xNew', 30, 0.03)
    seen_rows = list(warmup_rows)
    sessions = []
    for signal_date in signal_dates[WARMUP:]:
        session = rows_by_date[signal_date]
        ranked = sorted(
            session,
            key=lambda row: calibrated_probability(weights, row, seen_rows, 'yTop10', 'xNew'),
            reverse=True,
        )
        result = {
            'signalDate': signal_date,
            'outcomeDate': session[0]['outcomeDate'],
            'rankedTickers': [row['ticker'] for row in ranked[:5]],
        }
        for size in BASKET_SIZES:
            selected = ranked[:size]
            gross = safe_mean([row['nextReturn'] for row in selected])
            result[f'basket{size}GrossPct'] = round_value(gross, 4)
            result[f'basket{size}NetPct'] = round_value(gross - COST_PCT, 4)
            result[f'basket{size}Top10Hits'] = sum(row['yTop10'] for row in selected)
        sessions.append(result)
        weights = train(weights, session, 'yTop10', 'xNew', 10, 0.022)
        seen_rows.extend(session)

    fixed_metrics = {str(size): aggregate(sessions, f'basket{size}NetPct') for size in BASKET_SIZES}

    blocked_sessions = []
    usage = {str(size): 0 for size in BASKET_SIZES}
    for block_start in range(LOOKBACK, len(sessions), BLOCK_SIZE):
        validation = sessions[max(0, block_start - LOOKBACK):block_start]
        choices = []
        for size in BASKET_SIZES:
            metrics = aggregate(validation, f'basket{size}NetPct')
            choices.append((objective(metrics), size, metrics))
        choices.sort(reverse=True, key=lambda item: item[0])
        chosen = choices[0][1]
        block = sessions[block_start:block_start + BLOCK_SIZE]
        usage[str(chosen)] += len(block)
        for session in block:
            blocked_sessions.append({
                'signalDate': session['signalDate'],
                'outcomeDate': session['outcomeDate'],
                'basketSize': chosen,
                'tickers': session['rankedTickers'][:chosen],
                'netReturnPct': session[f'basket{chosen}NetPct'],
                'top10Hits': session[f'basket{chosen}Top10Hits'],
                'validationMetrics': choices[0][2],
            })
    blocked_metrics = aggregate(blocked_sessions, 'netReturnPct')
    blocked_metrics['averageTop10Hits'] = round_value(safe_mean([s['top10Hits'] for s in blocked_sessions]), 3)

    latest_validation = sessions[-LOOKBACK:]
    current_choices = []
    for size in BASKET_SIZES:
        metrics = aggregate(latest_validation, f'basket{size}NetPct')
        current_choices.append((objective(metrics), size, metrics))
    current_choices.sort(reverse=True, key=lambda item: item[0])
    current_size = current_choices[0][1]

    final_weights = train([0.0] * len(rows[0]['xNew']), rows, 'yTop10', 'xNew', 55, 0.028)
    latest_date = dates[-1]
    latest_rows = []
    for feature in by_date[latest_date]:
        flags = extended_flags(feature)
        row = {
            'ticker': feature['ticker'],
            'name': feature['name'],
            'feature': feature,
            'flags': flags,
            'xNew': extended_vector(feature, flags),
            'yTop10': 0,
        }
        row['pTop10'] = calibrated_probability(final_weights, row, rows, 'yTop10', 'xNew')
        latest_rows.append(row)
    latest_ranked = sorted(latest_rows, key=lambda row: row['pTop10'], reverse=True)
    current_basket = []
    for index, row in enumerate(latest_ranked[:current_size], 1):
        feature = row['feature']
        atr = feature['a14']
        current_basket.append({
            'rank': index,
            'ticker': row['ticker'],
            'companyNameAr': row['name'],
            'weightPct': round_value(100.0 / current_size, 2),
            'close': round_value(feature['close'], 4),
            'entryLow': round_value(feature['close'] - 0.08 * atr, 4),
            'entryHigh': round_value(feature['close'] + 0.08 * atr, 4),
            'stopLoss': round_value(feature['close'] - 0.90 * atr, 4),
            'target1': round_value(feature['close'] + 1.20 * atr, 4),
            'probabilityTop10Pct': round_value(row['pTop10'] * 100, 2),
            'rsi14': round_value(feature['rsi'], 1),
            'volumeRatio20': round_value(feature['vr'], 2),
            'holdingSessions': 1,
            'morningConfirmation': {
                'cancelIfOpenAbove': round_value(feature['close'] + 0.08 * atr, 4),
                'cancelIfOpenBelow': round_value(feature['close'] - 0.90 * atr, 4),
                'ruleAr': 'لا يُنفذ السهم إذا افتتح أعلى نطاق الدخول أو ظهرت سيولة ضعيفة أول 10–15 دقيقة؛ يعاد توزيع وزنه بالتساوي على الأسهم المتبقية.',
            },
        })

    acceptance = {
        'minimumSessions': blocked_metrics['sessions'] >= 20,
        'positiveAverageNetReturn': (blocked_metrics['averageNetReturnPct'] or 0.0) > 0.0,
        'positiveCompoundedReturn': (blocked_metrics['compoundedNetReturnPct'] or 0.0) > 0.0,
        'profitFactorAtLeast120': (blocked_metrics['profitFactor'] or 0.0) >= 1.20,
        'maximumDrawdownAboveMinus15': (blocked_metrics['maximumDrawdownPct'] or -100.0) >= -15.0,
        'sessionWinRateAtLeast45': (blocked_metrics['sessionWinRatePct'] or 0.0) >= 45.0,
    }
    production_eligible = all(acceptance.values())
    report = {
        'schemaVersion': '16.9.0-equal-weight-basket',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'status': 'PRODUCTION_GATE_PASSED' if production_eligible else 'RESEARCH_GATE_NOT_PASSED',
        'productionEligible': production_eligible,
        'methodology': {
            'ranking': 'Existing out-of-sample top-gainer probability model.',
            'portfolio': 'Equal-weight basket; fixed one-session holding; 0.60% cost deducted.',
            'basketSizesTested': BASKET_SIZES,
            'selection': f'Basket size selected from previous {LOOKBACK} sessions and fixed for next {BLOCK_SIZE} sessions.',
            'reason': 'Diversify idiosyncratic prediction error instead of forcing one or two stocks.',
        },
        'fixedBasketMetrics': fixed_metrics,
        'blockedWalkForwardMetrics': blocked_metrics,
        'basketSizeUsage': usage,
        'acceptanceGate': acceptance,
        'currentSignalDate': latest_date,
        'currentBasketSize': current_size,
        'currentBasketValidation': current_choices[0][2],
        'currentBasket': current_basket if production_eligible else [],
        'currentResearchBasket': current_basket,
        'recentBlockedSessions': blocked_sessions[-15:],
        'notesAr': [
            'السلة تقلل خطر اختيار سهم واحد خاطئ، لكنها لا تضمن الربح.',
            'كل سهم يمر بتأكيد افتتاح؛ السهم غير المتفعل لا يُطارد ويعاد توزيع وزنه على المتبقي.',
            'لا يتم استخدام رافعة مالية، ووقف الخسارة لكل سهم مستقل.',
        ],
    }
    wr(OUT, report)
    print(json.dumps({
        'status': report['status'],
        'productionEligible': production_eligible,
        'fixedBasketMetrics': fixed_metrics,
        'blockedWalkForwardMetrics': blocked_metrics,
        'acceptanceGate': acceptance,
        'currentBasketSize': current_size,
        'currentBasket': report['currentBasket'],
        'currentResearchBasket': current_basket,
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
