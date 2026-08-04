#!/usr/bin/env python3
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ns = runpy.run_path(
    str(ROOT / 'scripts/research/v16-v167-coherent-engine.py'),
    run_name='v167_implementation',
)

ns['OUTER_WARMUP'] = 25
ns['INNER_VALIDATION_SESSIONS'] = 6
ns['MIN_CONDITIONAL_EV_PCT'] = 0.03

_original_entry = ns['train_entry_logit']
_original_softmax = ns['train_softmax']
_original_time = ns['train_time_regression']
_original_fit = ns['fit_models']


def fast_entry(rows, epochs=8, lr=0.040, l2=0.014):
    return _original_entry(rows, epochs=epochs, lr=lr, l2=l2)


def fast_softmax(rows, epochs=12, lr=0.050, l2=0.016):
    return _original_softmax(rows, epochs=epochs, lr=lr, l2=l2)


def fast_time(rows, epochs=15, lr=0.020, l2=0.030):
    return _original_time(rows, epochs=epochs, lr=lr, l2=l2)


def rolling_fit(rows):
    return _original_fit(rows[-2000:])


ns['train_entry_logit'] = fast_entry
ns['train_softmax'] = fast_softmax
ns['train_time_regression'] = fast_time
ns['fit_models'] = rolling_fit
ns['main']()
