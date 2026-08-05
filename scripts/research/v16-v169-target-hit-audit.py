#!/usr/bin/env python3
import json
import math
import os
import runpy
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
BASE = runpy.run_path(str(ROOT / 'scripts/research/v16-two-stage-predictor.py'), run_name='v169_target_audit_base')

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
OUT = ROOT / 'data/research/v16-v169-target-hit-audit.json'
MIN_UNIVERSE = 60
WARMUP = 20
COST_PCT = 0.60
BASKET_SIZES = [3, 4, 5]
BLOCK_SIZE = 5
LOOKBACK = 8
AUDIT_SESSIONS = 20


def safe_mean(values, default=0.0):
    clean = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    return statistics.fmean(clean) if clean else default


def aggregate_returns(values):
    gains = sum(max(0.0, value) for value in values)
    losses = abs(sum(min(0.0, value) for value in values))
    equity = peak = 1.0
    max_dd = 0.0
    for value in values:
        equity *= 1.0 + value / 100.0
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
    return {
        'sessions': len(values),
        'averageNetReturnPct': round_value(safe_mean(values), 4),
        'medianNetReturnPct': round_value(statistics.median(values) if values else 0.0, 4),
        'winningSessionPct': round_value(sum(value > 0 for value in values) / max(1, len(values)) * 100.0, 3),
        'profitFactor': round_value(gains / losses if losses > 0 else None, 3),
        'compoundedNetReturnPct': round_value((equity - 1.0) * 100.0, 3),
        'maximumDrawdownPct': round_value(max_dd, 3),
        'bestSessionPct': round_value(max(values) if values else 0.0, 3),
        'worstSessionPct': round_value(min(values) if values else 0.0, 3),
    }


def objective(metrics):
    return (
        (metrics['averageNetReturnPct'] or -5.0)
        + 0.15 * math.log(max(metrics['profitFactor'] or 0.1, 0.1))
        + 0.002 * (metrics['winningSessionPct'] or 0.0)
        + 0.01 * max(metrics['maximumDrawdownPct'] or -100.0, -20.0)
    )


def evaluate_member(row):
    feature = row['feature']
    close = feature['close']
    atr = feature['a14']
    entry_low = close - 0.08 * atr
    entry_high = close + 0.08 * atr
    stop = close - 0.90 * atr
    target = close + 1.20 * atr
    next_open = row['nextOpen']
    next_high = row['nextHigh']
    next_low = row['nextLow']

    executable = next_open <= entry_high and next_open >= stop
    target_touched = executable and next_high >= target
    stop_touched = executable and next_low <= stop
    ambiguous_same_day = target_touched and stop_touched
    conservative_target_hit = target_touched and not stop_touched

    return {
        'ticker': row['ticker'],
        'entryLow': round_value(entry_low, 4),
        'entryHigh': round_value(entry_high, 4),
        'stopLoss': round_value(stop, 4),
        'target1': round_value(target, 4),
        'nextOpen': round_value(next_open, 4),
        'nextHigh': round_value(next_high, 4),
        'nextLow': round_value(next_low, 4),
        'executableByOpenRule': executable,
        'targetTouched': target_touched,
        'stopTouched': stop_touched,
        'ambiguousSameDay': ambiguous_same_day,
        'conservativeTargetHit': conservative_target_hit,
        'nextCloseReturnPct': round_value(row['nextReturn'], 4),
    }


