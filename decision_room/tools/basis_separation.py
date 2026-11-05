#!/usr/bin/env python3
"""RAW vs ADJUSTED separation audit (read-only). Fails (exit 1) if: a non-RAW basis is mixed into a RAW row's source; any ADJUSTED row is authoritative/official; any official-tier bar
sits outside RAW; (info only) vendor-adjusted bars for tickers that have an OFFICIAL corp_action_factor are counted but stay NON_AUTHORITATIVE; the engine/gates/walk-forward read a basis other than RAW.
usage: basis_separation.py --db staged.sqlite [--out r.json]"""
import argparse,json,pathlib,re,sqlite3,sys
HERE=pathlib.Path(__file__).resolve().parent
def main(argv=None):
    ap=argparse.ArgumentParser();ap.add_argument("--db",required=True);ap.add_argument("--out");a=ap.parse_args(argv)
    c=sqlite3.connect(f"file:{a.db}?mode=ro",uri=True);g=lambda q:c.execute(q).fetchall();r={}
    r["bars_by_basis_tier"]=g("select price_basis,evidence_tier,count(*) from canonical_bars group by 1,2")
    r["adjusted_rows_official_or_authoritative"]=g("select count(*) from canonical_bars where price_basis<>'RAW' and evidence_tier in('OFFICIAL_EGX','CORROBORATED_2_PROVIDERS','SINGLE_PROVIDER')")[0][0]
    r["official_bars_outside_raw"]=g("select count(*) from canonical_bars where evidence_tier='OFFICIAL_EGX' and price_basis<>'RAW'")[0][0]
    r["raw_rows_from_adjusted_sources"]=g("select count(*) from canonical_bars where price_basis='RAW' and (selected_source_id like '%ADJ%' or evidence_tier like 'ADJ%')")[0][0]
    r["raw_observations_declared_adjusted_but_valid_in_raw_bars"]=g("select count(*) from canonical_bars b join raw_observations o on o.ticker=b.ticker and o.date=b.date and o.source_id=b.selected_source_id where b.price_basis='RAW' and upper(o.declared_basis)<>'RAW'")[0][0]
    r["adjusted_tickers"]=g("select count(distinct ticker) from canonical_bars where price_basis<>'RAW'")[0][0]
    r["official_factor_tickers"]=[x[0] for x in g("select ticker from corp_action_factors")]
    r["info_nonauthoritative_adjusted_bars_for_official_factor_tickers"]=g("select count(*) from canonical_bars where price_basis<>'RAW' and ticker in(select ticker from corp_action_factors)")[0][0]
    # code audit: every read of canonical_bars in engine / tools that feed gates, ranking or tests must filter price_basis='RAW'
    bad=[]
    for p in list((HERE.parent/"egx_decision").glob("*.py"))+[HERE/"walkforward.py",HERE/"strategy_holdout.py",HERE/"build_phase_outputs.py",HERE/"gap_matrix.py",HERE/"provider_dependence.py"]:
        for i,l in enumerate(p.read_text().splitlines(),1):
            if re.search(r"from\s+canonical_bars",l) and "price_basis" not in l and "superseded" not in l:bad.append(f"{p.name}:{i}")
    r["unfiltered_canonical_bars_reads_in_gate_code"]=bad
    r["pass"]=all([r["adjusted_rows_official_or_authoritative"]==0,r["official_bars_outside_raw"]==0,r["raw_rows_from_adjusted_sources"]==0,r["raw_observations_declared_adjusted_but_valid_in_raw_bars"]==0,not bad])
    if a.out:json.dump(r,open(a.out,"w"),indent=1)
    print(json.dumps(r));return 0 if r["pass"] else 1
if __name__=="__main__":sys.exit(main())
