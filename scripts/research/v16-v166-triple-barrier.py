#!/usr/bin/env python3
import json
import math
import os
import runpy
import statistics
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
BASE = runpy.run_path(
    str(ROOT / 'scripts/research/v16-two-stage-recommendations.py'),
    run_name='v166_base',
)

rd = BASE['rd']
wr = BASE['wr']
mean = BASE['mean']
median = BASE['median']
round_value = BASE['round_value']
clip = BASE['clip']
pct = BASE['pct']
sigmoid = BASE['sigmoid']
norm_hist = BASE['norm_hist']
base_feature = BASE['base_feature']
augment_feature = BASE['augment_feature']
extended_flags = BASE['extended_flags']
extended_vector = BASE['extended_vector']
execution_reasons = BASE['execution_reasons']
effective_model_support = BASE['effective_model_support']
train = BASE['train']
calibrated_probability = BASE['calibrated_probability']
MODELS = BASE['MODELS']

HISTORY_DIR = ROOT / 'data/history'
OUT = ROOT / 'data/research/v16-v166-triple-barrier.json'

MIN_UNIVERSE = 60
MIN_SIGNAL_SESSIONS = 50
WARMUP_SESSIONS = 25
EMBARGO_SESSIONS = 3
HORIZON_SESSIONS = 3
ROUND_TRIP_COST_PCT = 0.60
TARGET_ATR = 1.50
STOP_ATR = 1.10
ENTRY_ATR = 0.10
MIN_EV_PCT = 0.15
MIN_ENTRY_PROB = 0.50
MIN_TARGET_PROB = 0.28
MIN_TARGET_STOP_RATIO = 1.25
MAX_POSITIONS = 2


def safe_mean(values, default=0.0):
    values = [value for value in values if isinstance(value, (int, float)) and math.isfinite(value)]
    return statistics.fmean(values) if values else default


def pearson(left, right):
    pairs = [(a, b) for a, b in zip(left, right) if math.isfinite(a) and math.isfinite(b)]
    if len(pairs) < 8:
        return 0.0
    la = safe_mean([a for a, _ in pairs])
    rb = safe_mean([b for _, b in pairs])
    numerator = sum((a - la) * (b - rb) for a, b in pairs)
    da = sum((a - la) ** 2 for a, _ in pairs)
    db = sum((b - rb) ** 2 for _, b in pairs)
    return numerator / math.sqrt(da * db) if da > 0 and db > 0 else 0.0


def market_regime(features):
    ret1 = [feature['ret1'] for feature in features]
    ret5 = [feature['ret5'] for feature in features]
    breadth1 = sum(value > 0 for value in ret1) / max(1, len(ret1))
    breadth5 = sum(value > 0 for value in ret5) / max(1, len(ret5))
    med1 = median(ret1)
    med5 = median(ret5)
    med_volume = median([feature['vr'] for feature in features])
    risk_on = 1.0 if breadth1 >= 0.55 and med5 > 0 else 0.0
    risk_off = 1.0 if breadth1 <= 0.40 and med5 < 0 else 0.0
    return {
        'breadth1': breadth1,
        'breadth5': breadth5,
        'medianRet1': med1,
        'medianRet5': med5,
        'medianVolumeRatio': med_volume,
        'riskOn': risk_on,
        'riskOff': risk_off,
    }


def regime_vector(regime):
    return [
        clip((regime['breadth1'] - 0.5) * 2.0, -1.0, 1.0),
        clip((regime['breadth5'] - 0.5) * 2.0, -1.0, 1.0),
        clip(regime['medianRet1'] / 4.0, -1.0, 1.0),
        clip(regime['medianRet5'] / 10.0, -1.0, 1.0),
        clip(math.log(max(regime['medianVolumeRatio'], 0.125), 2) / 3.0, -1.0, 1.0),
        regime['riskOn'],
        regime['riskOff'],
    ]


def v166_vector(feature, flags, regime):
    return extended_vector(feature, flags) + regime_vector(regime)


