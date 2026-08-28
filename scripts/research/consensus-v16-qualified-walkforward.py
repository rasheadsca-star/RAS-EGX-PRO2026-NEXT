#!/usr/bin/env python3
import json
import math
import os
import runpy
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
BASE = runpy.run_path(str(ROOT / 'scripts/research/v16-two-stage-predictor.py'), run_name='consensus_v16_base')

norm_hist = BASE['norm_hist']
base_feature = BASE['base_feature']
augment_feature = BASE['augment_feature']
extended_flags = BASE['extended_flags']
extended_vector = BASE['extended_vector']
train = BASE['train']
calibrated_probability = BASE['calibrated_probability']
execution_reasons = BASE['execution_reasons']
effective_model_support = BASE['effective_model_support']
MODELS = BASE['MODELS']
clip = BASE['clip']
pct = BASE['pct']
round_value = BASE['round_value']
median = BASE['median']
corr = BASE['BASE']['corr']

HISTORY_DIR = ROOT / 'data/history'
OUT = ROOT / 'data/research/consensus-v16-qualified-walkforward.json'
MIN_UNIVERSE = 60
WARMUP_SESSIONS = 20
COST_PCT = 0.60
LARGE_LOSS_PCT = -2.0
TOP_LABEL_K = 10  # training label only; never used as an output cap


def safe_rate(rows, key):
    if not rows:
        return 0.0
    return sum(1 for row in rows if row[key]) / len(rows)


def historical_support(seen_rows, model_count=8):
    base_top = max(safe_rate(seen_rows, 'yTop10'), 1e-9)
    correlations = []
    for left in range(model_count):
        left_values = [row['flags'][left] for row in seen_rows]
        line = []
        for right in range(model_count):
            right_values = [row['flags'][right] for row in seen_rows]
            value = corr(left_values, right_values)
            line.append(value if value is not None else 0.0)
        correlations.append(line)
    lifts = []
    for index in range(model_count):
        signals = [row for row in seen_rows if row['flags'][index]]
        hits = sum(row['yTop10'] for row in signals)
        posterior = (hits + base_top * 25) / (len(signals) + 25)
        lifts.append(posterior / base_top)
    return correlations, lifts, base_top


def levels_for(feature):
    atr = max(float(feature['a14']), float(feature['close']) * 0.005)
    close = float(feature['close'])
    entry_low = close - 0.10 * atr
    entry_high = close + 0.10 * atr
    stop = close - 1.10 * atr
    target = close + 1.50 * atr
    rr = (target - entry_high) / max(1e-9, entry_high - stop)
    return {
        'entryLow': round_value(entry_low, 4),
        'entryHigh': round_value(entry_high, 4),
        'trigger': round_value(entry_high, 4),
        'stopLoss': round_value(stop, 4),
        'target1': round_value(target, 4),
        'riskReward': round_value(rr, 3),
    }


