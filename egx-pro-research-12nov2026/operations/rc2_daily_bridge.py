"""Stage the locally published paper session into RC2 history in a clean checkout.

Run with the session PDF after publishing the paper ledger, then review and commit
the generated data/history, history-summary and session-calendar changes together.
Requires pdftotext, PyMuPDF and Node.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
from urllib.request import Request, urlopen

from egx_pdf_extract import extract


def bulletin_rows(pdf, extraction):
    rows = extraction["rows"]
    layout = subprocess.check_output([
        "pdftotext", "-layout", "-f", str(rows[0]["sourcePage"]), "-l",
        str(rows[-1]["sourcePage"]), str(pdf), "-",
    ], text=True)
    pattern = r"^\s*(\d+)\s+.*?\b(EGP|USD)\s+([\d., -]+?)\s+[\d.]+%\s+([\d,]+)"
    result = {}
    for line in layout.splitlines():
        match = re.match(pattern, line)
        if not match:
            continue
        rank = int(match[1])
        row = rows[len(result)]
        if rank != len(result) + 1 or row["rank"] != rank or row["currency"] != match[2]:
            raise ValueError("Bulletin sequence or currency mismatch")
        reference, high, low, _, _, close, change, value = [
            float(n.replace(",", "")) for n in match[3].split()
        ]
        if reference <= 0 or abs((close/reference-1)*100-change) > 0.025:
            raise ValueError(f"Reference price mismatch, row {rank}")
        result[rank] = dict(name=row["name"], currency=row["currency"], page=row["sourcePage"],
                            reference=reference, high=high, low=low, close=close, value=value,
                            volume=int(match[4].replace(",", "")))
    if len(result) != len(rows) or not extraction["fullTableSequence"]:
        raise ValueError("Incomplete bulletin")
    return result


def market_quotes(symbols):
    columns = ["name", "time", "open", "high", "low", "close", "volume"]
    body = {"symbols": {"tickers": ["EGX:"+s for s in symbols], "query": {"types": []}},
            "columns": columns, "range": [0, len(symbols)]}
    request = Request("https://scanner.tradingview.com/egypt/scan",
                      data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)["data"]


def stage(repo, pdf):
    ledger = json.loads((repo/"paper-v4/breadth-forward.json").read_text())["sessions"]
    latest = ledger[-1]
    result = extract(str(pdf))
    date = result["session"]
    if date != latest["sourceDate"] or result["sourceSha256"] != latest["sourceSha256"]:
        raise ValueError("PDF does not match the published paper session")
    summary = json.loads((repo/"data/history-summary.json").read_text())
    if summary["latestMarketSession"] > date:
        raise ValueError("Refusing to import an older session")
    if summary["latestMarketSession"] == date:
        print(f"{date}: RC2 history already contains this session")
        return
    previous = ledger[-2]["sourceDate"]
    if ledger[-2]["tradeDate"] != date:
        raise ValueError("Previous session is missing")
    rows = bulletin_rows(pdf, result)
    docs = {}
    for path in (repo/"data/history").glob("*.json"):
        doc = json.loads(path.read_text())
        if (doc.get("lastSession") == previous and doc.get("symbolVerified")
                and not doc.get("staleData") and not doc.get("updateFailed")
                and doc.get("currency") == "EGP" and doc.get("availableSessions", 0) >= 60):
            docs[doc["ticker"]] = (path, doc)
    if not docs:
        raise ValueError("No histories eligible to advance from the previous session")
    normalize = lambda name: re.sub(r"[^a-z0-9]", "", name.lower())
    identities = {}
    master = repo/"astra-prod/app/intelligence/market-universe.json"
    for record in json.loads(master.read_text())["records"]:
        for name in [record.get("companyNameEn"), *record["aliases"]]:
            if name and normalize(name):
                identities.setdefault(normalize(name), set()).add(record["ticker"])
    staged = {}
    now = datetime.now(timezone.utc).isoformat()
    for item in market_quotes(docs):
        symbol, stamp, opening, high, low, close, volume = item["d"]
        if (symbol not in docs or item["s"] != "EGX:"+symbol or not stamp or
                datetime.fromtimestamp(stamp, timezone.utc).date().isoformat() != date):
            continue
        if not all(isinstance(x, (int, float)) and x > 0 for x in [opening, high, low, close, volume]):
            continue
        path, doc = docs[symbol]
        matches = [r for r in rows.values() if r["currency"] == "EGP"
                   and identities.get(normalize(r["name"])) == {symbol}
                   and r["volume"] == volume and r["value"] > 0
                   and abs(r["reference"]-doc["sessions"][-1]["close"]) < .005
                   and all(abs(r[k]-v) < .00005 for k,v in
                           [("high",high),("low",low),("close",close)])]
        if len(matches) != 1 or not high >= max(opening,close) >= min(opening,close) >= low:
            continue
        row = matches[0]
        bar = dict(date=date, sessionDate=date, open=opening, high=row["high"], low=row["low"],
                   close=row["close"], volume=volume, valueTraded=row["value"], turnover=row["value"],
                   source="egx_bulletin_crosschecked_tradingview", sourcePage=row["page"],
                   sourceName=row["name"], sourceSha256=result["sourceSha256"], fetchedAt=now)
        if any(b.get("date") == date for b in doc["sessions"]):
            raise ValueError(f"Duplicate session for {symbol}")
        doc["sessions"].append(bar)
        doc.update(lastSession=date, sessionsCount=len(doc["sessions"]),
                   availableSessions=len(doc["sessions"]), generatedAt=now, updatedAt=now,
                   lastUpdateSource=bar["source"], officiallyVerifiedLatestSession=False)
        staged[path] = doc
    if not staged:
        raise ValueError("No reconciled histories to publish")
    for path, doc in staged.items():
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2)+"\n")
    subprocess.run(["node", "scripts/history/history-summary-builder.cjs"], cwd=repo, check=True)
    print(f"{date}: advanced {len(staged)} of {len(docs)} eligible prior histories")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("pdf", type=Path)
    stage(Path(__file__).resolve().parents[2], cli.parse_args().pdf)
