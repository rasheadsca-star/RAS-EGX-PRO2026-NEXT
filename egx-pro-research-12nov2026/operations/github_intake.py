"""Process official public bulletins on a standard GitHub runner."""
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fetch_official import DEFAULT_URL, fetch
from ingest_service import ingest_bytes


def main():
    data = Path(os.environ["EGX_DATA_DIR"])
    summary = Path(os.environ["GITHUB_STEP_SUMMARY"])
    failures = []

    def record(path, source):
        result = ingest_bytes(path.read_bytes(), source, data)
        state = result["state"]
        with summary.open("a") as out:
            print(f"- {result.get('session')} | {state} | {result['sha']}", file=out)
        if state not in {"QUARANTINED", "REVIEW_REQUIRED"}:
            failures.append("Extraction or validation process failed")

    for path in sorted(Path("egx-official-inbox").glob("*.pdf")):
        try:
            record(path, "manual_repository_upload")
        except Exception as error:
            failures.append(str(error))

    if os.environ["GITHUB_EVENT_NAME"] != "push":
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "latest.pdf"
            try:
                meta = fetch(DEFAULT_URL, pdf)
                today = datetime.now(ZoneInfo("Africa/Cairo")).date().isoformat()
                if meta["session"] != today:
                    raise ValueError("Bulletin is not for the current Cairo session")
                record(pdf, "automatic_official_fetch")
            except Exception as error:
                failures.append("UPLOAD_REQUIRED: " + str(error))

    with summary.open("a") as out:
        print("\nOfficial public PDF manual upload: "
              "https://github.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/upload/main/egx-official-inbox", file=out)
        for failure in failures:
            print("- " + failure, file=out)
    return int(bool(failures))


if __name__ == "__main__":
    sys.exit(main())