def triple_barrier_outcome(feature, future_rows):
    if not future_rows:
        return None
    atr = feature['a14']
    close = feature['close']
    entry_low = close - ENTRY_ATR * atr
    entry_high = close + ENTRY_ATR * atr
    first = future_rows[0]

    if first['open'] > entry_high:
        return {'status': 'NO_ENTRY_GAP_ABOVE', 'entered': 0, 'netReturnPct': 0.0}
    if first['open'] < close - STOP_ATR * atr:
        return {'status': 'NO_ENTRY_GAP_BELOW_STOP', 'entered': 0, 'netReturnPct': 0.0}

    if entry_low <= first['open'] <= entry_high:
        entry = first['open']
    elif first['open'] < entry_low and first['high'] >= entry_low:
        entry = entry_low
    elif first['low'] <= entry_high and first['high'] >= entry_low:
        entry = min(entry_high, max(entry_low, first['open']))
    else:
        return {'status': 'NO_ENTRY_RANGE_NOT_TOUCHED', 'entered': 0, 'netReturnPct': 0.0}

    stop = entry - STOP_ATR * atr
    target = entry + TARGET_ATR * atr
    for day_index, row in enumerate(future_rows[:HORIZON_SESSIONS], 1):
        hit_stop = row['low'] <= stop
        hit_target = row['high'] >= target
        if hit_stop and hit_target:
            gross = pct(stop, entry)
            return {'status': 'STOP_HIT_CONSERVATIVE_BOTH', 'entered': 1, 'target': 0, 'stop': 1, 'time': 0, 'entry': entry, 'exit': stop, 'exitDay': day_index, 'grossReturnPct': gross, 'netReturnPct': gross - ROUND_TRIP_COST_PCT}
        if hit_stop:
            gross = pct(stop, entry)
            return {'status': 'STOP_HIT', 'entered': 1, 'target': 0, 'stop': 1, 'time': 0, 'entry': entry, 'exit': stop, 'exitDay': day_index, 'grossReturnPct': gross, 'netReturnPct': gross - ROUND_TRIP_COST_PCT}
        if hit_target:
            gross = pct(target, entry)
            return {'status': 'TARGET_HIT', 'entered': 1, 'target': 1, 'stop': 0, 'time': 0, 'entry': entry, 'exit': target, 'exitDay': day_index, 'grossReturnPct': gross, 'netReturnPct': gross - ROUND_TRIP_COST_PCT}

    exit_price = future_rows[min(HORIZON_SESSIONS, len(future_rows)) - 1]['close']
    gross = pct(exit_price, entry)
    return {'status': 'TIME_EXIT', 'entered': 1, 'target': 0, 'stop': 0, 'time': 1, 'entry': entry, 'exit': exit_price, 'exitDay': min(HORIZON_SESSIONS, len(future_rows)), 'grossReturnPct': gross, 'netReturnPct': gross - ROUND_TRIP_COST_PCT}


def ticker_return_series(history, index, length=25):
    rows = history['rows']
    start = max(1, index - length + 1)
    return [pct(rows[i]['close'], rows[i - 1]['close']) for i in range(start, index + 1)]


def build_dataset():
    histories = [norm_hist(path) for path in HISTORY_DIR.glob('*.json')]
    histories = [history for history in histories if history['ok'] and len(history['rows']) >= 65]
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
        med20 = median([feature['ret20'] for feature in by_date[date]])
        regime = market_regime(by_date[date])
        for feature in by_date[date]:
            feature['rs20'] = feature['ret20'] - med20
            feature['_regime'] = regime

    labeled_dates = dates[:-HORIZON_SESSIONS]
    if len(labeled_dates) < MIN_SIGNAL_SESSIONS:
        raise RuntimeError(f'Need at least {MIN_SIGNAL_SESSIONS} signal sessions, found {len(labeled_dates)}')

    rows = []
    rows_by_date = {}
    date_index = {date: index for index, date in enumerate(dates)}
    for signal_date in labeled_dates:
        di = date_index[signal_date]
        future_dates = dates[di + 1:di + 1 + HORIZON_SESSIONS]
        future_maps = [{feature['ticker']: feature for feature in by_date[date]} for date in future_dates]
        session_rows = []
        for feature in by_date[signal_date]:
            future = []
            for mapping in future_maps:
                item = mapping.get(feature['ticker'])
                if item:
                    history = item['_history']
                    future.append(history['rows'][item['_index']])
            if not future:
                continue
            outcome = triple_barrier_outcome(feature, future)
            if not outcome:
                continue
            flags = extended_flags(feature)
            session_rows.append({
                'signalDate': signal_date,
                'ticker': feature['ticker'],
                'name': feature['name'],
                'feature': feature,
                'flags': flags,
                'x': v166_vector(feature, flags, feature['_regime']),
                'outcome': outcome,
                'yEntry': outcome.get('entered', 0),
                'yTarget': outcome.get('target', 0),
                'yStop': outcome.get('stop', 0),
                'yPositive': 1 if outcome.get('netReturnPct', 0.0) > 0 else 0,
            })
        rows.extend(session_rows)
        rows_by_date[signal_date] = session_rows
    return histories, dates, labeled_dates, by_date, rows, rows_by_date


