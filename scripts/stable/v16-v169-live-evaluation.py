#!/usr/bin/env python3
import json
import math
import os
import runpy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
BASE = runpy.run_path(str(ROOT / 'scripts/research/v16-two-stage-predictor.py'), run_name='v169_eval_base')
norm_hist = BASE['norm_hist']
round_value = BASE['round_value']
pct = BASE['pct']

REPORT_PATH = ROOT / 'data/research/v16-v169-basket-engine.json'
LOCK_PATH = ROOT / 'data/stable/v16-v169-release-lock.json'
LEDGER_PATH = ROOT / 'data/stable/v16-v169-live-evaluation.json'
HISTORY_DIR = ROOT / 'data/history'


def read_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return fallback


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    json.loads(temp.read_text(encoding='utf-8'))
    temp.replace(path)


def build_close_map():
    close_map = {}
    for path in HISTORY_DIR.glob('*.json'):
        history = norm_hist(path)
        if not history.get('ok'):
            continue
        ticker = history.get('ticker')
        for row in history.get('rows', []):
            date = row.get('date')
            close = row.get('close')
            if ticker and date and isinstance(close, (int, float)) and math.isfinite(close):
                close_map.setdefault(date, {})[ticker] = close
    return close_map


def next_market_date(dates, signal_date):
    for date in dates:
        if date > signal_date:
            return date
    return None


def aggregate(resolved_sessions):
    returns = [s['netReturnPct'] for s in resolved_sessions]
    gains = sum(max(0.0, value) for value in returns)
    losses = abs(sum(min(0.0, value) for value in returns))
    equity = peak = 1.0
    max_dd = 0.0
    for value in returns:
        equity *= 1.0 + value / 100.0
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
    return {
        'resolvedSessions': len(returns),
        'winningSessions': sum(v > 0 for v in returns),
        'losingSessions': sum(v < 0 for v in returns),
        'flatSessions': sum(v == 0 for v in returns),
        'winningSessionPct': round_value(sum(v > 0 for v in returns) / max(1, len(returns)) * 100.0, 3),
        'averageNetReturnPct': round_value(sum(returns) / max(1, len(returns)), 4),
        'profitFactor': round_value(gains / losses if losses > 0 else None, 3),
        'compoundedNetReturnPct': round_value((equity - 1.0) * 100.0, 3),
        'maximumDrawdownPct': round_value(max_dd, 3),
        'bestSessionPct': round_value(max(returns) if returns else None, 3),
        'worstSessionPct': round_value(min(returns) if returns else None, 3),
    }


def main():
    report = read_json(REPORT_PATH, {})
    lock = read_json(LOCK_PATH, {})
    ledger = read_json(LEDGER_PATH, {
        'schemaVersion': '16.9.0-live-evaluation',
        'engine': 'V16_9_EQUAL_WEIGHT_BASKET',
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'sessions': [],
    })

    sessions = ledger.setdefault('sessions', [])
    known = {s.get('signalDate') for s in sessions}
    signal_date = report.get('currentSignalDate')
    basket = report.get('currentBasket') or []
    if report.get('productionEligible') is True and signal_date and basket and signal_date not in known:
        sessions.append({
            'signalDate': signal_date,
            'publishedAt': report.get('generatedAt'),
            'status': 'PENDING_OUTCOME',
            'basketSize': len(basket),
            'estimatedRoundTripCostPct': lock.get('pilotRules', {}).get('estimatedRoundTripCostPct', 0.60),
            'members': [
                {
                    'ticker': item.get('ticker'),
                    'nameAr': item.get('companyNameAr'),
                    'referenceClose': item.get('close'),
                    'entryLow': item.get('entryLow'),
                    'entryHigh': item.get('entryHigh'),
                    'stopLoss': item.get('stopLoss'),
                    'target1': item.get('target1'),
                    'weightPct': item.get('weightPct'),
                }
                for item in basket
            ],
        })

    close_map = build_close_map()
    dates = sorted(close_map)
    for session in sessions:
        if session.get('status') == 'RESOLVED':
            continue
        outcome_date = next_market_date(dates, session.get('signalDate', ''))
        if not outcome_date:
            continue
        member_returns = []
        for member in session.get('members', []):
            ticker = member.get('ticker')
            start = member.get('referenceClose')
            end = close_map.get(outcome_date, {}).get(ticker)
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or start <= 0:
                continue
            gross = pct(end, start)
            member_returns.append({
                'ticker': ticker,
                'referenceClose': start,
                'outcomeClose': end,
                'grossReturnPct': round_value(gross, 4),
            })
        if len(member_returns) != session.get('basketSize'):
            continue
        gross_basket = sum(item['grossReturnPct'] for item in member_returns) / len(member_returns)
        cost = session.get('estimatedRoundTripCostPct', 0.60)
        session.update({
            'status': 'RESOLVED',
            'outcomeDate': outcome_date,
            'memberReturns': member_returns,
            'grossReturnPct': round_value(gross_basket, 4),
            'netReturnPct': round_value(gross_basket - cost, 4),
            'result': 'WIN' if gross_basket - cost > 0 else 'LOSS' if gross_basket - cost < 0 else 'FLAT',
            'resolvedAt': datetime.now(timezone.utc).isoformat(),
        })

    sessions.sort(key=lambda item: item.get('signalDate', ''))
    resolved = [s for s in sessions if s.get('status') == 'RESOLVED']
    metrics = aggregate(resolved)
    gate = lock.get('promotionGate', {})
    checks = {
        'minimumResolvedSessions': metrics['resolvedSessions'] >= gate.get('minimumResolvedSessions', 20),
        'positiveAverageNetReturn': (metrics['averageNetReturnPct'] or 0) > 0,
        'minimumProfitFactor': (metrics['profitFactor'] or 0) >= gate.get('minimumProfitFactor', 1.20),
        'minimumWinningSessionPct': metrics['winningSessionPct'] >= gate.get('minimumWinningSessionPct', 45),
        'maximumDrawdown': metrics['maximumDrawdownPct'] >= gate.get('maximumDrawdownFloorPct', -15),
    }
    ledger.update({
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'releaseLock': lock,
        'summary': metrics,
        'promotionChecks': checks,
        'promotionEligible': all(checks.values()),
        'nextCheckpoint': next((n for n in lock.get('reviewCheckpoints', [5, 10, 20, 30]) if n > metrics['resolvedSessions']), None),
        'notesAr': [
            'لا يتم تعديل أي جلسة بعد تسجيلها.',
            'العائد الصافي يخص متوسط السلة بعد خصم التكلفة الافتراضية المحددة.',
            'التقييم الحي منفصل عن الاختبار التاريخي ولا يثبت الأداء قبل اكتمال الحد الأدنى للجلسات.',
        ],
    })
    write_json(LEDGER_PATH, ledger)
    print(json.dumps({
        'sessions': len(sessions),
        'resolved': metrics['resolvedSessions'],
        'summary': metrics,
        'promotionEligible': ledger['promotionEligible'],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
