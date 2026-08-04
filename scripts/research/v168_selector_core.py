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
    str(ROOT / 'scripts/research/v16-two-stage-predictor.py'),
    run_name='v168_base',
)

rd = BASE['rd']
wr = BASE['wr']
mean = BASE['mean']
median = BASE['median']
round_value = BASE['round_value']
clip = BASE['clip']
pct = BASE['pct']
norm_hist = BASE['norm_hist']
base_feature = BASE['base_feature']
augment_feature = BASE['augment_feature']
extended_flags = BASE['extended_flags']
extended_vector = BASE['extended_vector']
base_vector = BASE['base_vector']
train = BASE['train']
calibrated_probability = BASE['calibrated_probability']
effective_model_support = BASE['effective_model_support']
MODELS = BASE['MODELS']

HISTORY_DIR = ROOT / 'data/history'
OUT = ROOT / 'data/research/v16-v168-practical-selector.json'
COST_PCT = 0.60
MIN_UNIVERSE = 60
WARMUP = 20
TOP_CANDIDATE_POOL = 8
BLOCK_SIZE = 5
INNER_LOOKBACK = 6
MAX_POSITIONS = 2

STRATEGIES = [
    'QUALITY_ONE',
    'QUALITY_PAIR',
    'CONSENSUS_ONE',
    'PREDICTION_ONE',
]


def safe_mean(values, default=0.0):
    values = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    return statistics.fmean(values) if values else default


def pearson(left, right):
    pairs = [(a, b) for a, b in zip(left, right)
             if isinstance(a, (int, float)) and isinstance(b, (int, float))
             and math.isfinite(a) and math.isfinite(b)]
    if len(pairs) < 8:
        return 0.0
    la = safe_mean([a for a, _ in pairs])
    rb = safe_mean([b for _, b in pairs])
    num = sum((a - la) * (b - rb) for a, b in pairs)
    da = sum((a - la) ** 2 for a, _ in pairs)
    db = sum((b - rb) ** 2 for _, b in pairs)
    return num / math.sqrt(da * db) if da > 0 and db > 0 else 0.0


def model_stats(rows):
    base = sum(row['yTop10'] for row in rows) / max(1, len(rows))
    model_count = len(MODELS) + 1
    lifts = []
    correlations = []
    for i in range(model_count):
        signals = [row for row in rows if row['flags'][i]]
        hits = sum(row['yTop10'] for row in signals)
        posterior = (hits + base * 30.0) / (len(signals) + 30.0)
        lifts.append(posterior / max(base, 1e-6))
    for left in range(model_count):
        lv = [row['flags'][left] for row in rows]
        line = []
        for right in range(model_count):
            rv = [row['flags'][right] for row in rows]
            line.append(pearson(lv, rv))
        correlations.append(line)
    return base, correlations, lifts


def ticker_returns(row, length=25):
    history = row['history']
    index = row['historyIndex']
    rows = history['rows']
    start = max(1, index - length + 1)
    return [pct(rows[i]['close'], rows[i - 1]['close']) for i in range(start, index + 1)]


def pair_correlation(left, right):
    lret = ticker_returns(left)
    rret = ticker_returns(right)
    n = min(len(lret), len(rret))
    return pearson(lret[-n:], rret[-n:]) if n >= 8 else 0.0


def hard_reasons(feature):
    reasons = []
    if feature['turn'] < 5_000_000:
        reasons.append('TURNOVER_BELOW_5M')
    if feature['vr'] < 0.65:
        reasons.append('VOLUME_RATIO_BELOW_065')
    if not 45 <= feature['rsi'] <= 79:
        reasons.append('RSI_OUTSIDE_45_79')
    if feature['ret5'] > 22:
        reasons.append('RETURN5_ABOVE_22')
    if feature['ret20'] > 65:
        reasons.append('RETURN20_ABOVE_65')
    if feature['breakout'] > 6:
        reasons.append('EXTENDED_ABOVE_BREAKOUT')
    if feature['momentumFailureRisk'] >= 0.45:
        reasons.append('MOMENTUM_FAILURE_HIGH')
    if feature['closePosition'] < 0.30:
        reasons.append('WEAK_CLOSE_POSITION')
    return reasons