def fit_models(training_rows):
    entered = [row for row in training_rows if row['yEntry']]
    if not training_rows or len(entered) < 50:
        return None
    width = len(training_rows[0]['x'])
    models = {
        'entry': train([0.0] * width, training_rows, 'yEntry', 'x', 34, 0.025),
        'target': train([0.0] * width, entered, 'yTarget', 'x', 34, 0.023),
        'stop': train([0.0] * width, entered, 'yStop', 'x', 34, 0.023),
        'positive': train([0.0] * width, entered, 'yPositive', 'x', 34, 0.023),
    }
    time_returns = [row['outcome']['netReturnPct'] for row in entered if row['outcome']['status'] == 'TIME_EXIT']
    models['timeMean'] = clip(safe_mean(time_returns, -ROUND_TRIP_COST_PCT), -5.0, 5.0)
    models['training'] = training_rows
    models['entered'] = entered
    return models


def score_row(row, models, correlations, lifts):
    p_entry = calibrated_probability(models['entry'], row, models['training'], 'yEntry', 'x')
    p_target = calibrated_probability(models['target'], row, models['entered'], 'yTarget', 'x')
    p_stop = calibrated_probability(models['stop'], row, models['entered'], 'yStop', 'x')
    p_positive = calibrated_probability(models['positive'], row, models['entered'], 'yPositive', 'x')
    total = p_target + p_stop
    if total > 0.92:
        scale = 0.92 / total
        p_target *= scale
        p_stop *= scale
    p_time = max(0.0, 1.0 - p_target - p_stop)
    feature = row['feature']
    target_net = pct(feature['close'] + TARGET_ATR * feature['a14'], feature['close']) - ROUND_TRIP_COST_PCT
    stop_net = pct(feature['close'] - STOP_ATR * feature['a14'], feature['close']) - ROUND_TRIP_COST_PCT
    ev_entered = p_target * target_net + p_stop * stop_net + p_time * models['timeMean']
    ev = p_entry * ev_entered
    support = effective_model_support(row['flags'], correlations, lifts)
    ratio = p_target / max(p_stop, 1e-6)
    risk_penalty = feature['momentumFailureRisk'] * 0.45 + feature['_regime']['riskOff'] * 0.20
    quality = ev + 0.15 * (p_positive - 0.5) + 0.04 * min(support, 3.0) - risk_penalty
    reasons = execution_reasons(feature)
    if p_entry < MIN_ENTRY_PROB:
        reasons.append('LOW_ENTRY_PROBABILITY')
    if p_target < MIN_TARGET_PROB:
        reasons.append('LOW_TARGET_PROBABILITY')
    if ratio < MIN_TARGET_STOP_RATIO:
        reasons.append('TARGET_STOP_RATIO_TOO_LOW')
    if ev < MIN_EV_PCT:
        reasons.append('EXPECTED_VALUE_TOO_LOW')
    return {
        **row,
        'pEntry': p_entry,
        'pTarget': p_target,
        'pStop': p_stop,
        'pTime': p_time,
        'pPositive': p_positive,
        'expectedValuePct': ev,
        'targetStopRatio': ratio,
        'effectiveSupport': support,
        'qualityScore': quality,
        'exclusionReasons': sorted(set(reasons)),
    }


