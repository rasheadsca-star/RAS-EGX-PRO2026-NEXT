#!/usr/bin/env python3
import json
import math
import os
import runpy
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()

BASE = runpy.run_path(
    str(ROOT / 'scripts/research/v16-two-stage-predictor.py'),
    run_name='v169_eval_base',
)
norm_hist = BASE['norm_hist']
round_value = BASE['round_value']
pct = BASE['pct']

PRIMARY_DECISION_RELATIVE = 'data/stable/v16-v169-primary-decision.json'
PRIMARY_DECISION_PATH = ROOT / PRIMARY_DECISION_RELATIVE
REPORT_PATH = ROOT / 'data/research/v16-v169-basket-engine.json'
LOCK_PATH = ROOT / 'data/stable/v16-v169-release-lock.json'
LEDGER_PATH = ROOT / 'data/stable/v16-v169-live-evaluation.json'
HISTORY_DIR = ROOT / 'data/history'

SCHEMA_VERSION = '16.9.2-live-member-outcomes-backfill'
ENGINE_ID = 'V16_9_EQUAL_WEIGHT_BASKET'
DEFAULT_HOLDING_SESSIONS = 5


def read_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return fallback


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    json.loads(temp.read_text(encoding='utf-8'))
    temp.replace(path)


def finite(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def git_output(args):
    try:
        completed = subprocess.run(
            ['git', *args],
            cwd=ROOT,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return completed.stdout
    except Exception:
        return ''


def valid_primary_decision(decision):
    if not isinstance(decision, dict):
        return False

    recommendations = decision.get('recommendations')
    if not isinstance(recommendations, list) or not recommendations:
        return False

    selected_id = ((decision.get('selectedModel') or {}).get('id'))
    if selected_id and selected_id != ENGINE_ID:
        return False

    session_date = (
        decision.get('sessionDate')
        or decision.get('expectedLatestSession')
    )
    return bool(session_date)


def build_session_from_decision(decision, source_commit=None):
    if not valid_primary_decision(decision):
        return None

    signal_date = (
        decision.get('sessionDate')
        or decision.get('expectedLatestSession')
    )
    basket = decision.get('recommendations') or []
    plan = decision.get('basketPlan') or {}

    default_holding = int(
        finite(plan.get('holdingSessions'))
        or DEFAULT_HOLDING_SESSIONS
    )

    return {
        'signalDate': signal_date,
        'publishedAt': decision.get('generatedAt'),
        'sourceDecisionPath': PRIMARY_DECISION_RELATIVE,
        'sourceCommit': source_commit,
        'sourceKind': (
            'GIT_HISTORY_BACKFILL'
            if source_commit
            else 'CURRENT_WORKTREE'
        ),
        'status': 'PENDING_OUTCOME',
        'basketSize': len(basket),
        'members': [
            {
                'ticker': item.get('ticker'),
                'nameAr': item.get('companyNameAr'),
                'rank': item.get('rank'),
                'referenceClose': (
                    item.get('close')
                    if item.get('close') is not None
                    else item.get('recommendationClose')
                ),
                'entryLow': item.get('entryLow'),
                'entryHigh': item.get('entryHigh'),
                'stopLoss': item.get('stopLoss'),
                'target1': item.get('target1'),
                'weightPct': (
                    item.get('portfolioWeightPct')
                    if item.get('portfolioWeightPct') is not None
                    else item.get('weightPct')
                ),
                'holdingSessions': (
                    item.get('holdingSessions')
                    if item.get('holdingSessions') is not None
                    else default_holding
                ),
                'memberStatus': 'WAITING',
                'statusAr': 'ما زالت داخل الانتظار',
            }
            for item in basket
        ],
    }


def historical_primary_sessions():
    """
    Rebuild the immutable history of MAIN V16.9 recommendations from Git.

    The workflow uses actions/checkout with fetch-depth: 0, so every historical
    version of v16-v169-primary-decision.json is available here.

    We iterate oldest -> newest and keep the FIRST valid publication for each
    signalDate. That matches an immutable issued-signal rule: once a session's
    primary basket was first published, later re-runs for the same signal date
    must not rewrite what was originally issued.
    """
    commits_text = git_output([
        'log',
        '--reverse',
        '--format=%H',
        '--',
        PRIMARY_DECISION_RELATIVE,
    ])
    commits = [line.strip() for line in commits_text.splitlines() if line.strip()]

    sessions = []
    seen_dates = set()

    for commit in commits:
        raw = git_output([
            'show',
            f'{commit}:{PRIMARY_DECISION_RELATIVE}',
        ])
        if not raw:
            continue

        try:
            decision = json.loads(raw)
        except Exception:
            continue

        session = build_session_from_decision(
            decision,
            source_commit=commit,
        )
        if not session:
            continue

        signal_date = session.get('signalDate')
        if signal_date in seen_dates:
            continue

        seen_dates.add(signal_date)
        sessions.append(session)

    return sessions, len(commits)


def build_history_map():
    result = {}

    for path in HISTORY_DIR.glob('*.json'):
        history = norm_hist(path)
        if not history.get('ok'):
            continue

        ticker = history.get('ticker')
        if not ticker:
            continue

        rows = []
        for row in history.get('rows', []):
            date = row.get('date')
            open_price = finite(row.get('open'))
            high = finite(row.get('high'))
            low = finite(row.get('low'))
            close = finite(row.get('close'))

            if not date or close is None:
                continue

            rows.append({
                'date': str(date),
                'open': open_price,
                'high': high,
                'low': low,
                'close': close,
            })

        rows.sort(key=lambda item: item['date'])
        if rows:
            result[str(ticker).upper()] = rows

    return result


def rows_after_signal(history_map, ticker, signal_date):
    return [
        row
        for row in history_map.get(str(ticker).upper(), [])
        if row.get('date', '') > signal_date
    ]


def conservative_member_evaluation(
    member,
    signal_date,
    history_map,
    cost_pct,
):
    """
    Evaluate ONE published main recommendation.

    Policy:
    - Entry is valid only on the first market session after signalDate.
    - Open inside entry zone -> entry at open.
    - Intraday touch -> entry at entryHigh conservatively.
    - If intraday touch triggers entry, target/stop checks start next session.
    - high >= target1 => TARGET_HIT.
    - low <= stopLoss => STOP_HIT.
    - If target and stop are both touched in the same daily bar, STOP_HIT wins.
    - Anything not resolved as target/stop remains WAITING for the UI and is
      excluded from the success-rate denominator.
    """
    ticker = str(member.get('ticker') or '').upper()
    entry_low = finite(member.get('entryLow'))
    entry_high = finite(member.get('entryHigh'))
    stop_loss = finite(member.get('stopLoss'))
    target1 = finite(member.get('target1'))
    holding_sessions = int(
        finite(member.get('holdingSessions'))
        or DEFAULT_HOLDING_SESSIONS
    )

    base = {
        'ticker': ticker,
        'nameAr': member.get('nameAr'),
        'rank': member.get('rank'),
        'referenceClose': finite(member.get('referenceClose')),
        'entryLow': entry_low,
        'entryHigh': entry_high,
        'stopLoss': stop_loss,
        'target1': target1,
        'weightPct': finite(member.get('weightPct')),
        'holdingSessions': holding_sessions,
        'memberStatus': 'WAITING',
        'statusAr': 'ما زالت داخل الانتظار',
        'entryDate': None,
        'entryPrice': None,
        'entryMode': None,
        'outcomeDate': None,
        'exitPrice': None,
        'grossReturnPct': None,
        'netReturnPct': None,
        'lastObservedClose': None,
        'sessionsObserved': 0,
        'evaluationWindowDates': [],
        'reasonCode': 'WAITING_FOR_MARKET_DATA',
    }

    if (
        not ticker
        or entry_low is None
        or entry_high is None
        or stop_loss is None
        or target1 is None
        or entry_low <= 0
        or entry_high < entry_low
        or stop_loss <= 0
        or target1 <= 0
    ):
        base['statusAr'] = 'انتظار — بيانات التوصية غير مكتملة'
        base['reasonCode'] = 'INCOMPLETE_RECOMMENDATION_DATA'
        return base

    rows = rows_after_signal(history_map, ticker, signal_date)
    if not rows:
        base['statusAr'] = 'ما زالت داخل الانتظار — لا توجد جلسة لاحقة مكتملة'
        base['reasonCode'] = 'NO_FUTURE_SESSION'
        return base

    first = rows[0]
    first_open = finite(first.get('open'))
    first_high = finite(first.get('high'))
    first_low = finite(first.get('low'))

    if first_open is None or first_high is None or first_low is None:
        base['statusAr'] = 'ما زالت داخل الانتظار — بيانات OHLC غير مكتملة'
        base['reasonCode'] = 'INCOMPLETE_ENTRY_SESSION_OHLC'
        return base

    entry_price = None
    entry_date = None
    entry_mode = None
    outcome_scan_start_index = 0

    if first_open < stop_loss:
        base['statusAr'] = 'انتظار — لم تتفعل التوصية بسبب افتتاح أسفل الوقف'
        base['reasonCode'] = 'NOT_ENTERED_GAP_BELOW_STOP'
        base['evaluationWindowDates'] = [first['date']]
        base['sessionsObserved'] = 1
        base['lastObservedClose'] = first.get('close')
        return base

    if entry_low <= first_open <= entry_high:
        entry_price = first_open
        entry_date = first['date']
        entry_mode = 'OPEN_IN_ZONE'
        outcome_scan_start_index = 0

    elif first_low <= entry_high and first_high >= entry_low:
        entry_price = entry_high
        entry_date = first['date']
        entry_mode = 'INTRADAY_ZONE_TOUCH_CONSERVATIVE'
        outcome_scan_start_index = 1

    else:
        base['statusAr'] = 'ما زالت داخل الانتظار — لم تتفعل منطقة الدخول'
        base['reasonCode'] = (
            'NOT_ENTERED_GAP_ABOVE_ZONE'
            if first_open > entry_high
            else 'NOT_ENTERED_FIRST_SESSION'
        )
        base['evaluationWindowDates'] = [first['date']]
        base['sessionsObserved'] = 1
        base['lastObservedClose'] = first.get('close')
        return base

    base['entryDate'] = entry_date
    base['entryPrice'] = round_value(entry_price, 6)
    base['entryMode'] = entry_mode
    base['reasonCode'] = 'ENTERED_WAITING_OUTCOME'

    # Holding window begins when target/stop evaluation is allowed to start.
    outcome_rows = rows[
        outcome_scan_start_index:
        outcome_scan_start_index + max(1, holding_sessions)
    ]

    observed_rows = rows[
        :outcome_scan_start_index + len(outcome_rows)
    ]

    base['evaluationWindowDates'] = [
        row['date'] for row in observed_rows
    ]
    base['sessionsObserved'] = len(observed_rows)

    for row in outcome_rows:
        high = finite(row.get('high'))
        low = finite(row.get('low'))
        close = finite(row.get('close'))

        if close is not None:
            base['lastObservedClose'] = close

        if high is None or low is None:
            continue

        target_hit = high >= target1
        stop_hit = low <= stop_loss

        if stop_hit:
            gross = pct(stop_loss, entry_price)
            base.update({
                'memberStatus': 'STOP_HIT',
                'statusAr': 'تم ضرب وقف الخسارة',
                'outcomeDate': row['date'],
                'exitPrice': round_value(stop_loss, 6),
                'grossReturnPct': round_value(gross, 4),
                'netReturnPct': round_value(gross - cost_pct, 4),
                'reasonCode': (
                    'TARGET_AND_STOP_SAME_BAR_CONSERVATIVE_STOP'
                    if target_hit
                    else 'STOP_HIT'
                ),
            })
            return base

        if target_hit:
            gross = pct(target1, entry_price)
            base.update({
                'memberStatus': 'TARGET_HIT',
                'statusAr': 'تم تحقيق الهدف',
                'outcomeDate': row['date'],
                'exitPrice': round_value(target1, 6),
                'grossReturnPct': round_value(gross, 4),
                'netReturnPct': round_value(gross - cost_pct, 4),
                'reasonCode': 'TARGET_HIT',
            })
            return base

    if observed_rows:
        last_close = finite(observed_rows[-1].get('close'))
        base['lastObservedClose'] = last_close

        if last_close is not None and entry_price > 0:
            gross = pct(last_close, entry_price)
            base['grossReturnPct'] = round_value(gross, 4)
            base['netReturnPct'] = round_value(gross - cost_pct, 4)

    base['memberStatus'] = 'WAITING'
    base['statusAr'] = 'ما زالت داخل الانتظار'
    base['reasonCode'] = (
        'HOLDING_WINDOW_COMPLETE_UNRESOLVED'
        if len(outcome_rows) >= holding_sessions
        else 'WAITING_FOR_MORE_SESSIONS'
    )
    return base


def aggregate_member_summary(sessions):
    members = [
        member
        for session in sessions
        for member in session.get('members', [])
    ]

    target_hits = sum(
        m.get('memberStatus') == 'TARGET_HIT'
        for m in members
    )
    stop_hits = sum(
        m.get('memberStatus') == 'STOP_HIT'
        for m in members
    )
    waiting = sum(
        m.get('memberStatus') == 'WAITING'
        for m in members
    )
    resolved = target_hits + stop_hits

    return {
        'totalRecommendations': len(members),
        'targetHits': target_hits,
        'stopHits': stop_hits,
        'waiting': waiting,
        'resolvedRecommendations': resolved,
        'successRatePct': round_value(
            target_hits / resolved * 100.0 if resolved else None,
            2,
        ),
    }


def aggregate_resolved_sessions(resolved_sessions):
    returns = [
        finite(session.get('netReturnPct'))
        for session in resolved_sessions
    ]
    returns = [
        value for value in returns
        if value is not None
    ]

    gains = sum(max(0.0, value) for value in returns)
    losses = abs(sum(min(0.0, value) for value in returns))

    equity = peak = 1.0
    max_dd = 0.0

    for value in returns:
        equity *= 1.0 + value / 100.0
        peak = max(peak, equity)
        max_dd = min(
            max_dd,
            (equity / peak - 1.0) * 100.0,
        )

    return {
        'resolvedSessions': len(returns),
        'winningSessions': sum(v > 0 for v in returns),
        'losingSessions': sum(v < 0 for v in returns),
        'flatSessions': sum(v == 0 for v in returns),
        'winningSessionPct': round_value(
            sum(v > 0 for v in returns)
            / max(1, len(returns))
            * 100.0,
            3,
        ),
        'averageNetReturnPct': round_value(
            sum(returns) / max(1, len(returns)),
            4,
        ),
        'profitFactor': round_value(
            gains / losses if losses > 0 else None,
            3,
        ),
        'compoundedNetReturnPct': round_value(
            (equity - 1.0) * 100.0,
            3,
        ),
        'maximumDrawdownPct': round_value(max_dd, 3),
        'bestSessionPct': round_value(
            max(returns) if returns else None,
            3,
        ),
        'worstSessionPct': round_value(
            min(returns) if returns else None,
            3,
        ),
    }


def main():
    current_decision = read_json(PRIMARY_DECISION_PATH, {})
    lock = read_json(LOCK_PATH, {})

    ledger = read_json(LEDGER_PATH, {
        'schemaVersion': SCHEMA_VERSION,
        'engine': ENGINE_ID,
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'sessions': [],
    })

    ledger['schemaVersion'] = SCHEMA_VERSION
    ledger['engine'] = ENGINE_ID

    sessions = ledger.setdefault('sessions', [])
    known_dates = {
        session.get('signalDate')
        for session in sessions
        if session.get('signalDate')
    }

    # 1) FULL RETROACTIVE BACKFILL FROM GIT HISTORY.
    historical_sessions, commits_scanned = historical_primary_sessions()
    backfilled_dates = []

    for historical_session in historical_sessions:
        signal_date = historical_session.get('signalDate')
        if not signal_date or signal_date in known_dates:
            continue

        historical_session['estimatedRoundTripCostPct'] = (
            lock.get('pilotRules', {})
            .get('estimatedRoundTripCostPct', 0.60)
        )
        sessions.append(historical_session)
        known_dates.add(signal_date)
        backfilled_dates.append(signal_date)

    # 2) INCLUDE TODAY'S CURRENT WORKTREE DECISION.
    # The workflow publishes the new primary decision before this evaluator
    # runs, but commits it afterwards. Therefore the newest signal may not yet
    # exist in git log and must be added directly from the working tree.
    current_session = build_session_from_decision(current_decision)
    if current_session:
        signal_date = current_session.get('signalDate')
        if signal_date and signal_date not in known_dates:
            current_session['estimatedRoundTripCostPct'] = (
                lock.get('pilotRules', {})
                .get('estimatedRoundTripCostPct', 0.60)
            )
            sessions.append(current_session)
            known_dates.add(signal_date)

    history_map = build_history_map()

    # Re-evaluate all historical and current sessions from canonical OHLC.
    for session in sessions:
        signal = str(session.get('signalDate') or '')
        cost = finite(session.get('estimatedRoundTripCostPct'))
        if cost is None:
            cost = 0.60

        evaluated_members = [
            conservative_member_evaluation(
                member,
                signal,
                history_map,
                cost,
            )
            for member in session.get('members', [])
        ]

        session['members'] = evaluated_members
        session['basketSize'] = len(evaluated_members)

        target_hits = sum(
            member.get('memberStatus') == 'TARGET_HIT'
            for member in evaluated_members
        )
        stop_hits = sum(
            member.get('memberStatus') == 'STOP_HIT'
            for member in evaluated_members
        )
        waiting = sum(
            member.get('memberStatus') == 'WAITING'
            for member in evaluated_members
        )

        session['memberSummary'] = {
            'total': len(evaluated_members),
            'targetHits': target_hits,
            'stopHits': stop_hits,
            'waiting': waiting,
        }

        if evaluated_members and waiting == 0:
            resolved_returns = [
                finite(member.get('netReturnPct'))
                for member in evaluated_members
            ]
            resolved_returns = [
                value for value in resolved_returns
                if value is not None
            ]

            session['status'] = 'RESOLVED'
            if not session.get('resolvedAt'):
                session['resolvedAt'] = (
                    datetime.now(timezone.utc).isoformat()
                )

            if resolved_returns:
                session_net = (
                    sum(resolved_returns)
                    / len(resolved_returns)
                )
                session['netReturnPct'] = round_value(
                    session_net,
                    4,
                )
                session['result'] = (
                    'WIN'
                    if session_net > 0
                    else 'LOSS'
                    if session_net < 0
                    else 'FLAT'
                )
        else:
            session['status'] = 'PENDING_OUTCOME'
            session.pop('resolvedAt', None)
            session.pop('result', None)
            session.pop('netReturnPct', None)

    sessions.sort(
        key=lambda item: item.get('signalDate', '')
    )

    resolved_sessions = [
        session
        for session in sessions
        if session.get('status') == 'RESOLVED'
    ]

    session_metrics = aggregate_resolved_sessions(
        resolved_sessions
    )
    member_summary = aggregate_member_summary(sessions)

    gate = lock.get('promotionGate', {})
    checks = {
        'minimumResolvedSessions': (
            session_metrics['resolvedSessions']
            >= gate.get('minimumResolvedSessions', 20)
        ),
        'positiveAverageNetReturn': (
            session_metrics['averageNetReturnPct'] or 0
        ) > 0,
        'minimumProfitFactor': (
            session_metrics['profitFactor'] or 0
        ) >= gate.get('minimumProfitFactor', 1.20),
        'minimumWinningSessionPct': (
            session_metrics['winningSessionPct']
            >= gate.get('minimumWinningSessionPct', 45)
        ),
        'maximumDrawdown': (
            session_metrics['maximumDrawdownPct']
            >= gate.get('maximumDrawdownFloorPct', -15)
        ),
    }

    ledger.update({
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'releaseLock': lock,
        'summary': session_metrics,
        'memberSummary': member_summary,
        'backfill': {
            'source': 'GIT_HISTORY',
            'decisionPath': PRIMARY_DECISION_RELATIVE,
            'commitsScanned': commits_scanned,
            'historicalSessionsFound': len(historical_sessions),
            'sessionsAddedThisRun': len(backfilled_dates),
            'datesAddedThisRun': backfilled_dates,
            'rule': 'FIRST_VALID_PUBLICATION_PER_SIGNAL_DATE',
        },
        'promotionChecks': checks,
        'promotionEligible': all(checks.values()),
        'nextCheckpoint': next(
            (
                n
                for n in lock.get(
                    'reviewCheckpoints',
                    [5, 10, 20, 30],
                )
                if n > session_metrics['resolvedSessions']
            ),
            None,
        ),
        'evaluationPolicy': {
            'version': SCHEMA_VERSION,
            'source': 'PRIMARY_V16_9_PUBLISHED_BASKET',
            'sourceDecisionPath': PRIMARY_DECISION_RELATIVE,
            'historySource': 'FULL_GIT_HISTORY',
            'historicalVersionRule': (
                'FIRST_VALID_PUBLICATION_PER_SIGNAL_DATE'
            ),
            'entryRule': 'FIRST_FOLLOWING_SESSION_ONLY',
            'intradayEntryPrice': 'ENTRY_HIGH_CONSERVATIVE',
            'sameBarTargetStopRule': (
                'STOP_WINS_CONSERVATIVELY'
            ),
            'targetRule': 'DAILY_HIGH_GTE_TARGET1',
            'stopRule': 'DAILY_LOW_LTE_STOPLOSS',
            'unresolvedState': 'WAITING',
        },
        'notesAr': [
            'يتم تتبع التوصيات الرئيسية المنشورة في V16.9 فقط.',
            'تمت استعادة الجلسات السابقة من Git History بأثر رجعي.',
            'لكل جلسة يُثبت أول إصدار صالح من السلة الرئيسية ولا يُعاد كتابته لاحقًا.',
            'لا تدخل نتائج Scanner أو Watchlist أو المحركات الثانوية في هذا السجل.',
            'تحقيق الهدف يعتمد على High، وضرب الوقف يعتمد على Low من بيانات OHLC.',
            'إذا لمس الهدف والوقف في الجلسة نفسها تُسجل وقف خسارة تحفظيًا.',
            'التوصية غير المحسومة تبقى ضمن الانتظار ولا تُحتسب نجاحًا أو خسارة.',
            'لا يتم تغيير مستويات الدخول أو الهدف أو الوقف الأصلية بعد نشر التوصية.',
        ],
    })

    write_json(LEDGER_PATH, ledger)

    print(json.dumps({
        'sessions': len(sessions),
        'resolvedSessions': session_metrics['resolvedSessions'],
        'memberSummary': member_summary,
        'backfill': ledger['backfill'],
        'promotionEligible': ledger['promotionEligible'],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
