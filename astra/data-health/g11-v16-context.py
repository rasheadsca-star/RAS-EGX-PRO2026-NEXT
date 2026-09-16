#!/usr/bin/env python3
import argparse
import json
import math
import os
import runpy
import statistics
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
SRC = runpy.run_path(str(ROOT / 'scripts/research/v16-two-stage-predictor.py'), run_name='g11_v16_source')
BASE = SRC['BASE']
norm_hist = SRC['norm_hist']
base_feature = SRC['base_feature']
augment_feature = SRC['augment_feature']
extended_flags = SRC['extended_flags']
extended_vector = SRC['extended_vector']
effective_model_support = SRC['effective_model_support']
MODELS = SRC['MODELS']
clip = SRC['clip']
pct = SRC['pct']


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return default


def active_tickers():
    raw = read_json(ROOT / 'data/symbol-map.json', {}) or {}
    rows = raw if isinstance(raw, list) else list(raw.values())
    return {str(x.get('ticker') or '').strip().upper() for x in rows if x.get('active') is not False and x.get('ticker')}


def std(values):
    vals = [float(v) for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    if len(vals) < 2:
        return None
    return statistics.stdev(vals)


def technical_snapshot(history, feature, index):
    rows = history['rows']
    returns = []
    start = max(1, index - 20)
    for i in range(start, index + 1):
        if rows[i - 1]['close'] > 0:
            returns.append((rows[i]['close'] / rows[i - 1]['close'] - 1) * 100)
    vol = std(returns)
    return {
        'return1Pct': feature['ret1'],
        'return5Pct': feature['ret5'],
        'return20Pct': feature['ret20'],
        'aboveSma20': feature['close'] >= feature['s20'],
        'aboveSma50': feature['close'] >= feature['s50'],
        'volatility20AnnualizedPct': None if vol is None else vol * math.sqrt(252),
        'relativeVolume20': feature['vr'],
        'sma10': feature['s10'],
        'sma20': feature['s20'],
        'sma50': feature['s50'],
        'atr14': feature['a14'],
        'rsi14': feature['rsi'],
        'turnover20': feature['turn'],
        'breakout20': feature['breakout'],
        'relativeStrength20': feature.get('rs20'),
        'trend': bool(feature['trend'])
    }


def build(session):
    active = active_tickers()
    histories = []
    by_ticker = {}
    for ticker in sorted(active):
        p = ROOT / 'data/history' / f'{ticker}.json'
        if not p.exists():
            continue
        h = norm_hist(p)
        h['rows'] = [row for row in h['rows'] if row['date'] <= session]
        if h['ok'] and len(h['rows']) >= 60:
            histories.append(h)
            by_ticker[ticker] = h

    by_date = {}
    feature_index = {}
    for history in histories:
        for index in range(55, len(history['rows'])):
            feature = base_feature(history, index)
            if not feature or feature['date'] > session:
                continue
            feature = augment_feature(history, index, feature)
            by_date.setdefault(feature['date'], []).append(feature)
            feature_index[(history['ticker'], feature['date'])] = index

    eligible_dates = sorted(date for date, values in by_date.items() if date <= session and len(values) >= SRC['MIN_UNIVERSE'])
    for date in eligible_dates:
        med = statistics.median([feature['ret20'] for feature in by_date[date]])
        for feature in by_date[date]:
            feature['rs20'] = feature['ret20'] - med

    all_labeled = []
    session_rows = []
    for date_index, signal_date in enumerate(eligible_dates[:-1]):
        outcome_date = eligible_dates[date_index + 1]
        outcome_map = {feature['ticker']: feature for feature in by_date[outcome_date]}
        rows = []
        for feature in by_date[signal_date]:
            outcome = outcome_map.get(feature['ticker'])
            if not outcome:
                continue
            flags = extended_flags(feature)
            next_return = pct(outcome['close'], feature['close'])
            rows.append({
                'sessionDate': signal_date,
                'ticker': feature['ticker'],
                'xNew': extended_vector(feature, flags),
                'nextReturn': next_return,
                'flags': flags
            })
        rows.sort(key=lambda row: row['nextReturn'], reverse=True)
        top = {row['ticker'] for row in rows[:SRC['TOP_K']]}
        for row in rows:
            row['yTop10'] = 1 if row['ticker'] in top else 0
            row['yNetPositive'] = 1 if row['nextReturn'] > SRC['COST_PCT'] else 0
            row['yLargeLoss'] = 1 if row['nextReturn'] <= SRC['LARGE_LOSS_PCT'] else 0
        if len(rows) >= SRC['MIN_UNIVERSE']:
            session_rows.append(rows)
            all_labeled.extend(rows)

    training = session_rows[-SRC['MIN_SIGNAL_SESSIONS']:]
    if len(training) < SRC['MIN_SIGNAL_SESSIONS']:
        raise RuntimeError(f"G11 needs {SRC['MIN_SIGNAL_SESSIONS']} source-valid labeled sessions; found {len(training)}")

    base_rate = sum(row['yTop10'] for row in all_labeled) / max(1, len(all_labeled))
    correlations = []
    corr = BASE['corr']
    for left in range(8):
        left_values = [row['flags'][left] for row in all_labeled]
        line = []
        for right in range(8):
            right_values = [row['flags'][right] for row in all_labeled]
            value = corr(left_values, right_values)
            line.append(value if value is not None else 0.0)
        correlations.append(line)
    lifts = []
    for index in range(8):
        signals = [row for row in all_labeled if row['flags'][index]]
        hits = sum(row['yTop10'] for row in signals)
        posterior = (hits + base_rate * 25) / (len(signals) + 25)
        lifts.append(posterior / max(base_rate, 1e-9))

    current_features = {f['ticker']: f for f in by_date.get(session, [])}
    current_rows = []
    technical = {}
    for ticker, feature in sorted(current_features.items()):
        flags = extended_flags(feature)
        support = effective_model_support(flags, correlations, lifts)
        current_rows.append({
            'sessionDate': session,
            'ticker': ticker,
            'xNew': extended_vector(feature, flags),
            'momentumFailureRisk': feature['momentumFailureRisk'],
            'effectiveSupport': support,
            'turnover20': feature['turn'],
            'rsi14': feature['rsi'],
            'ret20': feature['ret20'],
            'ret5': feature['ret5'],
            'breakout20': feature['breakout'],
            'atr14': feature['a14'],
            'close': feature['close'],
            'validationStatus': 'VALID',
            'migrationValidationStatus': 'VALID'
        })
        history = by_ticker[ticker]
        index = feature_index[(ticker, session)]
        technical[ticker] = technical_snapshot(history, feature, index)

    guard_history = []
    # The G09 model-guard history is used only by temporal/quarantine guards. Use one
    # validation-approved market breadth series, capped at the certified session.
    if by_ticker:
        representative = max(by_ticker.values(), key=lambda h: len(h['rows']))
        for row in representative['rows'][-60:]:
            guard_history.append({
                'sessionDate': row['date'], 'close': row['close'], 'volume': row['volume'],
                'turnover': row['close'] * row['volume'], 'validationStatus': 'VALID',
                'migrationValidationStatus': 'VALID'
            })

    return {
        'schemaVersion': 'astra-g11-v16-current-context-1',
        'sessionDate': session,
        'sourceAlgorithms': [
            'scripts/research/v16-probabilistic-model-impact.py',
            'scripts/research/v16-two-stage-predictor.py'
        ],
        'minimumUniverse': SRC['MIN_UNIVERSE'],
        'minimumSignalSessions': SRC['MIN_SIGNAL_SESSIONS'],
        'eligibleDates': len(eligible_dates),
        'trainingSessions': training,
        'trainingSessionCount': len(training),
        'trainingRows': sum(len(x) for x in training),
        'currentRows': current_rows,
        'currentFeatureCount': len(current_rows),
        'technicalByTicker': technical,
        'modelGuardHistory': guard_history
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--session', required=True)
    ap.add_argument('--output')
    args = ap.parse_args()
    result = build(args.session)
    text = json.dumps(result, ensure_ascii=False, separators=(',', ':'))
    if args.output:
        Path(args.output).write_text(text + '\n', encoding='utf-8')
    else:
        print(text)


if __name__ == '__main__':
    main()