def model_lifts(rows):
    model_count = len(MODELS) + 1
    base_target = sum(row['yTarget'] for row in rows) / max(1, sum(row['yEntry'] for row in rows))
    lifts = []
    for index in range(model_count):
        signals = [row for row in rows if row['flags'][index] and row['yEntry']]
        hits = sum(row['yTarget'] for row in signals)
        posterior = (hits + base_target * 25) / (len(signals) + 25)
        lifts.append(posterior / max(base_target, 1e-6))
    correlations = []
    for left in range(model_count):
        line = []
        lv = [row['flags'][left] for row in rows]
        for right in range(model_count):
            rv = [row['flags'][right] for row in rows]
            line.append(pearson(lv, rv))
        correlations.append(line)
    return correlations, lifts


def pair_correlation(left, right):
    lf = left['feature']
    rf = right['feature']
    lret = ticker_return_series(lf['_history'], lf['_index'])
    rret = ticker_return_series(rf['_history'], rf['_index'])
    n = min(len(lret), len(rret))
    return pearson(lret[-n:], rret[-n:]) if n >= 8 else 0.0


def choose_portfolio(scored):
    candidates = [row for row in scored if not row['exclusionReasons']]
    candidates.sort(key=lambda row: (row['qualityScore'], row['expectedValuePct']), reverse=True)
    candidates = candidates[:8]
    if not candidates:
        return [], {'reason': 'NO_CANDIDATE_PASSED_GATES'}

    best_selection = [candidates[0]]
    best_utility = candidates[0]['expectedValuePct']
    for left, right in combinations(candidates, 2):
        correlation = max(0.0, pair_correlation(left, right))
        joint_stop = left['pStop'] * right['pStop'] * (1.0 + correlation)
        utility = (
            (left['expectedValuePct'] + right['expectedValuePct']) / 2.0
            - 0.35 * correlation
            - 0.60 * joint_stop
        )
        if utility > best_utility + 0.05:
            best_utility = utility
            best_selection = [left, right]
    if best_utility < MIN_EV_PCT:
        return [], {'reason': 'PORTFOLIO_EXPECTED_VALUE_BELOW_GATE', 'utility': best_utility}
    return best_selection[:MAX_POSITIONS], {'utility': best_utility}


def portfolio_return(selection):
    entered = [row['outcome']['netReturnPct'] for row in selection if row['outcome'].get('entered')]
    return safe_mean(entered, 0.0) if entered else 0.0


def aggregate_sessions(sessions):
    returns = [session['portfolioNetReturnPct'] for session in sessions if session['positions']]
    trade_rows = [trade for session in sessions for trade in session['trades']]
    gains = sum(max(0.0, value) for value in returns)
    losses = abs(sum(min(0.0, value) for value in returns))
    equity = peak = 1.0
    max_dd = 0.0
    for value in returns:
        equity *= 1.0 + value / 100.0
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
    targets = sum(trade['status'] == 'TARGET_HIT' for trade in trade_rows)
    stops = sum(trade['status'].startswith('STOP_HIT') for trade in trade_rows)
    return {
        'evaluatedSessions': len(sessions),
        'tradedSessions': len(returns),
        'noTradeSessions': len(sessions) - len(returns),
        'sessionWinRatePct': round_value(sum(value > 0 for value in returns) / max(1, len(returns)) * 100, 3),
        'averageNetPortfolioReturnPct': round_value(safe_mean(returns), 4),
        'medianNetPortfolioReturnPct': round_value(statistics.median(returns) if returns else 0.0, 4),
        'compoundedNetReturnPct': round_value((equity - 1.0) * 100.0, 3),
        'maximumDrawdownPct': round_value(max_dd, 3),
        'profitFactor': round_value(gains / losses if losses > 0 else None, 3),
        'selectedTrades': len(trade_rows),
        'targets': targets,
        'stops': stops,
        'timeExits': sum(trade['status'] == 'TIME_EXIT' for trade in trade_rows),
        'targetStopRatio': round_value(targets / max(1, stops), 3),
        'tradeWinRatePct': round_value(sum(trade['netReturnPct'] > 0 for trade in trade_rows) / max(1, len(trade_rows)) * 100, 3),
    }


