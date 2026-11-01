import unittest,tempfile,os,sys,json,pathlib,datetime,threading,http.server
ROOT=str(pathlib.Path(__file__).resolve().parent.parent);sys.path.insert(0,ROOT);sys.path.insert(0,str(pathlib.Path(__file__).parent));sys.path.insert(0,os.path.join(ROOT,"tools"))
import fixtures as F,preflight as P
TODAY=datetime.date(2026,11,2)
class Pre(unittest.TestCase):
    def test_env_names_only(self):
        pr=P.check_env(["A","B"],{"A":"secret"});self.assertEqual(pr,["missing required setting: B"]);self.assertNotIn("secret",str(pr))
        self.assertEqual(P.check_env(["A"],{"A":""}),["missing required setting: A"])
    def test_source_fresh_and_stale(self):
        d=tempfile.mkdtemp()
        json.dump({"sessions":[{"date":"2026-10-29"},{"date":"2026-11-01"}]},open(os.path.join(d,"A.json"),"w"))
        self.assertEqual(P.check_source(d,4,TODAY),[]);self.assertTrue(P.check_source(d,4,datetime.date(2026,11,20))[0].startswith("source is STALE"))
        self.assertTrue(P.check_source(d,4,datetime.date(2026,10,1)))                       # future-dated source also fails
        self.assertIn("no source files",P.check_source(tempfile.mkdtemp(),4,TODAY)[0])
    def test_source_unreadable(self):
        d=tempfile.mkdtemp();open(os.path.join(d,"A.json"),"w").write("{bad");self.assertTrue(P.check_source(d,4,TODAY))
    def test_db_stale(self):
        d=tempfile.mkdtemp();db=os.path.join(d,"x.sqlite");F.build(db,{}, filler=3,end="2026-10-29")
        self.assertEqual(P.check_db(db,4,TODAY),[]);self.assertTrue(P.check_db(db,4,datetime.date(2026,11,20)))
        self.assertTrue(P.check_db(os.path.join(d,"none.sqlite"),4,TODAY))
    def test_cli_exit(self):
        self.assertEqual(P.main(["env","--require","NOPE_NOT_SET_XYZ"]),2)
    def test_deploy_check(self):
        sha="a"*64;body=("<html>NO_STRATEGY_APPROVED "+sha+"</html>").encode()
        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(s):
                if s.path=="/prot":s.send_response(401);s.end_headers();return
                s.send_response(200);s.send_header("Cache-Control","no-store");s.end_headers();s.wfile.write(body if s.path=="/ok" else b"<html>other</html>")
            def log_message(s,*a):pass
        srv=http.server.HTTPServer(("127.0.0.1",0),H);threading.Thread(target=srv.serve_forever,daemon=True).start();u=f"http://127.0.0.1:{srv.server_port}"
        try:
            self.assertEqual(P.check_deploy(u+"/ok",sha),[]);self.assertTrue(P.check_deploy(u+"/bad",sha));self.assertIn("401",P.check_deploy(u+"/prot",sha)[0])
        finally:srv.shutdown()
if __name__=="__main__":unittest.main()
