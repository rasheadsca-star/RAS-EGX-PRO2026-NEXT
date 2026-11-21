"""EGX PRO local ingestion service (preproduction / fail closed).

POST /api/ingest with raw application/pdf and X-EGX-Upload-Key.
GET /api/ingest/{sha256} with X-EGX-Upload-Key.
GET /api/health without credentials.

Run on loopback behind an authenticated HTTPS reverse proxy; requires a
persistent volume for EGX_DATA_DIR. Does not publish latest.json or signals.
No credential is stored in the static GitHub Pages app.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
from threading import Lock

MAX_BYTES = 30 * 1024 * 1024
MIN_BYTES = 20_000
SHA = re.compile(r"^[a-f0-9]{64}$")
_LOCK = Lock()
ROOT = Path(__file__).resolve().parent
EXTRACTOR = ROOT / "egx_pdf_extract.py"
VALIDATOR = ROOT / "validate-extraction.cjs"

def utc_now():
    return datetime.now(timezone.utc).isoformat()

def init_database(db):
    db = Path(db)
    db.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db) as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS ingests (
            sha TEXT PRIMARY KEY, source_name TEXT NOT NULL, created_at TEXT NOT NULL,
            session TEXT, state TEXT NOT NULL, bytes INTEGER NOT NULL,
            validation_json TEXT, error TEXT
        )""")
        connection.commit()

def get_status(db, digest):
    with sqlite3.connect(db) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM ingests WHERE sha=?", (digest,)).fetchone()
    if row is None:
        return None
    d = dict(row)
    if d["validation_json"]:
        d["validation"] = json.loads(d.pop("validation_json"))
    else:
        d.pop("validation_json")
    return d

def _run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=90, check=False)

def ingest_bytes(raw, source_name, data_dir, *, runner=_run):
    """Idempotent, immutable PDF staging and validation; no publication.
    Caller must enforce authentication before providing any bytes.
    """
    if not isinstance(raw, bytes) or not MIN_BYTES <= len(raw) <= MAX_BYTES:
        raise ValueError("INVALID_PDF_SIZE")
    if not raw.startswith(b"%PDF-"):
        raise ValueError("INVALID_PDF_SIGNATURE")
    digest = sha256(raw).hexdigest()
    data_dir = Path(data_dir)
    db = data_dir / "ingest.sqlite3"
    init_database(db)
    with _LOCK:
        prior = get_status(db, digest)
        if prior:
            if prior["state"] == "STAGED":
                return {"sha": digest, "state": "ALREADY_STAGED", "duplicate": True}
            return {**prior, "duplicate": True}
        original = data_dir / "objects" / digest[:2] / f"{digest}.pdf"
        original.parent.mkdir(parents=True, exist_ok=True)
        if not original.exists():
            fd, temporary = tempfile.mkstemp(prefix=".egx-", dir=original.parent)
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, original)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        with sqlite3.connect(db) as conn:
            conn.execute("INSERT INTO ingests (sha,source_name,created_at,state,bytes) VALUES (?,?,?,?,?)",
                         (digest, source_name[:200], utc_now(), "STAGED", len(raw)))
            conn.commit()
    work = data_dir / "reports" / digest
    work.mkdir(parents=True, exist_ok=True)
    extraction = work / "extraction.json"
    audit = work / "validation.json"
    error = None
    metadata = {}
    state = "VALIDATION_FAILED"
    try:
        p = runner([sys.executable, str(EXTRACTOR), str(original), "--output", str(extraction)])
        if p.returncode != 0:
            raise RuntimeError("PDF_EXTRACT_FAILED: " + p.stderr[-800:])
        meta = json.loads(extraction.read_text(encoding="utf-8"))
        if meta.get("sourceSha256") != digest:
            raise RuntimeError("PDF_HASH_MISMATCH")
        metadata["session"] = meta.get("session")
        v = runner(["node", str(VALIDATOR), str(extraction), str(audit)])
        if not audit.exists():
            raise RuntimeError("VALIDATOR_REPORT_MISSING: " + v.stderr[-800:])
        validation = json.loads(audit.read_text(encoding="utf-8"))
        metadata["validation"] = validation
        # The validator intentionally returns 2 until security master is complete.
        state = "QUARANTINED" if validation.get("errors") else "REVIEW_REQUIRED"
        if v.returncode not in (0, 2):
            raise RuntimeError("VALIDATOR_RUNTIME_ERROR: " + v.stderr[-800:])
    except Exception as exc:
        error = str(exc)[:1500]
    with _LOCK, sqlite3.connect(db) as conn:
        conn.execute("""UPDATE ingests SET state=?,session=?,validation_json=?,error=? WHERE sha=?""",
                     (state, metadata.get("session"),
                      json.dumps(metadata.get("validation")) if metadata.get("validation") else None,
                      error, digest))
        conn.commit()
    record = get_status(db, digest)
    record["duplicate"] = False
    record["published"] = False
    record["certified"] = False
    return record

