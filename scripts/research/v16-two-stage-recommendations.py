#!/usr/bin/env python3
import os
import runpy
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
IMPLEMENTATION = runpy.run_path(
    str(ROOT / 'scripts/research/v16-two-stage-predictor.py'),
    run_name='v16_two_stage_implementation',
)
globals().update(IMPLEMENTATION)

if __name__ == '__main__':
    IMPLEMENTATION['main']()
