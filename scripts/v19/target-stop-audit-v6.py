#!/usr/bin/env python3
import json
import os
import runpy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
V4 = runpy.run_path(str(ROOT / 'scripts/v19/native-challenger-v4.py'), run_name='v19_v6_target_audit_v4')
V2 = runpy.run_path(str(ROOT / 'scripts/v19/native-challenger-v2.py'), run_name='v19_v6_target_audit_v2')

SOURCE = ROOT / 'data/v19/native-challenger-v6.json'
OUT = ROOT / 'data/v19/target-stop-audit-v6.json'
ENGINE = 'V19_CHAT_GPT_NATIVE_CHALLENGER_V6'
execution_plan = V2['execution_plan']
rv = V4['rv']


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(path) + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    json.loads(tmp.read_text(encoding='utf-8'))
    tmp.replace(path)


def pct(count, total):
    return rv(count / max(1, total) * 100.0, 2)


def evaluate_member(row, outcome):
    plan = execution_plan(row['feature'])
    next_open = float(outcome['open'])
    next_high = float(outcome['high'])
    next_low = float(outcome['low'])
    next_close = float(outcome['close'])
    stop = float(plan['stop'])
    target = float(plan['target'])
    entry_high = float(plan['entryHigh'])

    # Same conservative daily-OHLC contract used by the V16.9 target audit:
    # execute only when the next open is not above entryHigh and not below stop.
    executable = next_open <= entry_high and next_open >= stop
    target_touched = executable and next_high >= target
    stop_touched = executable and next_low <= stop
    ambiguous = target_touched and stop_touched
    conservative_target = target_touched and not stop_touched

    signal_close = float(row['feature']['close'])
    return {
        'ticker': row['ticker'],
        'entryLow': plan['entryLow'],
        'entryHigh': plan['entryHigh'],
        'stopLoss': plan['stop'],
        'target1': plan['target'],
        'riskReward': plan['riskReward'],
        'executionQualityEligible': plan['executionEligible'] is True,
        'nextOpen': rv(next_open, 4),
        'nextHigh': rv(next_high, 4),
        'nextLow': rv(next_low, 4),
        'nextClose': rv(next_close, 4),
        'executableByOpenRule': executable,
        'targetTouched': target_touched,
        'stopTouched': stop_touched,
        'ambiguousSameDay': ambiguous,
        'conservativeTargetHit': conservative_target,
        'nextCloseReturnPct': rv((next_close / signal_close - 1.0) * 100.0, 4) if signal_close else None,
    }


