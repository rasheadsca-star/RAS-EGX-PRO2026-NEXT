import hashlib
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "preview"))
from verify_live import verify, VerificationError

SESSION = "2026-11-02"
SHA = "a"*64

def fixture(session=SESSION, sha=SHA, extra=None):
    s = {"source_session": session, "content_sha256": sha,
         "ranked": [], "watchlist": [], "blocked": []}
    if extra:
        s.update(extra)
    payload = json.dumps(s, ensure_ascii=False, separators=(",", ":"))
    html = ("<!doctype html><title>EGX PRO</title>NO_STRATEGY_APPROVED"
            '<script id="payload" type="application/json">'+payload+"</script>").encode()
    data = json.dumps(s, ensure_ascii=False, indent=1).encode()
    return html, data

class LiveVerificationTests(unittest.TestCase):
    def mock_fetch(self, html, data):
        def f(url, name):
            return html if name == "" else data
        return patch("verify_live.fetch", side_effect=f)

    def test_consistent_live_release(self):
        h, j = fixture()
        with self.mock_fetch(h, j):
            r = verify("https://example.vercel.app", SESSION, SHA)
        self.assertEqual(r["status"], "VERIFIED_RESEARCH_PREVIEW")
        self.assertFalse(r["strategy_approved"])
    def test_stale_session_rejected(self):
        h, j = fixture(session="2026-11-01")
        with self.mock_fetch(h, j), self.assertRaisesRegex(VerificationError, "SESSION_MISMATCH"):
            verify("https://example.vercel.app", SESSION, SHA)
    def test_hash_mismatch_rejected(self):
        h, j = fixture(sha="b"*64)
        with self.mock_fetch(h, j), self.assertRaisesRegex(VerificationError, "HASH_MISMATCH"):
            verify("https://example.vercel.app", SESSION, SHA)
    def test_embedded_page_differs_from_json(self):
        h, _ = fixture(extra={"name": "a"})
        _, j = fixture(extra={"name": "b"})
        with self.mock_fetch(h, j), self.assertRaisesRegex(VerificationError, "PAYLOAD_DIFFERENCE"):
            verify("https://example.vercel.app", SESSION, SHA)
    def test_missing_embedded_payload(self):
        h, j = fixture()
        h = h.replace(b'id="payload"', b'id="removed"')
        with self.mock_fetch(h, j), self.assertRaisesRegex(VerificationError, "EMBEDDED_SNAPSHOT"):
            verify("https://example.vercel.app", SESSION, SHA)
    def test_login_screen_rejected(self):
        h = b"<html>Vercel Authentication Required</html>"
        _, j = fixture()
        with self.mock_fetch(h, j), self.assertRaises(VerificationError):
            verify("https://example.vercel.app", SESSION, SHA)
    def test_manifest_mismatch_rejected(self):
        h, j = fixture()
        with tempfile.TemporaryDirectory() as p:
            m = pathlib.Path(p)/"manifest.json"
            m.write_text(json.dumps({"files": {"index.html": hashlib.sha256(h).hexdigest(),
                                              "decision_snapshot.json": "0"*64}}))
            with self.mock_fetch(h, j), self.assertRaisesRegex(VerificationError, "SERVED_FILE_SHA_MISMATCH"):
                verify("https://example.vercel.app", SESSION, SHA, m)
    def test_manifest_matches_bytes(self):
        h, j = fixture()
        with tempfile.TemporaryDirectory() as p:
            m = pathlib.Path(p)/"manifest.json"
            m.write_text(json.dumps({"files": {"index.html": hashlib.sha256(h).hexdigest(),
                                              "decision_snapshot.json": hashlib.sha256(j).hexdigest()}}))
            with self.mock_fetch(h, j):
                r = verify("https://example.vercel.app", SESSION, SHA, m)
            self.assertTrue(r["manifest_verified"])
    def test_bad_url_rejected(self):
        with self.assertRaisesRegex(VerificationError, "HTTPS_REQUIRED"):
            verify("http://example.vercel.app", SESSION, SHA)
        with self.assertRaisesRegex(VerificationError, "INVALID_BASE_URL"):
            verify("https://a.vercel.app/panel", SESSION, SHA)

if __name__ == "__main__":
    unittest.main()
