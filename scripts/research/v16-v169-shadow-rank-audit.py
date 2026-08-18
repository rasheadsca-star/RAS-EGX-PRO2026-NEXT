#!/usr/bin/env python3
import json
import math
import os
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
SOURCE = ROOT / 'data/research/v16-v169-target-hit-audit.json'
LEDGER = ROOT / 'data/research/v16-v169-shadow-rank-ledger.json'
OUT = ROOT / 'data/research/v16-v169-shadow-rank-audit.json'
TRACKED_RANKS = (1, 2, 3)
MAX_LEDGER_SESSIONS = 250


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_json(path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def is_number(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def mean(values):
    clean = [value for value in values if is_number(value)]
    return statistics.fmean(clean) if clean else None


def median(values):
    clean = [value for value in values if is_number(value)]
    return statistics.median(clean) if clean else None


def pct(numerator, denominator):
    return (numerator / denominator * 100.0) if denominator else None


def rounded(value, digits=3):
    return round(value, digits) if is_number(value) else None


def average_ranks(values):
    indexed = sorted(enumerate(values), key=lambda item: item[1])
    result = [0.0] * len(values)
    start = 0
    while start < len(indexed):
        end = start + 1
        while end < len(indexed) and indexed[end][1] == indexed[start][1]:
            end += 1
        avg_rank = (start + 1 + end) / 2.0
        for position in range(start, end):
            result[indexed[position][0]] = avg_rank
        start = end
    return result


def pearson(xs, ys):
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    mx = statistics.fmean(xs)
    my = statistics.fmean(ys)
    dx = [x - mx for x in xs]
    dy = [y - my for y in ys]
    denom = math.sqrt(sum(value * value for value in dx) * sum(value * value for value in dy))
    if denom == 0:
        return None
    return sum(a * b for a, b in zip(dx, dy)) / denom


def ranking_skill_spearman(members):
    top = [member for member in members if member.get('rank') in TRACKED_RANKS]
    if len(top) < 3:
        return None
    top = sorted(top, key=lambda member: member['rank'])[:3]
    returns = [member.get('nextCloseReturnPct') for member in top]
    if not all(is_number(value) for value in returns):
        return None
    return_ranks = average_ranks(returns)
    corr = pearson([1.0, 2.0, 3.0], return_ranks)
    return -corr if corr is not None else None


def chi_square_three_groups(rows, outcome_key):
    groups = []
    for rank in TRACKED_RANKS:
        eligible = [row for row in rows if row.get('rank') == rank and row.get('executableByOpenRule')]
        hits = sum(bool(row.get(outcome_key)) for row in eligible)
        groups.append((hits, len(eligible) - hits))
    total = sum(hit + miss for hit, miss in groups)
    total_hits = sum(hit for hit, _ in groups)
    total_misses = total - total_hits
    if total == 0 or total_hits == 0 or total_misses == 0:
        return {'chiSquare': None, 'df': 2, 'pValueApprox': None, 'indicativeOnly': True}
    chi2 = 0.0
    for hits, misses in groups:
        group_total = hits + misses
        expected_hits = group_total * total_hits / total
        expected_misses = group_total * total_misses / total
        if expected_hits > 0:
            chi2 += (hits - expected_hits) ** 2 / expected_hits
        if expected_misses > 0:
            chi2 += (misses - expected_misses) ** 2 / expected_misses
    # For chi-square df=2, survival function is exp(-x/2).
    p_value = math.exp(-chi2 / 2.0)
    return {
        'chiSquare': rounded(chi2, 4),
        'df': 2,
        'pValueApprox': rounded(p_value, 4),
        'indicativeOnly': total < 180,
    }


def normalize_session(session):
    members = []
    for rank, member in enumerate(session.get('members') or [], 1):
        members.append({
            'rank': rank,
            'ticker': member.get('ticker'),
            'executableByOpenRule': bool(member.get('executableByOpenRule')),
            'targetTouched': bool(member.get('targetTouched')),
            'stopTouched': bool(member.get('stopTouched')),
            'ambiguousSameDay': bool(member.get('ambiguousSameDay')),
            'conservativeTargetHit': bool(member.get('conservativeTargetHit')),
            'nextCloseReturnPct': member.get('nextCloseReturnPct'),
        })
    return {
        'signalDate': session.get('signalDate'),
        'outcomeDate': session.get('outcomeDate'),
        'basketSize': session.get('basketSize'),
        'members': members,
    }


def build_rank_metrics(rows, sessions):
    metrics = {}
    for rank in TRACKED_RANKS:
        selected = [row for row in rows if row.get('rank') == rank]
        executable = [row for row in selected if row.get('executableByOpenRule')]
        targets = sum(bool(row.get('targetTouched')) for row in executable)
        conservative = sum(bool(row.get('conservativeTargetHit')) for row in executable)
        ambiguous = sum(bool(row.get('ambiguousSameDay')) for row in executable)
        stops = sum(bool(row.get('stopTouched')) for row in executable)
        all_returns = [row.get('nextCloseReturnPct') for row in selected if is_number(row.get('nextCloseReturnPct'))]
        exec_returns = [row.get('nextCloseReturnPct') for row in executable if is_number(row.get('nextCloseReturnPct'))]

        best_count = 0
        comparable_sessions = 0
        for session in sessions:
            top = sorted([member for member in session.get('members', []) if member.get('rank') in TRACKED_RANKS], key=lambda m: m['rank'])
            if len(top) < 3 or not all(is_number(member.get('nextCloseReturnPct')) for member in top[:3]):
                continue
            comparable_sessions += 1
            best_return = max(member['nextCloseReturnPct'] for member in top[:3])
            if any(member['rank'] == rank and member['nextCloseReturnPct'] == best_return for member in top[:3]):
                best_count += 1

        metrics[str(rank)] = {
            'selections': len(selected),
            'executable': len(executable),
            'executionRatePct': rounded(pct(len(executable), len(selected)), 2),
            'targetTouched': targets,
            'targetTouchRateExecutablePct': rounded(pct(targets, len(executable)), 2),
            'conservativeTargetHits': conservative,
            'conservativeTargetHitRateExecutablePct': rounded(pct(conservative, len(executable)), 2),
            'ambiguousTargetAndStopSameDay': ambiguous,
            'stopTouched': stops,
            'stopTouchRateExecutablePct': rounded(pct(stops, len(executable)), 2),
            'targetToStopTouchRatio': rounded(targets / stops, 3) if stops else None,
            'averageNextCloseReturnPctAll': rounded(mean(all_returns), 4),
            'medianNextCloseReturnPctAll': rounded(median(all_returns), 4),
            'positiveCloseRatePctAll': rounded(pct(sum(value > 0 for value in all_returns), len(all_returns)), 2),
            'averageNextCloseReturnPctExecutable': rounded(mean(exec_returns), 4),
            'medianNextCloseReturnPctExecutable': rounded(median(exec_returns), 4),
            'positiveCloseRatePctExecutable': rounded(pct(sum(value > 0 for value in exec_returns), len(exec_returns)), 2),
            'bestActualReturnCountAmongTop3': best_count,
            'bestActualReturnRatePctAmongComparableSessions': rounded(pct(best_count, comparable_sessions), 2),
        }
    return metrics


def pairwise_stats(sessions):
    pairs = ((1, 2), (1, 3), (2, 3))
    result = {}
    for left, right in pairs:
        wins = ties = comparable = 0
        for session in sessions:
            by_rank = {member.get('rank'): member for member in session.get('members', [])}
            a = by_rank.get(left, {}).get('nextCloseReturnPct')
            b = by_rank.get(right, {}).get('nextCloseReturnPct')
            if not is_number(a) or not is_number(b):
                continue
            comparable += 1
            if a > b:
                wins += 1
            elif a == b:
                ties += 1
        result[f'rank{left}VsRank{right}'] = {
            'comparableSessions': comparable,
            'leftWins': wins,
            'ties': ties,
            'leftWinRatePctExcludingTies': rounded(pct(wins, comparable - ties), 2) if comparable > ties else None,
        }
    return result


def main():
    source = load_json(SOURCE)
    if not source or not isinstance(source.get('sessions'), list):
        raise SystemExit(f'Missing or invalid source audit: {SOURCE}')

    existing = load_json(LEDGER, default={}) or {}
    existing_sessions = existing.get('sessions') if isinstance(existing.get('sessions'), list) else []
    by_signal = {session.get('signalDate'): session for session in existing_sessions if session.get('signalDate')}

    for session in source['sessions']:
        normalized = normalize_session(session)
        if normalized.get('signalDate'):
            by_signal[normalized['signalDate']] = normalized

    sessions = sorted(by_signal.values(), key=lambda session: session.get('signalDate') or '')[-MAX_LEDGER_SESSIONS:]
    ledger = {
        'schemaVersion': '16.9.2-shadow-rank-ledger',
        'createdAt': existing.get('createdAt') or now_iso(),
        'updatedAt': now_iso(),
        'sourceAuditSchema': source.get('schemaVersion'),
        'sourceAuditGeneratedAt': source.get('generatedAt'),
        'shadowOnly': True,
        'selectionEngineChanged': False,
        'sessions': sessions,
    }
    write_json(LEDGER, ledger)

    rows = [member for session in sessions for member in session.get('members', []) if member.get('rank') in TRACKED_RANKS]
    rank_metrics = build_rank_metrics(rows, sessions)

    skills = [ranking_skill_spearman(session.get('members', [])) for session in sessions]
    skills = [value for value in skills if is_number(value)]
    strict_ordered = 0
    comparable = 0
    for session in sessions:
        by_rank = {member.get('rank'): member for member in session.get('members', [])}
        values = [by_rank.get(rank, {}).get('nextCloseReturnPct') for rank in TRACKED_RANKS]
        if not all(is_number(value) for value in values):
            continue
        comparable += 1
        if values[0] > values[1] > values[2]:
            strict_ordered += 1

    n = len(sessions)
    readiness = 'COLLECTING'
    if n >= 100:
        readiness = 'STRONGER_REVIEW_WINDOW_100'
    elif n >= 60:
        readiness = 'REVIEW_WINDOW_60'

    report = {
        'schemaVersion': '16.9.2-shadow-rank-audit',
        'generatedAt': now_iso(),
        'mode': 'SHADOW_ONLY_NO_ENGINE_EFFECT',
        'source': {
            'path': str(SOURCE.relative_to(ROOT)),
            'schemaVersion': source.get('schemaVersion'),
            'generatedAt': source.get('generatedAt'),
        },
        'auditWindow': {
            'uniqueSessions': n,
            'fromSignalDate': sessions[0].get('signalDate') if sessions else None,
            'toSignalDate': sessions[-1].get('signalDate') if sessions else None,
            'lastOutcomeDate': sessions[-1].get('outcomeDate') if sessions else None,
            'targetReviewSessions': 60,
            'strongerReviewSessions': 100,
            'readiness': readiness,
        },
        'rankMetrics': rank_metrics,
        'rankingQuality': {
            'comparableTop3Sessions': comparable,
            'strictRank1GreaterRank2GreaterRank3Sessions': strict_ordered,
            'strictCorrectOrderRatePct': rounded(pct(strict_ordered, comparable), 2),
            'averageRankingSkillSpearman': rounded(mean(skills), 4),
            'interpretation': '+1 means rank order strongly matches next-session return order; 0 means little ordering skill; -1 means reversed ordering.',
            'pairwise': pairwise_stats(sessions),
        },
        'significanceChecks': {
            'targetTouchByRank': chi_square_three_groups(rows, 'targetTouched'),
            'conservativeTargetHitByRank': chi_square_three_groups(rows, 'conservativeTargetHit'),
            'note': 'Indicative only until the ledger has enough observations per rank; this report must not modify production ranking.'
        },
        'decisionContract': {
            'shadowOnly': True,
            'changesScoring': False,
            'changesRanking': False,
            'changesWeights': False,
            'changesFilters': False,
            'changesRiskGates': False,
            'canGrantExecution': False,
            'recommendedActionBefore60Sessions': 'NO_ENGINE_CHANGE_COLLECT_MORE_DATA',
        },
        'notesAr': [
            'هذا التدقيق يراقب جودة ترتيب المراكز داخل السلة فقط ولا يغير اختيار الأسهم أو أوزانها أو بوابات التنفيذ.',
            'قياس الهدف والوقف يعتمد على بيانات Daily OHLC، لذلك الحالات التي يلمس فيها الهدف والوقف في الجلسة نفسها تظل ملتبسة.',
            'الحكم على ترتيب 1/2/3 يجب أن يجمع بين إصابة الهدف، الوقف، العائد الفعلي، والمقارنات الزوجية؛ وليس عدد الأهداف وحده.',
        ],
    }
    write_json(OUT, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
