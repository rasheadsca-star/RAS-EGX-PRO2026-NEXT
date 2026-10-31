"""Adversarial proof: frozen V4 display guard must reject unauthorized edits."""
import importlib.util
import pathlib
import shutil
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('frozen_v4_guard', ROOT/'tools/v4-freeze/guard.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class FrozenV4GuardAdversarialTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        (self.root/'paper-v4').mkdir()
        shutil.copyfile(ROOT/'paper-v4/index.html', self.root/'paper-v4/index.html')
        shutil.copyfile(ROOT/'index.html', self.root/'index.html')

    def patch(self, path, old, new):
        file = self.root/path
        text = file.read_text(encoding='utf-8')
        self.assertIn(old, text, f'expected test pattern missing: {old}')
        file.write_text(text.replace(old,new,1), encoding='utf-8')

    def test_original_passes(self):
        self.assertEqual([], MODULE.check(self.root))

    def test_price_tampering_is_blocked(self):
        self.patch('paper-v4/index.html','<strong>LCSW</strong></td><td>36.47','<strong>LCSW</strong></td><td>999.99')
        self.assertTrue(MODULE.check(self.root))

    def test_stop_tampering_is_blocked(self):
        self.patch('paper-v4/index.html','<td>34.245</td>','<td>1.00</td>')
        self.assertTrue(MODULE.check(self.root))

    def test_target_tampering_is_blocked(self):
        self.patch('paper-v4/index.html','<td>40.919</td>','<td>300.919</td>')
        self.assertTrue(MODULE.check(self.root))

    def test_ticker_removal_is_blocked(self):
        self.patch('paper-v4/index.html','<strong>ICID</strong>','<strong>REMOVED</strong>')
        self.assertTrue(MODULE.check(self.root))

    def test_astra_reintroduction_is_blocked(self):
        self.patch('paper-v4/index.html','</main>','<div>astra-prod/app</div></main>')
        self.assertTrue(MODULE.check(self.root))

    def test_root_redirect_tampering_is_blocked(self):
        self.patch('index.html','paper-v4/index.html','astra-prod/app/index.html')
        self.assertTrue(MODULE.check(self.root))

if __name__ == '__main__':
    unittest.main()