def create_handler(data_dir, upload_key):
    class Handler(BaseHTTPRequestHandler):
        server_version = "EGXIngestionStaging/0.1"
        def _json(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def _authorized(self):
            supplied = self.headers.get("X-EGX-Upload-Key", "")
            return bool(upload_key) and hmac.compare_digest(upload_key, supplied)
        def do_GET(self):
            if self.path == "/api/health":
                return self._json(200, {"state": "RUNNING", "publicationEnabled": False})
            if not self._authorized():
                return self._json(401, {"error": "UNAUTHORIZED"})
            p = self.path.removeprefix("/api/ingest/")
            if not self.path.startswith("/api/ingest/") or not SHA.fullmatch(p):
                return self._json(404, {"error": "NOT_FOUND"})
            r = get_status(Path(data_dir) / "ingest.sqlite3", p)
            return self._json(200 if r else 404, r or {"error": "NOT_FOUND"})
        def do_POST(self):
            if self.path != "/api/ingest":
                return self._json(404, {"error": "NOT_FOUND"})
            if not self._authorized():
                return self._json(401, {"error": "UNAUTHORIZED"})
            if self.headers.get("Content-Type", "").split(";")[0].lower() != "application/pdf":
                return self._json(415, {"error": "PDF_CONTENT_TYPE_REQUIRED"})
            raw_length = self.headers.get("Content-Length", "")
            if not raw_length.isdecimal():
                return self._json(411, {"error": "CONTENT_LENGTH_REQUIRED"})
            length = int(raw_length)
            if not MIN_BYTES <= length <= MAX_BYTES:
                return self._json(413, {"error": "PDF_SIZE_OUT_OF_RANGE"})
            raw = self.rfile.read(length)
            if len(raw) != length:
                return self._json(400, {"error": "TRUNCATED_BODY"})
            try:
                result = ingest_bytes(raw, "manual_authenticated_upload", data_dir)
            except ValueError as e:
                return self._json(422, {"error": str(e)})
            except Exception:
                return self._json(500, {"error": "STAGING_ERROR"})
            return self._json(202, result)
    return Handler

def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--host", default="127.0.0.1")
    cli.add_argument("--port", type=int, default=8787)
    args = cli.parse_args()
    key = os.environ.get("EGX_UPLOAD_KEY", "")
    if len(key) < 32:
        raise SystemExit("EGX_UPLOAD_KEY must be at least 32 characters")
    if args.host not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("Bind to loopback only; use HTTPS reverse proxy with access control")
    folder = os.environ.get("EGX_DATA_DIR")
    if not folder:
        raise SystemExit("EGX_DATA_DIR must point to persistent private storage")
    init_database(Path(folder) / "ingest.sqlite3")
    server = ThreadingHTTPServer((args.host, args.port), create_handler(folder, key))
    print(f"EGX ingestion staging listening on {args.host}:{args.port}; publish disabled", flush=True)
    server.serve_forever()

if __name__ == "__main__":
    main()