def score_rows(session, weights, seen_rows):
    base_top = sum(row['yTop10'] for row in seen_rows) / max(1, len(seen_rows))
    base_pos = sum(row['yNetPositive'] for row in seen_rows) / max(1, len(seen_rows))
    base_loss = sum(row['yLargeLoss'] for row in seen_rows) / max(1, len(seen_rows))
    _, correlations, lifts = model_stats(seen_rows)
    scored = []
    for row in session:
        p_top = calibrated_probability(weights['top'], row, seen_rows, 'yTop10', 'xNew')
        p_pos = calibrated_probability(weights['positive'], row, seen_rows, 'yNetPositive', 'xNew')
        p_loss = calibrated_probability(weights['loss'], row, seen_rows, 'yLargeLoss', 'xNew')
        support = effective_model_support(row['flags'], correlations, lifts)
        feature = row['feature']
        matched = [MODELS[i][0] if i < len(MODELS) else 'VOLUME_SHOCK'
                   for i, value in enumerate(row['flags']) if value]
        top_lift = p_top / max(base_top, 1e-6)
        selector_score = (
            0.85 * (top_lift - 1.0)
            + 0.75 * (p_pos - base_pos)
            - 1.10 * (p_loss - base_loss)
            + 0.12 * min(support, 3.0)
            - 0.55 * feature['momentumFailureRisk']
            + 0.08 * (feature['closePosition'] - 0.5)
            + 0.04 * clip(math.log10(max(feature['turn'], 1.0)) - 6.7, -1.0, 1.0)
        )
        scored.append({
            **row,
            'pTop10': p_top,
            'pPositive': p_pos,
            'pLargeLoss': p_loss,
            'topLift': top_lift,
            'effectiveSupport': support,
            'matchedModels': matched,
            'selectorScore': selector_score,
            'hardReasons': hard_reasons(feature),
        })
    scored.sort(key=lambda row: row['pTop10'], reverse=True)
    pool = scored[:TOP_CANDIDATE_POOL]
    for row in pool:
        row['candidatePool'] = True
    return scored, pool


def safe_pool(pool):
    return [row for row in pool if not row['hardReasons'] and row['topLift'] >= 1.02]


def select_strategy(strategy, pool):
    safe = safe_pool(pool)
    if not safe:
        return []
    if strategy == 'PREDICTION_ONE':
        return [max(safe, key=lambda row: row['pTop10'])]
    if strategy == 'CONSENSUS_ONE':
        consensus = [row for row in safe if row['matchedModels']]
        if not consensus:
            return []
        return [max(consensus, key=lambda row: (row['effectiveSupport'], row['selectorScore']))]
    ranked = sorted(safe, key=lambda row: row['selectorScore'], reverse=True)
    if strategy == 'QUALITY_ONE':
        return ranked[:1]
    if strategy == 'QUALITY_PAIR':
        first = ranked[0]
        selection = [first]
        for second in ranked[1:]:
            correlation = pair_correlation(first, second)
            close_enough = second['selectorScore'] >= first['selectorScore'] - 0.18
            independent = correlation <= 0.55
            not_same_single_model = not (
                len(first['matchedModels']) == 1
                and first['matchedModels'] == second['matchedModels']
            )
            if close_enough and independent and not_same_single_model:
                selection.append(second)
                break
        return selection[:MAX_POSITIONS]
    return []


def selection_return(selection):
    if not selection:
        return 0.0
    return safe_mean([row['nextReturn'] - COST_PCT for row in selection])


def strategy_metrics(snapshots, strategy):
    sessions = []
    for snapshot in snapshots:
        selection = select_strategy(strategy, snapshot['pool'])
        sessions.append({
            'positions': len(selection),
            'returnPct': selection_return(selection),
        })
    traded = [session for session in sessions if session['positions']]
    returns = [session['returnPct'] for session in traded]
    gains = sum(max(0.0, value) for value in returns)
    losses = abs(sum(min(0.0, value) for value in returns))
    return {
        'evaluatedSessions': len(sessions),
        'tradedSessions': len(traded),
        'averageReturnPct': safe_mean(returns, -5.0) if traded else -5.0,
        'winRatePct': sum(value > 0 for value in returns) / max(1, len(returns)) * 100.0,
        'profitFactor': gains / losses if losses > 0 else (9.0 if gains > 0 else 0.0),
    }


