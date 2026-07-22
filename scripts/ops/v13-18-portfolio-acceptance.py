#!/usr/bin/env python3
from pathlib import Path
import argparse, re, subprocess, tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--ui-only', action='store_true')
args = parser.parse_args()
center = Path('preview-v13/app/unified-decision-center.html')
index = Path('preview-v13/app/index.html')
workflow = Path('.github/workflows/v13-17-1-exact-fresh-production-universe.yml')
required = {
    'portfolio marker': 'V13_18_PORTFOLIO_LIFECYCLE',
    'portfolio panel': 'id="portfolioPanel"',
    'open rows': 'id="portfolioRows"',
    'closed rows': 'id="closedPortfolioRows"',
    'selected action': 'id="addSelectedPosition"',
    'backup export': 'function portfolioExport()',
    'backup import': 'function portfolioImport(file)',
    'position state engine': 'function portfolioPositionState(p,info)',
    'original recommendation snapshot': 'function portfolioSnapshot(ticker)',
    'no new buy distinction': 'غير مرشح لشراء جديد',
    'stop monitoring': 'STOP_HIT',
    'target monitoring': 'TARGET1_HIT',
    'local storage': "PORTFOLIO_KEY='egx-v1318-portfolio-lifecycle'",
}
text = center.read_text(encoding='utf-8')
missing = [name for name, token in required.items() if token not in text]
if missing:
    raise SystemExit('V13.18 portfolio acceptance failure: missing ' + ', '.join(missing))
if 'V13_18_PORTFOLIO_INDEX' not in index.read_text(encoding='utf-8'):
    raise SystemExit('V13.18 portfolio acceptance failure: index marker missing')
# Inline JS syntax check.
scripts = re.findall(r'<script[^>]*>(.*?)</script>', text, flags=re.S|re.I)
if not scripts:
    raise SystemExit('V13.18 portfolio acceptance failure: no inline script found')
with tempfile.NamedTemporaryFile('w', suffix='.js', encoding='utf-8', delete=False) as f:
    f.write('\n'.join(scripts))
    js_path = f.name
subprocess.run(['node', '--check', js_path], check=True)
if not args.ui_only:
    wf = workflow.read_text(encoding='utf-8')
    for token in ['V13_18_PORTFOLIO_REAPPLY', 'v13-18-portfolio-ui-patch.py', 'v13-18-portfolio-acceptance.py']:
        if token not in wf:
            raise SystemExit(f'V13.18 permanence acceptance failure: {token} missing from production workflow')
print('V13.18 PORTFOLIO LIFECYCLE ACCEPTANCE PASSED')
