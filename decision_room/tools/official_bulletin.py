#!/usr/bin/env python3
"""Stage EGX official daily bulletin, verifying date and PDF text layout.

No canonical symbol mapping, database updates or trade recommendations here.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import urllib.request
import urllib.error
import time

from official_bbox import extract_stocks, LayoutError

URL = "https://www.egx.com.eg/en/get_pdf.aspx?Lang=ENG&ID=1022"
class BulletinError(RuntimeError): pass

def parse_pdf(path, expected):
    data = pathlib.Path(path).read_bytes()
    if not data.startswith(b"%PDF-"):
        raise BulletinError("SOURCE_NOT_PDF")
    text = subprocess.check_output(
        ["pdftotext", "-layout", str(path), "-"], text=True, timeout=40)
    expected_display = datetime.date.fromisoformat(expected).strftime("%d/%m/%Y")
    if not re.search(r"Trading Date:\s*" + re.escape(expected_display), text, re.I):
        raise BulletinError("WRONG_SESSION_DATE: expected " + expected_display)
    if "Main Market Stocks Indicators" not in text:
        raise BulletinError("NO_MAIN_STOCK_TABLE")
    try:
        stocks = extract_stocks(path)
    except LayoutError as exc:
        raise BulletinError("LAYOUT_REJECTED: " + str(exc)) from exc
    if len(stocks) < 180:
        raise BulletinError("INSUFFICIENT_PARSE_COVERAGE: " + str(len(stocks)))
    return {
        "session": expected, "source": URL,
        "source_type": "OFFICIAL_EGX_PDF",
        "parser": "GEOMETRIC_NAME_BLOCKS_V2",
        "pdf_sha256": hashlib.sha256(data).hexdigest(),
        "items": stocks, "rows": len(stocks),
        "quarantined": sum(s["status"] != "CANDIDATE" for s in stocks),
        "currency_counts": {c: sum(s["currency"] == c for s in stocks)
                            for c in ("EGP", "USD")},
        "verified_for_trading": False,
    }

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--date", required=True)
    p.add_argument("--pdf")
    p.add_argument("--out", required=True)
    args = p.parse_args()
    date = datetime.date.fromisoformat(args.date)
    if date > datetime.datetime.now(
            datetime.timezone(datetime.timedelta(hours=2))).date():
        raise BulletinError("FUTURE_SESSION")
    pdf = pathlib.Path(args.pdf or "/tmp/egx-latest.pdf")
    if not args.pdf:
        request = urllib.request.Request(
            URL, headers={"User-Agent": "Mozilla/5.0 EGX-PRO-research/1.0"})
        # Retry only transport failures; date/layout/quality checks never retry or relax.
        # Bounded attempts prevent a transient remote disconnect from losing a session.
        body = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=35) as response:
                    body = response.read(15_000_001)
                break
            except (urllib.error.URLError, ConnectionError, TimeoutError,
                    OSError) as exc:
                if attempt == 2:
                    raise BulletinError("OFFICIAL_FETCH_UNAVAILABLE_AFTER_RETRIES") from exc
                time.sleep(2 ** attempt)
        if body is None:
            raise BulletinError("OFFICIAL_FETCH_EMPTY")
        if len(body) > 15_000_000:
            raise BulletinError("PDF_OVERSIZE")
        pdf.write_bytes(body)
    result = parse_pdf(pdf, args.date)
    output = pathlib.Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2),
                      encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "items"}))

if __name__ == "__main__":
    try: main()
    except Exception as exc:
        print("::error::" + type(exc).__name__ + ": " + str(exc), file=sys.stderr)
        sys.exit(2)