def strategy_objective(metrics):
    scarcity_penalty = 1.0 if metrics['tradedSessions'] < 2 else 0.0
    return (
        metrics['averageReturnPct']
        + 0.12 * math.log(max(metrics['profitFactor'], 0.1))
        + 0.002 * metrics['winRatePct']
        - scarcity_penalty
    )


def aggregate(final_sessions):
    traded = [session for session in final_sessions if session['positions']]
    returns = [session['returnPct'] for session in traded]
    gains = sum(max(0.0, value) for value in returns)
    losses = abs(sum(min(0.0, value) for value in returns))
    equity = peak = 1.0
    max_dd = 0.0
    for value in returns:
        equity *= 1.0 + value / 100.0
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
    trades = [trade for session in traded for trade in session['trades']]
    return {
        'evaluatedSessions': len(final_sessions),
        'tradedSessions': len(traded),
        'noTradeSessions': len(final_sessions) - len(traded),
        'averagePositionsPerTradeDay': round_value(safe_mean([s['positions'] for s in traded]), 3),
        'sessionWinRatePct': round_value(sum(value > 0 for value in returns) / max(1, len(returns)) * 100.0, 3),
        'averageNetReturnPct': round_value(safe_mean(returns), 4),
        'medianNetReturnPct': round_value(statistics.median(returns) if returns else 0.0, 4),
        'compoundedNetReturnPct': round_value((equity - 1.0) * 100.0, 3),
        'maximumDrawdownPct': round_value(max_dd, 3),
        'profitFactor': round_value(gains / losses if losses > 0 else None, 3),
        'selectedTrades': len(trades),
        'tradeWinRatePct': round_value(sum(t['netReturnPct'] > 0 for t in trades) / max(1, len(trades)) * 100.0, 3),
        'averageTopLift': round_value(safe_mean([t['topLift'] for t in trades]), 3),
        'averagePredictedLargeLossPct': round_value(safe_mean([t['pLargeLossPct'] for t in trades]), 3),
    }


def build_output(row, rank, category):
    feature = row['feature']
    atr = feature['a14']
    return {
        'rank': rank,
        'ticker': row['ticker'],
        'companyNameAr': row['name'],
        'category': category,
        'close': round_value(feature['close'], 4),
        'entryLow': round_value(feature['close'] - 0.08 * atr, 4),
        'entryHigh': round_value(feature['close'] + 0.08 * atr, 4),
        'stopLoss': round_value(feature['close'] - 0.90 * atr, 4),
        'target1': round_value(feature['close'] + 1.20 * atr, 4),
        'holdingSessions': 1,
        'probabilityTop10Pct': round_value(row['pTop10'] * 100, 2),
        'top10LiftVsBase': round_value(row['topLift'], 3),
        'probabilityNetPositivePct': round_value(row['pPositive'] * 100, 2),
        'probabilityLargeLossPct': round_value(row['pLargeLoss'] * 100, 2),
        'selectorScore': round_value(row['selectorScore'], 4),
        'matchedModels': row['matchedModels'],
        'effectiveModelSupport': round_value(row['effectiveSupport'], 4),
        'rsi14': round_value(feature['rsi'], 1),
        'volumeRatio20': round_value(feature['vr'], 2),
        'averageTurnover20Egp': round_value(feature['turn'], 0),
        'momentumFailureRiskPct': round_value(feature['momentumFailureRisk'] * 100, 1),
        'breakoutPct': round_value(feature['breakout'], 2),
        'morningConfirmation': {
            'status': 'PENDING_OPEN_CONFIRMATION',
            'cancelIfOpenAbove': round_value(feature['close'] + 0.08 * atr, 4),
            'cancelIfOpenBelow': round_value(feature['close'] - 0.90 * atr, 4),
            'ruleAr': 'يُلغى الدخول عند فجوة أعلى من نطاق الشراء أو ضعف السيولة في أول 10–15 دقيقة؛ لا تتم مطاردة السعر.',
        },
    }
