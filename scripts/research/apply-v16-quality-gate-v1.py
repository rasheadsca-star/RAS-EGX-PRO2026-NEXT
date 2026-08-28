#!/usr/bin/env python3
import json
import os
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
PATH = ROOT / 'data/research/consensus-v16-qualified-walkforward.json'


def num(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def med(values):
    values = [num(v) for v in values]
    return statistics.median(values) if values else 0.0


def main():
    doc = json.loads(PATH.read_text(encoding='utf-8'))
    sessions = doc.get('sessions') or []
    broad_total = 0
    quality_total = 0
    zero_quality_sessions = 0

    for session in sessions:
        broad = list(session.get('candidates') or [])
        broad_total += len(broad)

        thresholds = {
            'predictionLiftVsHistoricalBaseMinExclusive': 1.0,
            'netPositiveProbabilityPctMedian': med([x.get('netPositiveProbabilityPct') for x in broad]),
            'largeLossProbabilityPctMedian': med([x.get('largeLossProbabilityPct') for x in broad]),
            'momentumFailureRiskPctMedian': med([x.get('momentumFailureRiskPct') for x in broad]),
            'executionScoreMedian': med([x.get('executionScore') for x in broad]),
            'effectiveModelSupportMinExclusive': 0.0,
        }

        quality = []
        for item in broad:
            checks = {
                'historicalTop10Edge': num(item.get('predictionLiftVsHistoricalBase')) > 1.0,
                'netPositiveAtOrAboveSessionMedian': num(item.get('netPositiveProbabilityPct')) >= thresholds['netPositiveProbabilityPctMedian'],
                'largeLossAtOrBelowSessionMedian': num(item.get('largeLossProbabilityPct')) <= thresholds['largeLossProbabilityPctMedian'],
                'momentumFailureAtOrBelowSessionMedian': num(item.get('momentumFailureRiskPct')) <= thresholds['momentumFailureRiskPctMedian'],
                'executionScoreAtOrAboveSessionMedian': num(item.get('executionScore')) >= thresholds['executionScoreMedian'],
                'positiveEffectiveModelSupport': num(item.get('effectiveModelSupport')) > 0.0,
            }
            if all(checks.values()):
                selected = dict(item)
                selected['qualityChecks'] = checks
                quality.append(selected)

        quality.sort(key=lambda x: num(x.get('executionScore')), reverse=True)
        for rank, item in enumerate(quality, 1):
            item['rank'] = rank

        session['broadQualifiedCount'] = len(broad)
        session['qualityQualifiedCount'] = len(quality)
        session['qualityExcludedCount'] = len(broad) - len(quality)
        session['qualityThresholds'] = thresholds
        session['broadCandidates'] = broad
        session['candidates'] = quality
        session['qualifiedCount'] = len(quality)
        session['excludedCount'] = int(session.get('excludedCount') or 0) + (len(broad) - len(quality))

        quality_total += len(quality)
        if not quality:
            zero_quality_sessions += 1

    method = doc.setdefault('method', {})
    method['qualityGateVersion'] = 'v16-quality-gate-v1'
    method['qualityGateAppliedAt'] = datetime.now(timezone.utc).isoformat()
    method['qualityGate'] = {
        'fixedOutputCount': False,
        'futureLeakageForbidden': True,
        'rulesLockedBeforeBacktest': True,
        'rules': [
            'predictionLiftVsHistoricalBase > 1.0',
            'netPositiveProbabilityPct >= same-session median among execution-qualified V16 rows',
            'largeLossProbabilityPct <= same-session median among execution-qualified V16 rows',
            'momentumFailureRiskPct <= same-session median among execution-qualified V16 rows',
            'executionScore >= same-session median among execution-qualified V16 rows',
            'effectiveModelSupport > 0',
        ],
        'rationale': 'Relative quality qualification only; no Top-N cap and no threshold fitted to realized backtest returns.',
    }
    doc['schemaVersion'] = 'consensus-v16-quality-gate-walkforward-v1'
    doc['qualityGateSummary'] = {
        'sessions': len(sessions),
        'broadCandidates': broad_total,
        'qualityCandidates': quality_total,
        'averageBroadPerSession': round(broad_total / max(1, len(sessions)), 3),
        'averageQualityPerSession': round(quality_total / max(1, len(sessions)), 3),
        'zeroQualitySessions': zero_quality_sessions,
    }

    PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(doc['qualityGateSummary'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