def main():
    histories = [norm_hist(path) for path in HISTORY_DIR.glob('*.json')]
    histories = [h for h in histories if h['ok'] and len(h['rows']) >= 60]

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

    rows_by_date = {}
    all_rows = []
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
        top = {row['ticker'] for row in session[:TOP_LABEL_K]}
        for row in session:
            row['yTop10'] = 1 if row['ticker'] in top else 0
            row['yNetPositive'] = 1 if row['nextReturn'] > COST_PCT else 0
            row['yLargeLoss'] = 1 if row['nextReturn'] <= LARGE_LOSS_PCT else 0
        rows_by_date[signal_date] = session
        all_rows.extend(session)

    signal_dates = dates[:-1]
    if len(signal_dates) <= WARMUP_SESSIONS:
        raise RuntimeError('Insufficient signal sessions for walk-forward V16 consensus adapter')

    warmup = [row for d in signal_dates[:WARMUP_SESSIONS] for row in rows_by_date[d]]
    n = len(warmup[0]['xNew'])
    top_weights = train([0.0] * n, warmup, 'yTop10', 'xNew', 30, 0.03)
    positive_weights = train([0.0] * n, warmup, 'yNetPositive', 'xNew', 30, 0.025)
    loss_weights = train([0.0] * n, warmup, 'yLargeLoss', 'xNew', 30, 0.025)
    seen_rows = list(warmup)
    model_names = [model[0] for model in MODELS] + ['VOLUME_SHOCK']

    sessions = []
    for signal_date in signal_dates[WARMUP_SESSIONS:]:
        session = rows_by_date[signal_date]
        correlations, lifts, base_top = historical_support(seen_rows, len(model_names))
        qualified = []
        excluded = 0
        for row in session:
            feature = row['feature']
            p_top = calibrated_probability(top_weights, row, seen_rows, 'yTop10', 'xNew')
            p_pos = calibrated_probability(positive_weights, row, seen_rows, 'yNetPositive', 'xNew')
            p_loss = calibrated_probability(loss_weights, row, seen_rows, 'yLargeLoss', 'xNew')
            support = effective_model_support(row['flags'], correlations, lifts)
            score = (
                p_top
                * (0.55 + p_pos)
                * (1.0 - p_loss)
                * (1.0 - 0.65 * feature['momentumFailureRisk'])
                * (1.0 + 0.08 * min(support, 3.0))
            )
            reasons = execution_reasons(feature)
            if reasons:
                excluded += 1
                continue
            lv = levels_for(feature)
            qualified.append({
                'ticker': row['ticker'],
                'companyNameAr': row['name'],
                'executionScore': round_value(score, 8),
                'predictionProbabilityTop10Pct': round_value(p_top * 100, 3),
                'predictionLiftVsHistoricalBase': round_value(p_top / max(base_top, 1e-9), 3),
                'netPositiveProbabilityPct': round_value(p_pos * 100, 3),
                'largeLossProbabilityPct': round_value(p_loss * 100, 3),
                'momentumFailureRiskPct': round_value(feature['momentumFailureRisk'] * 100, 2),
                'effectiveModelSupport': round_value(support, 4),
                'rsi14': round_value(feature['rsi'], 2),
                'ret5Pct': round_value(feature['ret5'], 3),
                'ret20Pct': round_value(feature['ret20'], 3),
                'relativeStrength20Pct': round_value(feature['rs20'], 3),
                'volumeRatio20': round_value(feature['vr'], 3),
                'averageTurnover20Egp': round_value(feature['turn'], 0),
                **lv,
            })
        qualified.sort(key=lambda x: x['executionScore'], reverse=True)
        for index, item in enumerate(qualified, 1):
            item['rank'] = index
        sessions.append({
            'signalDate': signal_date,
            'outcomeDate': session[0]['outcomeDate'] if session else None,
            'universeCount': len(session),
            'qualifiedCount': len(qualified),
            'excludedCount': excluded,
            'candidates': qualified,
        })

        # Strict walk-forward: current labels become training data only after scoring this session.
        top_weights = train(top_weights, session, 'yTop10', 'xNew', 10, 0.022)
        positive_weights = train(positive_weights, session, 'yNetPositive', 'xNew', 10, 0.020)
        loss_weights = train(loss_weights, session, 'yLargeLoss', 'xNew', 10, 0.020)
        seen_rows.extend(session)

    output = {
        'schemaVersion': 'consensus-v16-qualified-walkforward-v1',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'method': {
            'sourceEngine': 'V16 two-stage probabilistic MAIN APP family',
            'qualification': 'All rows with no V16 execution_reasons; there is no fixed output count.',
            'ranking': 'V16 executionScore descending.',
            'top10Meaning': 'TOP 10 is used only as the historical supervised-learning label; it is NOT an output cap.',
            'walkForward': True,
            'futureLeakageForbidden': True,
            'historicalSupportOnly': True,
        },
        'sessions': sessions,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'sessions': len(sessions),
        'from': sessions[0]['signalDate'] if sessions else None,
        'to': sessions[-1]['signalDate'] if sessions else None,
        'latestQualified': sessions[-1]['qualifiedCount'] if sessions else 0,
        'latestTop': [x['ticker'] for x in sessions[-1]['candidates'][:10]] if sessions else [],
        'note': 'latestTop is display-only; output itself is uncapped',
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
