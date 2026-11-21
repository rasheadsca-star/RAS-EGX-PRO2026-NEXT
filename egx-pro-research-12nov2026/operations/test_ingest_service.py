import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ingest_service import ingest_bytes, init_database, get_status, create_handler, MAX_BYTES
from ingest_cli import run as run_scheduled
from scheduled_worker import next_schedule, run_once
from datetime import datetime
from zoneinfo import ZoneInfo

class FakeResult:
    def __init__(self,returncode=0,stderr=""):
        self.returncode=returncode
        self.stderr=stderr
        self.stdout=""

class TestIngestService(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.folder=Path(self.temp.name)
        self.fake_pdf=b"%PDF-"+b"0"*25_000
    def tearDown(self):
        self.temp.cleanup()
    def fake_runner(self,argv):
        if argv[0].endswith("python") or "egx_pdf_extract.py" in str(argv):
            out=Path(argv[argv.index("--output")+1])
            out.write_text(json.dumps({
                "sourceSha256":hashlib.sha256(self.fake_pdf).hexdigest(),
                "session":"2026-11-19", "totalRows":214, "rows":[],
                "publicationAllowed":False,"sourcePages":56
            }))
            return FakeResult()
        out=Path(argv[-1])
        out.write_text(json.dumps({"errors":["NO_VERSIONED_SECURITY_MASTER"],"publicationAllowed":False}))
        return FakeResult(2)
    def test_immutable_store_sha_dedup(self):
        a=ingest_bytes(self.fake_pdf,"manual",self.folder,runner=self.fake_runner)
        self.assertEqual(a["state"],"QUARANTINED")
        self.assertFalse(a["published"])
        self.assertFalse(a["certified"])
        b=ingest_bytes(self.fake_pdf,"manual",self.folder,runner=self.fake_runner)
        self.assertTrue(b["duplicate"])
        self.assertEqual(a["sha"],b["sha"])
        with sqlite3.connect(self.folder/"ingest.sqlite3") as con:
            self.assertEqual(con.execute("SELECT count(*) FROM ingests").fetchone()[0],1)
        original=self.folder/"objects"/a["sha"][:2]/(a["sha"]+".pdf")
        self.assertEqual(original.read_bytes(),self.fake_pdf)
    def test_reject_non_pdf_and_tiny(self):
        with self.assertRaisesRegex(ValueError,"INVALID_PDF_SIGNATURE"):
            ingest_bytes(b"test"+b"0"*25_000,"wrong",self.folder)
        with self.assertRaisesRegex(ValueError,"INVALID_PDF_SIZE"):
            ingest_bytes(b"%PDF-123","tiny",self.folder)
    def test_validator_exception_recorded_not_published(self):
        def failed(argv):
            return FakeResult(1,"synthetic extractor failure")
        a=ingest_bytes(self.fake_pdf,"manual",self.folder,runner=failed)
        self.assertEqual(a["state"],"VALIDATION_FAILED")
        self.assertIn("PDF_EXTRACT_FAILED",a["error"])
        self.assertFalse(a["published"])
    def test_scheduled_and_manual_share_ingest_function(self):
        pdf=self.folder/"latest.pdf"
        pdf.write_bytes(self.fake_pdf)
        with patch("ingest_cli.ingest_bytes", return_value={"sha":"a"*64,"state":"QUARANTINED"}) as mocked:
            result=run_scheduled(pdf,self.folder)
            mocked.assert_called_once_with(self.fake_pdf,"automatic_official_fetch",self.folder)
            self.assertEqual(result["state"],"QUARANTINED")
    def test_cairo_schedule_skips_friday_saturday(self):
        tz=ZoneInfo("Africa/Cairo")
        friday=datetime(2026,11,20,12,0,tzinfo=tz)
        self.assertEqual(next_schedule(friday).isoformat(),"2026-11-22T19:00:00+02:00")
    def test_automatic_local_fixture_routes_to_shared_storage(self):
        pdf=self.folder/"official.pdf"
        pdf.write_bytes(self.fake_pdf)
        with patch("scheduled_worker.ingest_local",return_value={"sha":"a"*64,"session":"2026-11-19","state":"QUARANTINED"}) as call:
            value=run_once(source_file=pdf,storage=self.folder)
            call.assert_called_once_with(pdf,self.folder)
            self.assertEqual(value["mode"],"local-fixture")
            self.assertFalse(value["published"])
            self.assertFalse(value["certified"])
    def test_missing_official_fetch_source_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"SOURCE_URL_NOT_CONFIGURED"):
            run_once(storage=self.folder)
    def test_handler_requires_key_on_upload(self):
        handler=create_handler(self.folder,"X"*40)
        self.assertTrue(callable(handler))
        self.assertEqual(MAX_BYTES,30*1024*1024)
        init_database(self.folder/"ingest.sqlite3")
        self.assertIsNone(get_status(self.folder/"ingest.sqlite3","a"*64))

if __name__=="__main__":
    unittest.main()