def main():
    source = read_json(SOURCE)
    if source.get('engineId') != ENGINE:
        raise RuntimeError(f"Unexpected V19 source engine: {source.get('engineId')}")

    holdout = source.get('holdoutBenchmark', {}).get('results', [])
    if not holdout:
        raise RuntimeError('V19 V6 holdout results are missing')

    histories, by_date, dates, rows_by_date = V4['build_rows']()
    audited_sessions = []
    missing = []

    for session_result in holdout:
        signal_date = session_result.get('signalDate')
        outcome_date = session_result.get('outcomeDate')
        selected = list(session_result.get('tickers') or [])
        signal_rows = {r['ticker']: r for r in rows_by_date.get(signal_date, [])}
        outcome_rows = {r['ticker']: r for r in by_date.get(outcome_date, [])}
        members = []
        for ticker in selected:
            row = signal_rows.get(ticker)
            outcome = outcome_rows.get(ticker)
            if not row or not outcome:
                missing.append({'signalDate': signal_date, 'outcomeDate': outcome_date, 'ticker': ticker})
                continue
            members.append(evaluate_member(row, outcome))
        audited_sessions.append({
            'signalDate': signal_date,
            'outcomeDate': outcome_date,
            'tickers': selected,
            'netReturnPct': session_result.get('netReturnPct'),
            'rawNetReturnPct': session_result.get('rawNetReturnPct'),
            'exposurePct': session_result.get('exposurePct'),
            'members': members,
        })

    members = [m for s in audited_sessions for m in s['members']]
    executable = [m for m in members if m['executableByOpenRule']]
    no_entry = [m for m in members if not m['executableByOpenRule']]
    target = [m for m in executable if m['targetTouched']]
    conservative = [m for m in executable if m['conservativeTargetHit']]
    stops = [m for m in executable if m['stopTouched']]
    ambiguous = [m for m in executable if m['ambiguousSameDay']]
    quality = [m for m in members if m['executionQualityEligible']]

    if missing:
        raise RuntimeError(f'V19 target/stop audit missing {len(missing)} selected outcomes: {missing[:5]}')

    report = {
        'schemaVersion': '19.5.0-target-stop-audit-v1',
        'engineId': ENGINE,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'sourceGeneratedAt': source.get('generatedAt'),
        'evidenceClass': 'REUSED_V19_V6_HOLDOUT_DIAGNOSTIC',
        'changesRanking': False,
        'changesExecutionPermission': False,
        'method': 'Frozen V19 V6 holdout selections evaluated with the native V19 execution plan and the same conservative next-session daily-OHLC open rule used by the V16.9 target audit.',
        'policy': {
            'horizonSessions': 1,
            'entryRule': 'nextOpen <= entryHigh AND nextOpen >= stopLoss',
            'sameSessionTargetStopAmbiguity': 'CONSERVATIVE_STOP',
            'conservativeTargetDefinition': 'target touched AND stop not touched in the same daily bar',
            'executionQualityGateReportedSeparately': True,
            'dailyOhlcCannotDetermineIntradayTouchOrder': True,
        },
        'auditWindow': {
            'sessions': len(audited_sessions),
            'fromSignalDate': audited_sessions[0]['signalDate'] if audited_sessions else None,
            'toSignalDate': audited_sessions[-1]['signalDate'] if audited_sessions else None,
            'lastOutcomeDate': audited_sessions[-1]['outcomeDate'] if audited_sessions else None,
        },
        'selectionCount': len(members),
        'executableByOpenRuleCount': len(executable),
        'notExecutableByOpenRuleCount': len(no_entry),
        'notExecutableByOpenRulePct': pct(len(no_entry), len(members)),
        'executionQualityEligibleCount': len(quality),
        'targetTouchedCount': len(target),
        'targetTouchRateOfExecutablePct': pct(len(target), len(executable)),
        'conservativeTargetHitCount': len(conservative),
        'conservativeTargetHitRateOfExecutablePct': pct(len(conservative), len(executable)),
        'stopTouchedCount': len(stops),
        'stopTouchRateOfExecutablePct': pct(len(stops), len(executable)),
        'ambiguousTargetAndStopSameDayCount': len(ambiguous),
        'sessionsWithAtLeastOneConservativeTarget': sum(any(m['conservativeTargetHit'] for m in s['members']) for s in audited_sessions),
        'sessionsWithAtLeastOneStop': sum(any(m['stopTouched'] for m in s['members']) for s in audited_sessions),
        'limitationsAr': [
            'الـ20 جلسة هي Holdout سبق استخدامه خلال تطوير V19 V6، لذلك هذا تدقيق تشخيصي وليس Fresh Independent Holdout.',
            'بيانات Daily OHLC لا تحدد ترتيب لمس الهدف والوقف داخل الجلسة؛ الحالة المزدوجة تُحسب وقفًا في النتيجة المحافظة.',
            'قاعدة السيولة داخل أول 10–15 دقيقة لا يمكن إعادة اختبارها من Daily OHLC، لذلك المقارنة تستخدم قاعدة الافتتاح الموحدة.',
        ],
        'sessions': audited_sessions,
    }
    write_json(OUT, report)
    print(json.dumps({k: v for k, v in report.items() if k != 'sessions'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
