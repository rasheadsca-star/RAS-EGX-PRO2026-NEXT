#!/usr/bin/env python3
from pathlib import Path
import argparse
import json
import re
import subprocess
import tempfile

ROOT = Path.cwd()
CENTER = ROOT / 'preview-v13/app/unified-decision-center.html'
INDEX = ROOT / 'preview-v13/app/index.html'
POLICY = ROOT / 'data/ops/v13-19-policy.json'
CANONICAL = ROOT / '.github/workflows/v13-17-1-exact-fresh-production-universe.yml'
MARKER = 'V13_19_RECOMMENDATION_HISTORY_RISK_HEALTH'


def fail(message: str):
    raise SystemExit(f'V13.19 ACCEPTANCE FAILURE: {message}')


def require(text: str, needle: str, label: str):
    if needle not in text:
        fail(f'missing {label}: {needle}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ui-only', action='store_true')
    args = parser.parse_args()

    if not CENTER.exists() or not INDEX.exists() or not POLICY.exists():
        fail('required V13.19 files are missing')

    html = CENTER.read_text(encoding='utf-8')
    index = INDEX.read_text(encoding='utf-8')
    policy = json.loads(POLICY.read_text(encoding='utf-8'))

    require(html, MARKER, 'main marker')
    v19_title = 'V13.19 — التوصيات والمحفظة والمخاطر'
    v20_title = 'V13.20 — أفضلية الشراء والاختبار المستمر'
    successor_ok = 'V13_20_MULTI_SESSION_PRIORITY' in html and v20_title in html
    if v19_title not in html and not successor_ok:
        fail(f'missing V13.19 title or valid V13.20 successor title: {v19_title}')

    for needle, label in [
        ('سجل التوصيات اليومية V13.19', 'recommendation history panel'),
        ('مخاطر المحفظة V13.19', 'portfolio risk panel'),
        ('صحة النظام V13.19', 'system health panel'),
        ('V1319_HISTORY_KEY', 'recommendation history storage'),
        ('V1319_RISK_KEY', 'risk settings storage'),
        ('V1319_HEALTH_KEY', 'health history storage'),
        ('function v19CaptureRecommendations()', 'history capture engine'),
        ('function v19RiskEvaluation()', 'portfolio risk engine'),
        ('function v19HealthSnapshot()', 'system health engine'),
        ('function v19ExportAll()', 'combined backup export'),
        ('غير مرشح', 'separation of new recommendation and open position'),
        ('لا يمثل ذلك أمر بيع تلقائيًا', 'no automatic sell interpretation'),
        ('لا تمثل توصية شراء أو أمر تنفيذ', 'risk calculator safety'),
        ('Automatic Broker Orders', 'broker automation disclosure'),
    ]:
        require(html, needle, label)

    if 'EGX Pro V13.19' not in index and 'EGX Pro V13.20' not in index:
        fail('missing V13.19/V13.20 entry page version')
    require(index, 'V13_19_RECOMMENDATION_HISTORY_RISK_HEALTH_INDEX', 'entry marker')

    ids = re.findall(r'\bid="([^"]+)"', html)
    duplicates = sorted({x for x in ids if ids.count(x) > 1})
    if duplicates:
        fail('duplicate HTML ids: ' + ', '.join(duplicates))

    scripts = re.findall(r'<script>(.*?)</script>', html, flags=re.S)
    if not scripts:
        fail('no inline javascript found')
    with tempfile.NamedTemporaryFile('w', suffix='.js', encoding='utf-8', delete=False) as tmp:
        tmp.write('\n'.join(scripts))
        js_path = tmp.name
    result = subprocess.run(['node', '--check', js_path], capture_output=True, text=True)
    Path(js_path).unlink(missing_ok=True)
    if result.returncode != 0:
        fail('javascript syntax error: ' + (result.stderr.strip() or result.stdout.strip()))

    if policy.get('version') != '13.19.0':
        fail('policy version mismatch')
    if policy.get('storage', {}).get('scope') != 'LOCAL_DEVICE_ONLY':
        fail('local-only storage policy missing')
    safety = policy.get('safety', {})
    for key in ['automaticBrokerOrders', 'automaticBuySellExecution']:
        if safety.get(key) is not False:
            fail(f'{key} must remain false')
    if safety.get('recommendationRemovalMeansAutomaticSell') is not False:
        fail('recommendation removal must not mean automatic sell')

    if not args.ui_only:
        if not CANONICAL.exists():
            fail('canonical production workflow is missing')
        workflow = CANONICAL.read_text(encoding='utf-8')
        require(workflow, 'V13_19_RECOMMENDATION_RISK_HEALTH_REAPPLY', 'canonical reapply marker')
        require(workflow, 'v13-19-ui-patch.py', 'canonical V13.19 patch call')
        require(workflow, 'v13-19-acceptance.py --ui-only', 'canonical V13.19 acceptance call')

    print('V13.19 RECOMMENDATION HISTORY, PORTFOLIO RISK & SYSTEM HEALTH ACCEPTANCE PASSED')


if __name__ == '__main__':
    main()
