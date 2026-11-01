import unittest,tempfile,os,sys,json,pathlib,datetime,shutil
ROOT=str(pathlib.Path(__file__).resolve().parent.parent);sys.path.insert(0,ROOT);sys.path.insert(0,str(pathlib.Path(__file__).parent));sys.path.insert(0,os.path.join(ROOT,"preview"))
import fixtures as F
import run_daily,prepare_preview as P
NOW="2026-10-30T09:00:00+00:00"
class Preview(unittest.TestCase):
    def setUp(self):
        self.d=tempfile.mkdtemp();db=os.path.join(self.d,"t.sqlite");F.build(db,{"UPT":dict(close=F.series(140,20,0.004,0.003,5))},end="2026-10-29")
        self.pub=os.path.join(self.d,"pub");self.assertEqual(run_daily.main(["--db",db,"--out",self.pub,"--journal",os.path.join(self.pub,"journal","j.jsonl"),"--now",NOW]),0)
        self.out=os.path.join(self.d,"dist")
    def test_symlink_resolved_to_real_files(self):
        self.assertTrue(os.path.islink(os.path.join(self.pub,"current")));r=P.prepare(self.pub,self.out)
        self.assertFalse(any(p.is_symlink() for p in pathlib.Path(self.out).rglob("*")))
        self.assertEqual(sorted(os.listdir(self.out)),["PREVIEW.txt","decision_snapshot.json","index.html","vercel.json"])
        self.assertEqual(r["project"],"egx-pro-decision-preview")
        v=json.load(open(os.path.join(self.out,"vercel.json")));hs={h["key"]:h["value"] for h in v["headers"][0]["headers"]}
        self.assertEqual(hs["Cache-Control"],"no-store");self.assertIn("noindex",hs["X-Robots-Tag"])
    def test_no_credentials_or_project_link_written(self):
        P.prepare(self.pub,self.out);self.assertFalse(os.path.exists(os.path.join(self.out,".vercel")))
    def test_refuses_failed_health(self):
        h=os.path.join(self.pub,"job_health.json");j=json.load(open(h));j["status"]="FAILED";json.dump(j,open(h,"w"))
        with self.assertRaises(P.PreviewError):P.prepare(self.pub,self.out)
    def test_refuses_tampered_release(self):
        real=os.path.realpath(os.path.join(self.pub,"current"));open(os.path.join(real,"index.html"),"a").write("<!--x-->")
        with self.assertRaises(P.PreviewError):P.prepare(self.pub,self.out)
    def test_refuses_when_no_release(self):
        os.unlink(os.path.join(self.pub,"current"))
        with self.assertRaises(P.PreviewError):P.prepare(self.pub,self.out)
        self.assertEqual(P.main(["--public",self.pub,"--out",self.out]),2)
    def test_refuses_health_release_mismatch(self):
        h=os.path.join(self.pub,"job_health.json");j=json.load(open(h));j["serving"]="other";json.dump(j,open(h,"w"))
        with self.assertRaises(P.PreviewError):P.prepare(self.pub,self.out)
    def test_stale_hidden_in_dist_page(self):
        P.prepare(self.pub,self.out);self.assertIn("NO_STRATEGY_APPROVED",open(os.path.join(self.out,"index.html"),encoding="utf-8").read())
if __name__=="__main__":unittest.main()