def output_candidate(row, rank):
    feature = row['feature']
    atr = feature['a14']
    return {
        'rank': rank,
        'ticker': row['ticker'],
        'companyNameAr': row['name'],
        'expectedValuePct': round_value(row['expectedValuePct'], 3),
        'probabilityEntryPct': round_value(row['pEntry'] * 100, 2),
        'probabilityTargetPct': round_value(row['pTarget'] * 100, 2),
        'probabilityStopPct': round_value(row['pStop'] * 100, 2),
        'probabilityTimeExitPct': round_value(row['pTime'] * 100, 2),
        'probabilityPositivePct': round_value(row['pPositive'] * 100, 2),
        'targetStopRatio': round_value(row['targetStopRatio'], 2),
        'qualityScore': round_value(row['qualityScore'], 4),
        'effectiveModelSupport': round_value(row['effectiveSupport'], 4),
        'matchedModels': [MODELS[index][0] if index < len(MODELS) else 'VOLUME_SHOCK' for index, value in enumerate(row['flags']) if value],
        'entryLow': round_value(feature['close'] - ENTRY_ATR * atr, 4),
        'entryHigh': round_value(feature['close'] + ENTRY_ATR * atr, 4),
        'stopLoss': round_value(feature['close'] - STOP_ATR * atr, 4),
        'target1': round_value(feature['close'] + TARGET_ATR * atr, 4),
        'close': round_value(feature['close'], 4),
        'rsi14': round_value(feature['rsi'], 1),
        'volumeRatio20': round_value(feature['vr'], 2),
        'momentumFailureRiskPct': round_value(feature['momentumFailureRisk'] * 100, 1),
        'marketRegime': 'RISK_OFF' if feature['_regime']['riskOff'] else 'RISK_ON' if feature['_regime']['riskOn'] else 'NEUTRAL',
        'morningConfirmation': {
            'status': 'PENDING_OPEN_CONFIRMATION',
            'cancelIfOpenAbove': round_value(feature['close'] + ENTRY_ATR * atr, 4),
            'cancelIfOpenBelowStop': round_value(feature['close'] - STOP_ATR * atr, 4),
            'ruleAr': 'لا يتم الشراء إذا افتتح أعلى نطاق الدخول أو أسفل وقف الخسارة؛ يلزم بقاء السعر داخل النطاق وتأكيد السيولة صباحًا.',
        },
        'exclusionReasons': row['exclusionReasons'],
    }


