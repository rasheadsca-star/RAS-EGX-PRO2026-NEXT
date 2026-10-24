import importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
root=Path(__file__).resolve().parent
def load(name):
    s=importlib.util.spec_from_file_location(name,root/(name+".py"))
    x=importlib.util.module_from_spec(s);s.loader.exec_module(x);return x
backup=load("backup_evidence")
verify=load("verify_backup_manifest")
class ManifestVerificationTests(unittest.TestCase):
    def test_roundtrip_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as t:
            d=Path(t);src=d/"src.sqlite";out=d/"out.sqlite";manifest=d/"manifest.json"
            c=sqlite3.connect(src)
            c.execute("CREATE TABLE observations(evidence_id TEXT,status TEXT)")
            c.execute("INSERT INTO observations VALUES('abc','QUARANTINED')")
            c.commit();c.close()
            backup.snapshot(src,out,manifest)
            self.assertEqual(verify.check(out,manifest)["count"],1)
            payload=json.loads(manifest.read_text())
            payload["count"]=2;manifest.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError,"logical mismatch"):verify.check(out,manifest)
            backup.snapshot(src,out,manifest)
            out.write_bytes(out.read_bytes()+b'tamper')
            with self.assertRaisesRegex(ValueError,"SHA256 mismatch"):verify.check(out,manifest)
if __name__=="__main__":unittest.main()
