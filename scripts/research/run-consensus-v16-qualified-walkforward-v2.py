#!/usr/bin/env python3
import runpy
from pathlib import Path
import os

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
module = runpy.run_path(str(ROOT / 'scripts/research/consensus-v16-qualified-walkforward.py'), run_name='consensus_v16_v2')

# Methodological change only: 73 usable historical signal sessions exist in this adapter.
# Two most-recent generated signal dates lack the full 3-session future evaluation window.
# Use 11 initial warm-up sessions so 62 walk-forward outputs are generated and exactly
# 60 remain after the future-window eligibility check. This is based only on data
# availability, not on backtest outcomes.
module['WARMUP_SESSIONS'] = 11
module['main']()
