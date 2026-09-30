#!/usr/bin/env python3
import os
import runpy
import unittest
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or Path(__file__).resolve().parents[2]).resolve()
MOD = runpy.run_path(str(ROOT / 'scripts/research/v16-v1610-exposure-challenger.py'), run_name='v1610_test')


class V1610ExposureAccountingTests(unittest.TestCase):
    def test_pilot_exposure_is_fifty_percent(self):
        self.assertEqual(MOD['MAX_PORTFOLIO_ALLOCATION_PCT'], 50.0)
        self.assertEqual(MOD['EXPOSURE'], 0.5)

    def test_cost_and_return_scale_with_deployed_notional(self):
        # V16.9 basket net = gross return minus 0.60% cost on deployed capital.
        # With 50% of total portfolio deployed, total-capital P&L is half.
        self.assertEqual(MOD['portfolio_return_from_basket_net'](2.4), 1.2)
        self.assertEqual(MOD['portfolio_return_from_basket_net'](-3.0), -1.5)

    def test_half_exposure_reduces_drawdown_without_changing_win_sign(self):
        full = [
            {'r': 4.0}, {'r': -8.0}, {'r': -7.0}, {'r': 3.0}, {'r': -5.0}, {'r': 6.0}
        ]
        half = [{'r': MOD['portfolio_return_from_basket_net'](row['r'])} for row in full]
        full_metrics = MOD['aggregate'](full, 'r')
        half_metrics = MOD['aggregate'](half, 'r')
        self.assertGreater(half_metrics['maximumDrawdownPct'], full_metrics['maximumDrawdownPct'])
        self.assertEqual(half_metrics['sessionWinRatePct'], full_metrics['sessionWinRatePct'])
        self.assertAlmostEqual(half_metrics['profitFactor'], full_metrics['profitFactor'], places=3)

    def test_risk_gate_threshold_is_not_relaxed(self):
        self.assertEqual(MOD['GATE_MAX_DRAWDOWN_PCT'], -15.0)
        passing = {
            'sessions': 30,
            'averageNetReturnPct': 0.2,
            'compoundedNetReturnPct': 4.0,
            'profitFactor': 1.3,
            'maximumDrawdownPct': -14.99,
            'sessionWinRatePct': 46.0,
        }
        failing = dict(passing, maximumDrawdownPct=-15.01)
        self.assertTrue(MOD['acceptance_gate'](passing)['maximumDrawdownAboveMinus15'])
        self.assertFalse(MOD['acceptance_gate'](failing)['maximumDrawdownAboveMinus15'])


if __name__ == '__main__':
    unittest.main()
