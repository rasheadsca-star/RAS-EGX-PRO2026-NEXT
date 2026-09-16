#!/usr/bin/env python3
import argparse
import json
import math
import os
import runpy
import statistics
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
SRC = runpy.run_path(str(ROOT / 'scripts/research/v16-two-stage-predictor.py'), run_name='g11_v16_feature_audit')
BASE = SRC['BASE']
norm_hist = SRC['norm_hist']
base_feature = SRC['base_feature']
augment_feature = SRC['augment_feature']
sma = BASE['sma']
atr = BASE['atr']
rsi = BASE['rsi']
pct = BASE['pct']
mean = BASE['m']


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return default


def active_rows():
    raw = read_json(ROOT / 'data/symbol-map.json', {}) or {}
    rows = raw if isinstance(raw, list) else list(raw.values())
    return [x for x in rows if x.get('active') is not False and x.get('ticker')]


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def diagnose_feature(history, session):
    rows = history.get('rows', [])
    reasons = []
    if not history.get('ok'):
        reasons.append('HISTORY_DOCUMENT_NOT_SOURCE_VALID')
    if not rows:
        return {'readyBeforeCrossSection': False, 'reasons': ['NO_VALID_HISTORY_ROWS'], 'validHistorySessions': 0}
    current_index = next((i for i in range(len(rows) - 1, -1, -1) if rows[i]['date'] == session), None)
    latest = rows[-1]['date'] if rows else None
    if current_index is None:
        reasons.append('CURRENT_EXPECTED_SESSION_ROW_MISSING' if not latest or latest < session else 'EXPECTED_SESSION_ROW_NOT_UNIQUE_OR_NOT_FOUND')
        return {'readyBeforeCrossSection': False, 'reasons': reasons, 'validHistorySessions': len(rows), 'latestSession': latest}
    if current_index < 55:
        reasons.append('HISTORY_LT_56_FOR_V16_SOURCE_FEATURES')
        return {'readyBeforeCrossSection': False, 'reasons': reasons, 'validHistorySessions': len(rows), 'latestSession': latest, 'currentIndex': current_index}

    z = rows
    q = z[current_index]
    s10 = sma(z, current_index, 10)
    s20 = sma(z, current_index, 20)
    s50 = sma(z, current_index, 50)
    a14 = atr(z, current_index)
    rsi14 = rsi(z, current_index)
    avg_volume20 = sma(z, current_index - 1, 20, 'volume')
    primitives = {'sma10': s10, 'sma20': s20, 'sma50': s50, 'atr14': a14, 'rsi14': rsi14, 'previous20AverageVolume': avg_volume20}
    if not all(finite(x) for x in primitives.values()):
        reasons.append('V16_PRIMITIVE_FEATURE_NONFINITE')
    if finite(avg_volume20) and avg_volume20 <= 0:
        reasons.append('PREVIOUS_20_SESSION_AVERAGE_VOLUME_NON_POSITIVE')

    atr_pct = a14 / q['close'] * 100 if finite(a14) and q.get('close', 0) > 0 else None
    ret1 = pct(q['close'], z[current_index - 1]['close']) if current_index > 0 else None
    if finite(atr_pct) and not (0.4 <= atr_pct <= 14):
        reasons.append('ATR_PCT_OUTSIDE_V16_0_4_TO_14_RANGE')
    if finite(ret1) and abs(ret1) > 30:
        reasons.append('ABS_RETURN1_EXCEEDS_V16_30_PCT_LIMIT')

    feature = base_feature(history, current_index)
    if feature is None:
        if not reasons:
            reasons.append('BASE_FEATURE_REJECTED_BY_SOURCE_RULE_WITHOUT_MORE_SPECIFIC_DIAGNOSTIC')
        return {
            'readyBeforeCrossSection': False,
            'reasons': reasons,
            'validHistorySessions': len(rows),
            'latestSession': latest,
            'currentIndex': current_index,
            'primitives': primitives,
            'atrPct': atr_pct,
            'return1Pct': ret1,
        }

    feature = augment_feature(history, current_index, feature)
    return {
        'readyBeforeCrossSection': True,
        'reasons': [],
        'validHistorySessions': len(rows),
        'latestSession': latest,
        'currentIndex': current_index,
        'primitives': primitives,
        'atrPct': atr_pct,
        'return1Pct': ret1,
        'ret20': feature.get('ret20'),
        'turnover20': feature.get('turn'),
        'volumeRatio20': feature.get('vr'),
        'breakout20': feature.get('breakout'),
    }


