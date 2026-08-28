#!/usr/bin/env python3
import runpy
from pathlib import Path
import os

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
module = runpy.run_path(str(ROOT / 'scripts/research/consensus-v16-qualified-walkforward.py'), run_name='consensus_v16_v2')

# Methodological change only: 73 usable historical signal sessions exist in this adapter.
# Use 13 sessions as the strict initial warm-up so the remaining evaluation window is exactly 60 sessions.
# This value is chosen from data availability, not from backtest outcomes.
module['WARMUP_SESSIONS'] = 13
module['main']()