def main():
    histories, dates, labeled_dates, by_date, rows, rows_by_date = build_dataset()
    correlations, lifts = model_lifts(rows)
    sessions = []

    for current_index in range(WARMUP_SESSIONS + EMBARGO_SESSIONS, len(labeled_dates)):
        signal_date = labeled_dates[current_index]
        training_dates = labeled_dates[:current_index - EMBARGO_SESSIONS]
        training_rows = [row for date in training_dates for row in rows_by_date[date]]
        models = fit_models(training_rows)
        if not models:
            continue
        scored = [score_row(row, models, correlations, lifts) for row in rows_by_date[signal_date]]
        selection, selection_meta = choose_portfolio(scored)
        trades = [
            {
                'ticker': row['ticker'],
                'status': row['outcome']['status'],
                'netReturnPct': round_value(row['outcome']['netReturnPct'], 4),
                'expectedValuePct': round_value(row['expectedValuePct'], 4),
                'pTargetPct': round_value(row['pTarget'] * 100, 2),
                'pStopPct': round_value(row['pStop'] * 100, 2),
            }
            for row in selection
        ]
        sessions.append({
            'signalDate': signal_date,
            'positions': len(selection),
            'tickers': [row['ticker'] for row in selection],
            'portfolioNetReturnPct': round_value(portfolio_return(selection), 4),
            'selectionMeta': selection_meta,
            'trades': trades,
        })

    metrics = aggregate_sessions(sessions)
    acceptance = {
        'minimumEvaluatedSessions': metrics['evaluatedSessions'] >= 25,
        'positiveAverageReturn': (metrics['averageNetPortfolioReturnPct'] or 0) > 0.15,
        'positiveCompoundedReturn': (metrics['compoundedNetReturnPct'] or 0) > 0,
        'profitFactorAtLeast125': (metrics['profitFactor'] or 0) >= 1.25,
        'maximumDrawdownAboveMinus10': (metrics['maximumDrawdownPct'] or -100) >= -10,
        'targetStopRatioAtLeast125': (metrics['targetStopRatio'] or 0) >= 1.25,
        'tradeWinRateAtLeast45': (metrics['tradeWinRatePct'] or 0) >= 45,
        'allowsNoTradeDays': metrics['noTradeSessions'] > 0,
    }
    production_eligible = all(acceptance.values())

    final_models = fit_models(rows)
    latest_date = dates[-1]
    latest_rows = []
    for feature in by_date[latest_date]:
        flags = extended_flags(feature)
        row = {
            'signalDate': latest_date,
            'ticker': feature['ticker'],
            'name': feature['name'],
            'feature': feature,
            'flags': flags,
            'x': v166_vector(feature, flags, feature['_regime']),
        }
        latest_rows.append(score_row(row, final_models, correlations, lifts))
    current_selection, current_meta = choose_portfolio(latest_rows)
    ranked = sorted(latest_rows, key=lambda row: (row['qualityScore'], row['expectedValuePct']), reverse=True)

    report = {
        'schemaVersion': '16.6.0-triple-barrier-research',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'status': 'PRODUCTION_GATE_PASSED' if production_eligible else 'PRODUCTION_GATE_BLOCKED',
        'productionEligible': production_eligible,
        'methodology': {
            'goal': 'Select zero, one, or two trades with target probability materially above stop probability and positive expected value after costs.',
            'signalSessions': len(labeled_dates),
            'walkForwardWarmupSessions': WARMUP_SESSIONS,
            'purgedEmbargoSessions': EMBARGO_SESSIONS,
            'tripleBarrierHorizonSessions': HORIZON_SESSIONS,
            'roundTripCostPct': ROUND_TRIP_COST_PCT,
            'targetAtr': TARGET_ATR,
            'stopAtr': STOP_ATR,
            'entryAtr': ENTRY_ATR,
            'noFutureLeakage': True,
            'morningConfirmation': 'Next-session opening gap gate; live 10–15 minute confirmation remains required by the app.',
            'portfolioRule': 'Choose zero, one, or two positions; pair utility penalizes positive correlation and joint stop probability.',
        },
        'walkForwardMetrics': metrics,
        'acceptanceGate': acceptance,
        'currentSignalDate': latest_date,
        'currentSelectionMeta': current_meta,
        'currentRecommendations': [output_candidate(row, index) for index, row in enumerate(current_selection, 1)] if production_eligible else [],
        'currentResearchCandidates': [output_candidate(row, index) for index, row in enumerate(ranked[:10], 1)],
        'recentWalkForwardSessions': sessions[-15:],
        'notesAr': [
            'لا يتم نشر توصيات شراء من V16.6 إلا إذا اجتازت جميع بوابات الأداء خارج العينة.',
            'قد تكون النتيجة اليومية صفر توصيات؛ عدم التداول قرار صحيح عندما لا توجد أفضلية إحصائية كافية.',
            'التأكيد الصباحي اللحظي يحتاج بيانات افتتاح وحجم أول 10–15 دقيقة، لذلك تظل المرشحات قبل الافتتاح معلقة حتى التحقق.',
        ],
    }
    wr(OUT, report)
    print(json.dumps({
        'status': report['status'],
        'walkForwardMetrics': metrics,
        'acceptanceGate': acceptance,
        'currentRecommendations': report['currentRecommendations'],
        'topResearchCandidates': report['currentResearchCandidates'][:5],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