def build(session):
    active = active_rows()
    records = []
    base_valid = []
    for item in sorted(active, key=lambda x: str(x.get('ticker'))):
        ticker = str(item.get('ticker')).strip().upper()
        path = ROOT / 'data/history' / f'{ticker}.json'
        if not path.exists():
            rec = {'securityId': f'EGX:{ticker}', 'ticker': ticker, 'readyBeforeCrossSection': False, 'ready': False, 'reasons': ['HISTORY_FILE_MISSING'], 'validHistorySessions': 0}
            records.append(rec)
            continue
        history = norm_hist(path)
        history['rows'] = [row for row in history.get('rows', []) if row['date'] <= session]
        result = diagnose_feature(history, session)
        rec = {'securityId': f'EGX:{ticker}', 'ticker': ticker, **result, 'ready': False}
        records.append(rec)
        if result.get('readyBeforeCrossSection'):
            base_valid.append(rec)

    minimum_universe = int(SRC['MIN_UNIVERSE'])
    cross_section_ready = len(base_valid) >= minimum_universe
    median_ret20 = statistics.median([r['ret20'] for r in base_valid]) if cross_section_ready and base_valid else None
    for rec in records:
        if rec.get('readyBeforeCrossSection'):
            if cross_section_ready:
                rec['ready'] = True
                rec['relativeStrength20'] = rec['ret20'] - median_ret20
                rec['reasons'] = []
            else:
                rec['reasons'] = ['CROSS_SECTION_BELOW_MINIMUM_UNIVERSE_60']
        rec['sameSessionRequirementMet'] = rec.get('latestSession') == session and 'CURRENT_EXPECTED_SESSION_ROW_MISSING' not in rec.get('reasons', [])

    not_ready = [r for r in records if not r.get('ready')]
    reason_counts = {}
    for rec in not_ready:
        for reason in rec.get('reasons', []):
            reason_counts[reason] = reason_counts.get(reason, 0) + 1

    contracts = [
        {'featureId':'SMA10_SMA20_SMA50','sourceModule':'scripts/research/v16-probabilistic-model-impact.py::feat','minimumUniverseCoverage':60,'historicalRequirement':'56 validation-approved sessions ending on the same current session','crossSectionalRequirement':False,'benchmarkRequirement':None,'sameSessionRequirement':True,'currentCoverage':len(base_valid)},
        {'featureId':'ATR14_RSI14','sourceModule':'scripts/research/v16-probabilistic-model-impact.py::feat','minimumUniverseCoverage':60,'historicalRequirement':'56 validation-approved sessions; ATR% must be 0.4..14','crossSectionalRequirement':False,'benchmarkRequirement':None,'sameSessionRequirement':True,'currentCoverage':len(base_valid)},
        {'featureId':'VOLUME_RATIO20_TURNOVER20','sourceModule':'scripts/research/v16-probabilistic-model-impact.py::feat','minimumUniverseCoverage':60,'historicalRequirement':'20 prior volume observations plus current row; prior-20 average volume > 0','crossSectionalRequirement':False,'benchmarkRequirement':None,'sameSessionRequirement':True,'currentCoverage':len(base_valid)},
        {'featureId':'RETURNS_BREAKOUT_TREND','sourceModule':'scripts/research/v16-probabilistic-model-impact.py::feat','minimumUniverseCoverage':60,'historicalRequirement':'20-session return/breakout window; abs(ret1)<=30','crossSectionalRequirement':False,'benchmarkRequirement':None,'sameSessionRequirement':True,'currentCoverage':len(base_valid)},
        {'featureId':'RELATIVE_STRENGTH20','sourceModule':'astra/data-health/g11-v16-context.py + scripts/research/v16-two-stage-predictor.py','minimumUniverseCoverage':60,'historicalRequirement':'base V16 feature must be valid','crossSectionalRequirement':True,'benchmarkRequirement':'same-session median RET20 across >=60 base-valid securities','sameSessionRequirement':True,'currentCoverage':len(base_valid) if cross_section_ready else 0},
        {'featureId':'V16_EXTENDED_VECTOR','sourceModule':'scripts/research/v16-two-stage-predictor.py::augment_feature/extended_vector','minimumUniverseCoverage':60,'historicalRequirement':'base features plus robust 20-session volume metrics','crossSectionalRequirement':True,'benchmarkRequirement':'RELATIVE_STRENGTH20 same-session cross-section','sameSessionRequirement':True,'currentCoverage':len([r for r in records if r.get('ready')])},
    ]

    focus = {ticker: next((r for r in records if r['ticker'] == ticker), None) for ticker in ['AMES','GRCA','LUTS','PHGC']}
    return {
        'schemaVersion':'astra-g11-v16-feature-readiness-1',
        'generatedAt':os.getenv('G11_EVALUATED_AT') or None,
        'expectedSession':session,
        'sourceAlgorithms':['scripts/research/v16-probabilistic-model-impact.py','scripts/research/v16-two-stage-predictor.py','astra/data-health/g11-v16-context.py'],
        'minimumUniverse':minimum_universe,
        'activeUniverse':len(active),
        'baseFeatureReady':len(base_valid),
        'crossSectionReady':cross_section_ready,
        'finalV16Ready':len([r for r in records if r.get('ready')]),
        'sameSessionMarketMedianRet20':median_ret20,
        'contracts':contracts,
        'reasonCounts':reason_counts,
        'focusSecurities':focus,
        'records':records,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--session', required=True)
    parser.add_argument('--output', default='docs/astra/G11_V16_FEATURE_READINESS.json')
    args = parser.parse_args()
    result = build(args.session)
    out = ROOT / args.output
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('ASTRA_G11_V16_FEATURE_READINESS ' + json.dumps({
        'active':result['activeUniverse'], 'baseReady':result['baseFeatureReady'], 'finalReady':result['finalV16Ready'], 'crossSectionReady':result['crossSectionReady'], 'focus':result['focusSecurities']
    }, ensure_ascii=False))

if __name__ == '__main__':
    main()
