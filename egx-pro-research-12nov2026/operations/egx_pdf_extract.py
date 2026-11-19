"""Extract official EGX bulletin main-market rows with page provenance.
This extractor NEVER certifies ISIN or publishes trading recommendations.
Requires PyMuPDF (pip install pymupdf).
"""
import argparse, hashlib, json, re
from pathlib import Path
import fitz

DATE_RE = re.compile(r"Trading\s+Date\s*:\s*(\d{2})/(\d{2})/(20\d{2})", re.I)
NUM_RE = re.compile(r"^-?\d[\d,]*(?:\.\d+)?$")
COLUMNS = {
    "referencePrice": (230, 284), "high": (286, 333), "low": (335, 385),
    "close": (480, 533), "changePct": (533, 577), "valueTraded": (577, 649),
    "volume": (694, 764)
}

def _number(value):
    if not NUM_RE.fullmatch(value):
        return None
    return float(value.replace(",", ""))

def _extract_page(page, page_no):
    words = page.get_text("words")
    anchors = []
    for x, y, x2, y2, word, *_ in words:
        if not (18 <= x <= 38 and 58 < y < 1065 and re.fullmatch(r"\d{1,3}", word)):
            continue
        currency = next((u[4] for u in words if abs(u[1] - y) < 5 and 180 < u[0] < 225 and u[4] in ("EGP", "USD")), None)
        if currency and not any(abs(a[1] - y) < 1 for a in anchors):
            anchors.append((int(word), y, currency))
    anchors.sort(key=lambda a: a[1])
    rows = []
    for i, (rank, y, currency) in enumerate(anchors):
        prev_y = anchors[i-1][1] if i else y - 33.75
        next_y = anchors[i+1][1] if i+1 < len(anchors) else y + 33.75
        lower, upper = (prev_y + y) / 2, (next_y + y) / 2
        name_words = [w for w in words if 41 <= w[0] < 185 and lower <= w[1] < upper]
        name = " ".join(w[4] for w in sorted(name_words, key=lambda w: (round(w[1]/6),w[0]))).strip()
        row = {"rank": rank, "name": name, "currency": currency, "sourcePage": page_no}
        for key, (x0, x1) in COLUMNS.items():
            items = [w for w in words if x0 <= w[0] < x1 and abs(w[1] - y) < 4.5]
            raw = " ".join(w[4] for w in sorted(items, key=lambda w:w[0]))
            row[key] = _number(raw)
            row[key + "Raw"] = raw
        issues = []
        for col in ("high", "low", "close", "valueTraded", "volume"):
            if row[col] is None or row[col] <= 0:
                issues.append("INVALID_" + col)
        if all(row[k] is not None for k in ("high", "low", "close")):
            if row["high"] < row["low"] or not (row["low"] - 1e-6 <= row["close"] <= row["high"] + 1e-6):
                issues.append("PRICE_RANGE_INCONSISTENT")
        if not name:
            issues.append("MISSING_COMPANY_NAME")
        row["qualityIssues"] = issues
        row["identityVerified"] = False  # report table does not supply ISIN
        rows.append(row)
    return rows

def extract(path):
    data = Path(path).read_bytes()
    if not data.startswith(b"%PDF-"):
        raise ValueError("NOT_PDF")
    pdf = fitz.open(stream=data, filetype="pdf")
    if not 15 <= len(pdf) <= 120:
        raise ValueError("UNEXPECTED_PAGE_COUNT")
    header = " ".join(pdf[i].get_text() for i in range(min(4,len(pdf))))
    dates = set(f"{year}-{month}-{day}" for day, month, year in DATE_RE.findall(header))
    if len(dates) != 1:
        raise ValueError("AMBIGUOUS_SESSION_DATE")
    marker = "Main Market Stocks Indicators sorted by Value Traded"
    pages = [i for i in range(len(pdf)) if marker in pdf[i].get_text()]
    if len(pages) != 1:
        raise ValueError("MAIN_MARKET_TABLE_NOT_UNIQUE")
    start = pages[0]
    rows = []
    for i in range(start, min(start+12, len(pdf))):
        page_rows = _extract_page(pdf[i], i+1)
        if i > start and page_rows and page_rows[0]["rank"] <= rows[-1]["rank"]:
            break
        if i > start and not page_rows:
            break
        rows.extend(page_rows)
    ranks = [r["rank"] for r in rows]
    gaps = sorted(set(range(1,max(ranks,default=0)+1)) - set(ranks))
    duplicates = sorted({n for n in ranks if ranks.count(n)>1})
    invalid = [r["rank"] for r in rows if r["qualityIssues"]]
    sequence_ok = bool(rows) and not gaps and not duplicates and ranks[0]==1 and len(rows)==max(ranks)
    return {
        "schemaVersion":"egx-official-geometry-extraction-v1",
        "session":next(iter(dates)), "sourceSha256":hashlib.sha256(data).hexdigest(),
        "sourcePages":len(pdf), "mainMarketPage":start+1, "totalRows":len(rows),
        "currencyCounts":{c:sum(r["currency"]==c for r in rows) for c in ("EGP","USD")},
        "missingRankNumbers":gaps, "duplicateRanks":duplicates, "invalidPriceRows":invalid,
        "fullTableSequence":sequence_ok, "securitiesVerified":0, "publicationAllowed":False,
        "blockingReasons":["SECURITY_MASTER_AND_ISIN_NOT_VERIFIED"] +
          (["MAIN_TABLE_EXTRACTION_INCOMPLETE"] if not sequence_ok else []) +
          (["PRICE_ROWS_NEED_REVIEW"] if invalid else []),
        "rows":rows
    }

if __name__=="__main__":
    cli=argparse.ArgumentParser()
    cli.add_argument("pdf")
    cli.add_argument("--output")
    args=cli.parse_args()
    result=extract(args.pdf)
    output=json.dumps(result,ensure_ascii=False,indent=2)
    if args.output:
        Path(args.output).write_text(output,encoding="utf-8")
    else:
        print(output)
