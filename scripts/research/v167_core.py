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
    run_name='v167_base',
)

rd = BASE['rd']
wr = BASE['wr']
median = BASE['median']
round_value = BASE['round_value']
clip = BASE['clip']
pct = BASE['pct']
norm_hist = BASE['norm_hist']
base_feature = BASE['base_feature']
augment_feature = BASE['augment_feature']
extended_flags = BASE['extended_flags']
extended_vector = BASE['extended_vector']
execution_reasons = BASE['execution_reasons']
effective_model_support = BASE['effective_model_support']
MODELS = BASE['MODELS']

HISTORY_DIR = ROOT / 'data/history'
OUT = ROOT / 'data/research/v16-v167-coherent-engine.json'

MIN_UNIVERSE = 60
MIN_SIGNAL_SESSIONS = 50
OUTER_WARMUP = 30
EMBARGO = 3
INNER_VALIDATION_SESSIONS = 8
ROUND_TRIP_COST_PCT = 0.60
ENTRY_ATR = 0.12
MAX_POSITIONS = 2
MIN_CONDITIONAL_EV_PCT = 0.05
MIN_ENTRY_PROB = 0.40
MAX_TECHNICAL_REASONS = 0

CONFIGS = [
    {'id': 'FAST_2D', 'horizon': 2, 'targetAtr': 1.00, 'stopAtr': 0.80},
    {'id': 'BALANCED_3D', 'horizon': 3, 'targetAtr': 1.25, 'stopAtr': 0.90},
    {'id': 'SWING_3D', 'horizon': 3, 'targetAtr': 1.50, 'stopAtr': 1.05},
    {'id': 'BALANCED_5D', 'horizon': 5, 'targetAtr': 1.50, 'stopAtr': 1.00},
    {'id': 'WIDE_5D', 'horizon': 5, 'targetAtr': 1.80, 'stopAtr': 1.20},
]


def safe_mean(values, default=0.0):
    values = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    return statistics.fmean(values) if values else default


def safe_median(values, default=0.0):
    values = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    return statistics.median(values) if values else default


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


def softmax(logits):
    peak = max(logits)
    values = [math.exp(clip(v - peak, -40.0, 0.0)) for v in logits]
    total = sum(values)
    return [v / total for v in values] if total else [1.0 / len(values)] * len(values)


def market_regime(features):
    ret1 = [f['ret1'] for f in features]
    ret5 = [f['ret5'] for f in features]
    breadth1 = sum(v > 0 for v in ret1) / max(1, len(ret1))
    breadth5 = sum(v > 0 for v in ret5) / max(1, len(ret5))
    med1 = median(ret1)
    med5 = median(ret5)
    med_volume = median([f['vr'] for f in features])
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


def v167_vector(feature, flags):
    return extended_vector(feature, flags) + regime_vector(feature['_regime'])


def triple_barrier_outcome(feature, future_rows, config):
    if not future_rows:
        return None
    atr = feature['a14']
    close = feature['close']
    entry_low = close - ENTRY_ATR * atr
    entry_high = close + ENTRY_ATR * atr
    first = future_rows[0]

    if first['open'] > entry_high:
        return {'status': 'NO_ENTRY_GAP_ABOVE', 'entered': 0, 'class': None, 'netReturnPct': 0.0}
    if first['open'] < close - config['stopAtr'] * atr:
        return {'status': 'NO_ENTRY_GAP_BELOW_STOP', 'entered': 0, 'class': None, 'netReturnPct': 0.0}

    if entry_low <= first['open'] <= entry_high:
        entry = first['open']
    elif first['open'] < entry_low and first['high'] >= entry_low:
        entry = entry_low
    elif first['low'] <= entry_high and first['high'] >= entry_low:
        entry = min(entry_high, max(entry_low, first['open']))
    else:
        return {'status': 'NO_ENTRY_RANGE_NOT_TOUCHED', 'entered': 0, 'class': None, 'netReturnPct': 0.0}

    stop = entry - config['stopAtr'] * atr
    target = entry + config['targetAtr'] * atr
    for day_index, row in enumerate(future_rows[:config['horizon']], 1):
        hit_stop = row['low'] <= stop
        hit_target = row['high'] >= target
        if hit_stop and hit_target:
            gross = pct(stop, entry)
            return {'status': 'STOP_HIT_CONSERVATIVE_BOTH', 'entered': 1, 'class': 1,
                    'entry': entry, 'exit': stop, 'exitDay': day_index,
                    'grossReturnPct': gross, 'netReturnPct': gross - ROUND_TRIP_COST_PCT}
        if hit_stop:
            gross = pct(stop, entry)
            return {'status': 'STOP_HIT', 'entered': 1, 'class': 1,
                    'entry': entry, 'exit': stop, 'exitDay': day_index,
                    'grossReturnPct': gross, 'netReturnPct': gross - ROUND_TRIP_COST_PCT}
        if hit_target:
            gross = pct(target, entry)
            return {'status': 'TARGET_HIT', 'entered': 1, 'class': 0,
                    'entry': entry, 'exit': target, 'exitDay': day_index,
                    'grossReturnPct': gross, 'netReturnPct': gross - ROUND_TRIP_COST_PCT}

    end_index = min(config['horizon'], len(future_rows)) - 1
    exit_price = future_rows[end_index]['close']
    gross = pct(exit_price, entry)
    return {'status': 'TIME_EXIT', 'entered': 1, 'class': 2,
            'entry': entry, 'exit': exit_price, 'exitDay': end_index + 1,
            'grossReturnPct': gross, 'netReturnPct': gross - ROUND_TRIP_COST_PCT}


