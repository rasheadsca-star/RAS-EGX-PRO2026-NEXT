#!/usr/bin/env python3
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ns = runpy.run_path(
    str(ROOT / 'scripts/research/v16-v167-coherent-engine.py'),
    run_name='v167_implementation',
)

# Three materially different trade structures are enough for nested selection.
ns['CONFIGS'] = [
    {'id': 'FAST_2D', 'horizon': 2, 'targetAtr': 1.00, 'stopAtr': 0.80},
    {'id': 'BALANCED_3D', 'horizon': 3, 'targetAtr': 1.25, 'stopAtr': 0.90},
    {'id': 'BALANCED_5D', 'horizon': 5, 'targetAtr': 1.50, 'stopAtr': 1.00},
]
ns['OUTER_WARMUP'] = 28
ns['INNER_VALIDATION_SESSIONS'] = 4
ns['MIN_CONDITIONAL_EV_PCT'] = 0.03

_original_entry = ns['train_entry_logit']
_original_softmax = ns['train_softmax']
_original_time = ns['train_time_regression']


def rolling_fit(rows):
    rows = rows[-1200:]
    if not rows:
        return None
    entry = _original_entry(rows, epochs=5, lr=0.045, l2=0.016)
    multi = _original_softmax(rows, epochs=8, lr=0.055, l2=0.018)
    time_model = _original_time(rows, epochs=10, lr=0.022, l2=0.032)
    if entry is None or multi is None or time_model is None:
        return None
    entered = [row for row in rows if row['entered'] and row['class'] is not None]
    base_class = [
        sum(row['class'] == klass for row in entered) / max(1, len(entered))
        for klass in range(3)
    ]
    return {'entry': entry, 'multi': multi, 'time': time_model, 'baseClass': base_class}


ns['fit_models'] = rolling_fit
ns['main']()
