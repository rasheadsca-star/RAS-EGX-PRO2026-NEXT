import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('publisher_guard',ROOT/'tools/v4-freeze/pages_policy.py')
MOD=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
class PagesPolicyTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        self.root=Path(self.t.name)
        (self.root/'.github/workflows').mkdir(parents=True)
        (self.root/'paper-v4').mkdir()
        for name in ['static.yml','independent-paper-pages.yml']:
            shutil.copyfile(ROOT/'.github/workflows'/name,self.root/'.github/workflows'/name)
        shutil.copyfile(ROOT/'paper-v4/index.html',self.root/'paper-v4/index.html')
    def test_single_publisher_passes(self):
        self.assertEqual([],MOD.check(self.root))
    def test_second_publisher_blocked(self):
        (self.root/'.github/workflows/extra.yml').write_text('steps:\n - uses: actions/deploy-pages@v4\n')
        self.assertTrue(MOD.check(self.root))
    def test_v4_secondary_cannot_publish(self):
        with (self.root/'.github/workflows/independent-paper-pages.yml').open('a') as f:
            f.write('\n- uses: actions/deploy-pages@v4\n')
        self.assertTrue(MOD.check(self.root))
    def test_missing_v4_page_blocked(self):
        (self.root/'paper-v4/index.html').unlink()
        self.assertTrue(MOD.check(self.root))
    def test_wrong_deploy_root_blocked(self):
        p=self.root/'.github/workflows/static.yml'
        content=p.read_text().replace("path: '.'","path: 'astra-prod'")
        self.assertNotEqual(content,p.read_text())
        p.write_text(content)
        self.assertTrue(MOD.check(self.root))
if __name__=='__main__':
    unittest.main()
