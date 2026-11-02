"""Coordinate-based parser for EGX official daily STOCK tables.

The bulletin puts wrapped company names above and below the numeric row.
Extract names from PDF text blocks, not adjacent pdftotext lines. Never infer
ticker from name; this parser supplies UNVERIFIED source rows only.
Requires PyMuPDF (fitz). Layout coordinates are intentionally strict:
unexpected layouts fail closed instead of silently shifting price columns.
"""
import collections
import math
import re

import fitz

class LayoutError(ValueError):
    pass

# These are right-aligned text coordinates in the 1539 x 1088 EGX
# landscape table layout. They are checked per cell (not guessed by order).
SME_EDGES = (233.5,270.7,308,352,395,439,473.7,541,582.3,649.5,693.4)
MAIN_EDGES = (277.4,321.4,375,419,463,524,558,642,684,758,802)
# Earlier official EGX bulletin uses a narrower page, and shifted selected
# main-market numeric columns even though left company/currency coordinates
# are unchanged. Recovered from verified Nov 1 and Nov 2 source PDFs.
MAIN_EDGES_1525 = (277.4,331.4,375.4,419.3,463.2,523.9,561.1,635.1,669.7,743.7,787.6)
KNOWN_SIZES = ((1539,1088),(1525,1078))
FIELDS = ("open","high","low","high52","low52","close","chg_pct",
          "value","pct_total","volume","trades")

def _to_num(s):
    return float(s.replace(",", ""))

def _single(words, right, y):
    matches = [w for w in words if abs(w[2]-right) < 2.0
               and abs(w[1]-y) < 1 and w[0] > 190]
    if len(matches) > 1:
        raise LayoutError("AMBIGUOUS_NUMERIC_COLUMN")
    return matches[0][4] if matches else ""

def extract_stocks(pdf):
    """Return raw stock rows. No ticker mapping, DB writes or approval."""
    doc = fitz.open(str(pdf))
    items = []
    try:
        for ip, page in enumerate(doc):
            if not any(abs(page.rect.width-w)<2 and abs(page.rect.height-h)<2
                       for w,h in KNOWN_SIZES):
                continue
            words = page.get_text("words", sort=False)
            coord = collections.Counter(round(w[0]) for w in words
                                         if w[4] in ("EGP","USD") and w[1] > 50)
            sme = coord[165] >= 4
            main = coord[192] >= 4
            if not sme and not main:
                continue
            if sme and main:
                raise LayoutError("AMBIGUOUS_STOCK_TABLE_LAYOUT")
            currency_x = 164.9 if sme else 192.2
            rank_x = 55.6 if sme else (30.3 if ip == 16 else 24.3)
            right_edges = SME_EDGES if sme else (MAIN_EDGES if page.rect.width>1530 else MAIN_EDGES_1525)
            candidates = sorted((w for w in words if w[4] in ("EGP","USD")
                                  and abs(w[0]-currency_x) < 1 and w[1] > 50),
                                key=lambda w: w[1])
            anchors = []
            for w in candidates:
                ranks = [q for q in words if q[4].isdigit() and q[0] < 75
                         and abs(q[1]-w[1]) < 1 and abs(q[0]-rank_x) < 12]
                if len(ranks) != 1:
                    raise LayoutError("MISSING_OR_AMBIGUOUS_RANK_PAGE_%d" % (ip+1))
                anchors.append((int(ranks[0][4]), w))
            blocks = collections.defaultdict(list)
            for w in words:
                blocks[w[5]].append(w)
            names = collections.defaultdict(list)
            for block in blocks.values():
                min_x = 73 if sme else 42
                name_words = [w for w in block if w[0] >= min_x
                              and w[2] < currency_x - 3]
                if not name_words:
                    continue
                if {"Stock","Name"}.issubset({w[4] for w in name_words}):
                    continue
                ymid = (min(w[1] for w in name_words)
                        + max(w[3] for w in name_words)) / 2
                rank, anchor = min(anchors,
                                   key=lambda a: abs((a[1][1]+a[1][3])/2-ymid))
                if abs((anchor[1]+anchor[3])/2-ymid) > 45:
                    continue
                lines = collections.defaultdict(list)
                for w in name_words:
                    lines[round(w[1],1)].append(w)
                text = " ".join(" ".join(w[4] for w in sorted(lines[y],
                                        key=lambda x:x[0])) for y in sorted(lines))
                names[rank].append((min(w[1] for w in name_words), text))
            for rank, currency in anchors:
                vals = dict(zip(FIELDS, (_single(words, edge, currency[1])
                                           for edge in right_edges)))
                name = " ".join(s for _,s in sorted(names[rank])).strip()
                if not name or any(not vals[k] for k in
                        ("open","high","low","close","chg_pct","value","volume","trades")):
                    raise LayoutError("INCOMPLETE_ROW_PAGE_%d_RANK_%d" % (ip+1,rank))
                try:
                    rec = {"page":ip+1, "rank":rank,
                           "market":"SME" if sme else "MAIN",
                           "name":name, "currency":currency[4],
                           "open":_to_num(vals["open"]),
                           "high":_to_num(vals["high"]),
                           "low":_to_num(vals["low"]),
                           "close":_to_num(vals["close"]),
                           "chg_pct":_to_num(vals["chg_pct"]),
                           "value_traded":_to_num(vals["value"]),
                           "volume":int(vals["volume"].replace(",","")),
                           "trades":int(vals["trades"].replace(",",""))}
                except ValueError as e:
                    raise LayoutError("INVALID_ROW_PAGE_%d_RANK_%d" % (ip+1,rank)) from e
                for f in ("open","high","low","close","chg_pct","value_traded"):
                    if not math.isfinite(rec[f]):
                        raise LayoutError("NONFINITE_ROW_PAGE_%d_RANK_%d" % (ip+1,rank))
                if rec["volume"] < 0 or rec["trades"] < 0:
                    raise LayoutError("NEGATIVE_VOLUME_OR_TRADES")
                rec["value_egp"] = rec["value_traded"] if rec["currency"] == "EGP" else None
                rec["status"] = ("CANDIDATE" if
                    rec["low"] <= min(rec["open"],rec["close"]) and
                    rec["high"] >= max(rec["open"],rec["close"]) and
                    rec["low"] > 0 else "CHECK")
                rec["reason"] = None if rec["status"] == "CANDIDATE" else "INCONSISTENT_OHLC"
                items.append(rec)
        if not items:
            raise LayoutError("NO_STOCK_TABLE_ROWS")
        if len({(r["market"],r["rank"]) for r in items}) != len(items):
            raise LayoutError("DUPLICATE_RANK_IN_MARKET")
        return items
    finally:
        doc.close()