def main():
    histories = [norm_hist(path) for path in HISTORY_DIR.glob('*.json')]
    histories = [history for history in histories if history['ok'] and len(history['rows']) >= 60]

    raw_by_date = {}
    for history in histories:
        for raw in history['rows']:
            raw_by_date.setdefault(raw['date'], {})[history['ticker']] = raw

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

    rows_by_date = {}
    for date_index, signal_date in enumerate(dates[:-1]):
        outcome_date = dates[date_index + 1]
        outcomes = {feature['ticker']: feature for feature in by_date[outcome_date]}
        raw_outcomes = raw_by_date.get(outcome_date, {})
        session = []
        for feature in by_date[signal_date]:
            outcome = outcomes.get(feature['ticker'])
            outcome_raw = raw_outcomes.get(feature['ticker'])
            if not outcome or not outcome_raw:
                continue
            flags = extended_flags(feature)
            row = {
                'signalDate': signal_date,
                'outcomeDate': outcome_date,
                'ticker': feature['ticker'],
                'feature': feature,
                'flags': flags,
                'xNew': extended_vector(feature, flags),
                'nextReturn': pct(outcome['close'], feature['close']),
                'nextOpen': outcome_raw['open'],
                'nextHigh': outcome_raw['high'],
                'nextLow': outcome_raw['low'],
            }
            session.append(row)
        session.sort(key=lambda row: row['nextReturn'], reverse=True)
        top10 = {row['ticker'] for row in session[:10]}
        for row in session:
            row['yTop10'] = 1 if row['ticker'] in top10 else 0
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
            'ranked': ranked,
        }
        for size in BASKET_SIZES:
            selected = ranked[:size]
            gross = safe_mean([row['nextReturn'] for row in selected])
            result[f'basket{size}NetPct'] = round_value(gross - COST_PCT, 4)
        sessions.append(result)
        weights = train(weights, session, 'yTop10', 'xNew', 10, 0.022)
        seen_rows.extend(session)

    blocked = []
    for block_start in range(LOOKBACK, len(sessions), BLOCK_SIZE):
        validation = sessions[max(0, block_start - LOOKBACK):block_start]
        choices = []
        for size in BASKET_SIZES:
            metrics = aggregate_returns([session[f'basket{size}NetPct'] for session in validation])
            choices.append((objective(metrics), size, metrics))
        choices.sort(reverse=True, key=lambda item: item[0])
        chosen = choices[0][1]
        for session in sessions[block_start:block_start + BLOCK_SIZE]:
            members = [evaluate_member(row) for row in session['ranked'][:chosen]]
            blocked.append({
                'signalDate': session['signalDate'],
                'outcomeDate': session['outcomeDate'],
                'basketSize': chosen,
                'netReturnPct': session[f'basket{chosen}NetPct'],
                'members': members,
            })

    audited = blocked[-AUDIT_SESSIONS:]
    members = [member for session in audited for member in session['members']]
    executable = [member for member in members if member['executableByOpenRule']]
    target_touches = [member for member in executable if member['targetTouched']]
    conservative_hits = [member for member in executable if member['conservativeTargetHit']]
    ambiguous = [member for member in executable if member['ambiguousSameDay']]
    stop_touches = [member for member in executable if member['stopTouched']]

    sessions_with_target = sum(any(member['targetTouched'] for member in session['members']) for session in audited)
    sessions_with_conservative_target = sum(any(member['conservativeTargetHit'] for member in session['members']) for session in audited)
    positive_sessions = sum(session['netReturnPct'] > 0 for session in audited)

    report = {
        'schemaVersion': '16.9.1-target-hit-audit',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'method': 'Exact V16.9 walk-forward ranking and dynamic basket-size selection; target/stop audited from next-session raw daily OHLC.',
        'auditWindow': {
            'requestedSessions': AUDIT_SESSIONS,
            'completedSessions': len(audited),
            'fromSignalDate': audited[0]['signalDate'] if audited else None,
            'toSignalDate': audited[-1]['signalDate'] if audited else None,
            'lastOutcomeDate': audited[-1]['outcomeDate'] if audited else None,
        },
        'selectionCount': len(members),
        'executableByOpenRuleCount': len(executable),
        'notExecutableByOpenRuleCount': len(members) - len(executable),
        'targetTouchedCount': len(target_touches),
        'targetTouchRateOfExecutablePct': round_value(len(target_touches) / max(1, len(executable)) * 100.0, 2),
        'targetTouchRateOfAllSelectionsPct': round_value(len(target_touches) / max(1, len(members)) * 100.0, 2),
        'conservativeTargetHitCount': len(conservative_hits),
        'conservativeTargetHitRateOfExecutablePct': round_value(len(conservative_hits) / max(1, len(executable)) * 100.0, 2),
        'ambiguousTargetAndStopSameDayCount': len(ambiguous),
        'stopTouchedCount': len(stop_touches),
        'sessionsWithAtLeastOneTarget': sessions_with_target,
        'sessionsWithAtLeastOneTargetPct': round_value(sessions_with_target / max(1, len(audited)) * 100.0, 2),
        'sessionsWithAtLeastOneConservativeTarget': sessions_with_conservative_target,
        'sessionsWithAtLeastOneConservativeTargetPct': round_value(sessions_with_conservative_target / max(1, len(audited)) * 100.0, 2),
        'positiveBasketSessions': positive_sessions,
        'positiveBasketSessionPct': round_value(positive_sessions / max(1, len(audited)) * 100.0, 2),
        'basketReturnMetrics': aggregate_returns([session['netReturnPct'] for session in audited]),
        'limitationsAr': [
            'بيانات يومية لا تحدد ترتيب لمس الهدف والوقف داخل الجلسة؛ لذلك توجد نتيجة محافظة تستبعد الحالات المزدوجة.',
            'شرط سيولة أول 10–15 دقيقة لا يمكن اختباره بدقة من بيانات يومية، لذا التدقيق يطبق قاعدة الافتتاح فقط.',
            'النتائج تاريخية ولا تضمن تكرار الأداء مستقبلًا.',
        ],
        'sessions': audited,
    }
    wr(OUT, report)
    print(json.dumps({key: value for key, value in report.items() if key != 'sessions'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
