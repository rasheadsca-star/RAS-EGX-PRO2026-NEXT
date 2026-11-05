#!/usr/bin/env python3
"""Fail-closed HTTP verification of an actually served EGX PRO research preview.

A READY Vercel deployment does not prove that deployed HTML and JSON match
the same source session and content SHA. Does not deploy or mutate resources.
"""
import argparse
import datetime
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

MAX_BYTES = 12_000_000

class VerificationError(RuntimeError):
    pass

class EmbeddedSnapshot(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.inside = False
        self.captured = []
        self.found = 0
    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script" and dict(attrs).get("id") == "payload":
            self.inside = True
            self.found += 1
    def handle_data(self, data):
        if self.inside:
            self.captured.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "script":
            self.inside = False
    def snapshot(self):
        if self.found != 1:
            raise VerificationError("EMBEDDED_SNAPSHOT_NOT_EXACTLY_ONE")
        try:
            return json.loads("".join(self.captured))
        except (ValueError, TypeError) as exc:
            raise VerificationError("INVALID_EMBEDDED_SNAPSHOT") from exc

def fetch(base, name):
    # Root avoids a redirect from index.html on Vercel cleanUrls deployments.
    url = base.rstrip("/") + "/" + name
    req = urllib.request.Request(url, headers={
        "User-Agent": "EGX-PRO-Research-Verifier/1.0",
        "Accept-Encoding": "identity", "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            if response.geturl().split("?", 1)[0] != url:
                raise VerificationError("UNEXPECTED_HTTP_REDIRECT:" + name)
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise VerificationError("OVERSIZE_RESPONSE:" + name)
            return data
    except urllib.error.HTTPError as exc:
        raise VerificationError("HTTP_ERROR_%s:%s" % (exc.code, name)) from exc
    except urllib.error.URLError as exc:
        raise VerificationError("NETWORK_ERROR:" + name) from exc

def verify(url, expected_session, expected_sha, manifest_path=None):
    parsed = urllib.parse.urlsplit(url)
    if (not parsed.hostname or parsed.username or parsed.password or
        parsed.query or parsed.fragment or parsed.path not in ("", "/")):
        raise VerificationError("INVALID_BASE_URL")
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")
    ):
        raise VerificationError("HTTPS_REQUIRED")
    try:
        datetime.date.fromisoformat(expected_session)
    except (TypeError, ValueError) as exc:
        raise VerificationError("INVALID_EXPECTED_SESSION") from exc
    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha or ""):
        raise VerificationError("INVALID_EXPECTED_SHA256")
    raw_html = fetch(url, "")
    raw_json = fetch(url, "decision_snapshot.json")
    try:
        page = raw_html.decode("utf-8")
        s = json.loads(raw_json.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise VerificationError("INVALID_HTML_OR_JSON") from exc
    p = EmbeddedSnapshot()
    p.feed(page)
    embedded = p.snapshot()
    for label, obj in (("JSON", s), ("HTML", embedded)):
        if obj.get("source_session") != expected_session:
            raise VerificationError("%s_SESSION_MISMATCH" % label)
        if obj.get("content_sha256") != expected_sha:
            raise VerificationError("%s_HASH_MISMATCH" % label)
    if embedded != s:
        raise VerificationError("HTML_JSON_PAYLOAD_DIFFERENCE")
    if "NO_STRATEGY_APPROVED" not in page:
        raise VerificationError("RESEARCH_ONLY_BANNER_MISSING")
    manifest = None
    if manifest_path:
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        values = manifest.get("files", {})
        for name, raw in (("index.html", raw_html), ("decision_snapshot.json", raw_json)):
            if hashlib.sha256(raw).hexdigest() != values.get(name):
                raise VerificationError("SERVED_FILE_SHA_MISMATCH:" + name)
    return {
        "status": "VERIFIED_RESEARCH_PREVIEW", "url": url,
        "source_session": expected_session, "content_sha256": expected_sha,
        "http_html_sha256": hashlib.sha256(raw_html).hexdigest(),
        "http_json_sha256": hashlib.sha256(raw_json).hexdigest(),
        "manifest_verified": manifest is not None, "strategy_approved": False}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--session", required=True)
    p.add_argument("--sha256", required=True)
    p.add_argument("--manifest")
    p.add_argument("--out")
    a = p.parse_args()
    try:
        report = verify(a.url, a.session, a.sha256, a.manifest)
    except Exception as exc:
        report = {"status": "FAILED", "reason": "%s:%s" % (type(exc).__name__, exc),
                  "expected_session": a.session, "expected_sha256": a.sha256}
    if a.out:
        Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    if report["status"] == "FAILED":
        raise SystemExit(2)

if __name__ == "__main__":
    main()
