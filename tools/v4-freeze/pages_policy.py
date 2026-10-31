#!/usr/bin/env python3
"""Read-only CI check for competing Pages publishers and V4 public route."""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2]
def check(root=ROOT):
    errors=[]
    folder=root/'.github/workflows'
    workflows=list(folder.glob('*.yml'))+list(folder.glob('*.yaml'))
    publishers=[]
    for path in workflows:
        content=path.read_text(encoding='utf-8')
        if 'actions/deploy-pages@' in content and not content.lstrip().startswith('# DISABLED'):
            publishers.append(path.name)
    if publishers != ['static.yml']:
        errors.append('Pages publishers must be exactly static.yml; found: '+', '.join(sorted(publishers)))
    primary=(folder/'static.yml')
    if not primary.exists():
        errors.append('static.yml missing')
    else:
        content=primary.read_text(encoding='utf-8')
        if "path: '.'" not in content and 'path: "."' not in content:
            errors.append('static.yml must deploy root, including /paper-v4/index.html')
    alternative=folder/'independent-paper-pages.yml'
    if alternative.exists():
        content=alternative.read_text(encoding='utf-8')
        if 'actions/deploy-pages@' in content or 'pages: write' in content:
            errors.append('V4 secondary workflow must stay verification-only')
    page=root/'paper-v4/index.html'
    if not page.exists(): errors.append('Independent V4 entry page missing')
    return errors
if __name__=='__main__':
    errors=check()
    print('PAGES_SINGLE_PUBLISHER_PASS' if not errors else 'PAGES_POLICY_FAIL: '+'; '.join(errors))
    sys.exit(bool(errors))