def build_market():
    histories = [norm_hist(path) for path in HISTORY_DIR.glob('*.json')]
    histories = [h for h in histories if h['ok'] and len(h['rows']) >= 70]
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

    dates = sorted(d for d, values in by_date.items() if len(values) >= MIN_UNIVERSE)
    for date in dates:
        med20 = median([f['ret20'] for f in by_date[date]])
        regime = market_regime(by_date[date])
        for feature in by_date[date]:
            feature['rs20'] = feature['ret20'] - med20
            feature['_regime'] = regime
    if len(dates) < MIN_SIGNAL_SESSIONS + max(c['horizon'] for c in CONFIGS):
        raise RuntimeError(f'Insufficient sessions: {len(dates)}')
    return histories, dates, by_date


def build_dataset_for_config(dates, by_date, config):
    horizon = config['horizon']
    labeled_dates = dates[:-horizon]
    date_index = {d: i for i, d in enumerate(dates)}
    rows = []
    rows_by_date = {}
    for signal_date in labeled_dates:
        di = date_index[signal_date]
        future_dates = dates[di + 1:di + 1 + horizon]
        future_maps = [{f['ticker']: f for f in by_date[d]} for d in future_dates]
        session = []
        for feature in by_date[signal_date]:
            future_rows = []
            for mapping in future_maps:
                item = mapping.get(feature['ticker'])
                if item:
                    future_rows.append(item['_history']['rows'][item['_index']])
            outcome = triple_barrier_outcome(feature, future_rows, config)
            if not outcome:
                continue
            flags = extended_flags(feature)
            row = {
                'signalDate': signal_date,
                'ticker': feature['ticker'],
                'name': feature['name'],
                'feature': feature,
                'flags': flags,
                'x': v167_vector(feature, flags),
                'outcome': outcome,
                'entered': outcome['entered'],
                'class': outcome['class'],
                'netReturnPct': outcome['netReturnPct'],
            }
            rows.append(row)
            session.append(row)
        rows_by_date[signal_date] = session
    return labeled_dates, rows, rows_by_date


def train_entry_logit(rows, epochs=45, lr=0.035, l2=0.012):
    if not rows:
        return None
    width = len(rows[0]['x'])
    weights = [0.0] * width
    for _ in range(epochs):
        gradient = [0.0] * width
        for row in rows:
            z = sum(a * b for a, b in zip(weights, row['x']))
            p = 1.0 / (1.0 + math.exp(-clip(z, -35.0, 35.0)))
            error = p - row['entered']
            for i, value in enumerate(row['x']):
                gradient[i] += error * value
        n = max(1, len(rows))
        for i in range(width):
            penalty = 0.0 if i == 0 else l2 * weights[i]
            weights[i] -= lr * (gradient[i] / n + penalty)
    return weights


def train_softmax(rows, epochs=65, lr=0.045, l2=0.014):
    entered = [r for r in rows if r['entered'] and r['class'] is not None]
    if len(entered) < 200:
        return None
    width = len(entered[0]['x'])
    weights = [[0.0] * width for _ in range(3)]
    for _ in range(epochs):
        gradient = [[0.0] * width for _ in range(3)]
        for row in entered:
            probs = softmax([sum(a * b for a, b in zip(w, row['x'])) for w in weights])
            for klass in range(3):
                error = probs[klass] - (1.0 if row['class'] == klass else 0.0)
                for i, value in enumerate(row['x']):
                    gradient[klass][i] += error * value
        n = max(1, len(entered))
        for klass in range(3):
            for i in range(width):
                penalty = 0.0 if i == 0 else l2 * weights[klass][i]
                weights[klass][i] -= lr * (gradient[klass][i] / n + penalty)
    return weights


def train_time_regression(rows, epochs=90, lr=0.018, l2=0.025):
    time_rows = [r for r in rows if r['entered'] and r['class'] == 2]
    if len(time_rows) < 100:
        return None
    width = len(time_rows[0]['x'])
    weights = [0.0] * width
    for _ in range(epochs):
        gradient = [0.0] * width
        for row in time_rows:
            prediction = sum(a * b for a, b in zip(weights, row['x']))
            target = clip(row['netReturnPct'], -8.0, 8.0)
            error = clip(prediction - target, -8.0, 8.0)
            for i, value in enumerate(row['x']):
                gradient[i] += error * value
        n = max(1, len(time_rows))
        for i in range(width):
            penalty = 0.0 if i == 0 else l2 * weights[i]
            weights[i] -= lr * (gradient[i] / n + penalty)
    return weights


def fit_models(rows):
    if not rows:
        return None
    entry = train_entry_logit(rows)
    multi = train_softmax(rows)
    time_model = train_time_regression(rows)
    if entry is None or multi is None or time_model is None:
        return None
    entered = [r for r in rows if r['entered'] and r['class'] is not None]
    base_class = [sum(r['class'] == k for r in entered) / max(1, len(entered)) for k in range(3)]
    return {'entry': entry, 'multi': multi, 'time': time_model, 'baseClass': base_class}


def model_lifts(rows):
    entered = [r for r in rows if r['entered'] and r['class'] is not None]
    base_target = sum(r['class'] == 0 for r in entered) / max(1, len(entered))
    model_count = len(MODELS) + 1
    lifts = []
    for index in range(model_count):
        signals = [r for r in entered if r['flags'][index]]
        hits = sum(r['class'] == 0 for r in signals)
        posterior = (hits + base_target * 30.0) / (len(signals) + 30.0)
        lifts.append(posterior / max(base_target, 1e-6))
    correlations = []
    for left in range(model_count):
        lv = [r['flags'][left] for r in entered]
        line = []
        for right in range(model_count):
            rv = [r['flags'][right] for r in entered]
            line.append(pearson(lv, rv))
        correlations.append(line)
    return correlations, lifts
