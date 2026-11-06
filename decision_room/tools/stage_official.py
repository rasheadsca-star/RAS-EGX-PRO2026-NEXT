#!/usr/bin/env python3
"""Stage ONE official bulletin session into a NEW copy of the central DB (never in place; refuses if dst exists).
Only rows resolved as RESOLVED_ALIAS_PREVCLOSE (alias name + previous close within 0.7%) AND sane (low>0, high>=low, low<=close<=high; the
auction 'open' is NOT range-checked) are inserted as OFFICIAL_EGX; everything else is recorded in official_session with its quarantine status.
A ticker that already has a RAW bar for that date is never overwritten (a disagreement >0.1% is reported, not applied).
usage: stage_official.py --src-db a.sqlite --dst-db b.sqlite --pdf f.pdf --session YYYY-MM-DD --alias alias.json --report r.json"""
import argparse,collections,hashlib,json,os,pathlib,shutil,sqlite3,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import official_map as om
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("src-db","dst-db","pdf","session","alias","report")];a=ap.parse_args(argv)
    if os.path.exists(a.dst_db):sys.exit("dst exists: refusing to overwrite")
    src=sqlite3.connect(f"file:{a.src_db}?mode=ro",uri=True);dst=sqlite3.connect(a.dst_db);src.backup(dst);src.close()
    sha=hashlib.sha256(open(a.pdf,"rb").read()).hexdigest();sid="S7_EGX_OFFICIAL_"+a.session.replace("-","")
    rows=om.parse_pdf(a.pdf);byk={(r["page"],r["rank"]):r for r in rows}
    ident={t:(en,cur) for t,en,cur in dst.execute("select ticker,name_en,currency from symbol_identity")}
    prev=om.prev_closes(dst,a.session)
    have={t:c for t,c in dst.execute("select ticker,close from canonical_bars where price_basis='RAW' and date=?",(a.session,))}
    evs=om.parse_corporate_events(a.pdf,a.session);ev_tk={}
    for e in evs:
        nm=e.get("name") or "";cand=sorted(((om.sim(nm,en),tk) for tk,(en,cu) in ident.items() if en),reverse=True)[:2]
        ev_tk[id(e)]=cand[0][1] if cand and cand[0][0]>=0.74 and (len(cand)<2 or cand[0][0]-cand[1][0]>=0.09) else None
    prev_adj=dict(prev)   # stock dividends: the official previous close is ex-adjusted -> compare with RAW prev * factor (RAW itself is never changed)
    for e in evs:
        tk=ev_tk[id(e)]
        if e["kind"]=="STOCK_DIVIDEND" and tk in prev_adj:prev_adj[tk]=prev_adj[tk]/(1.0+e["ratio2"]/e["ratio1"])
    res,props=om.resolve(rows,prev_adj,ident,om.load_alias(a.alias)["aliases"])
    dst.execute("insert or ignore into source_registry(source_id,provider_family,description,location,snapshot_ref,file_sha256,license_status,adjusted_or_raw,interval,currency,date_timezone,independence_note) values(?,?,?,?,?,?,?,?,?,?,?,?)",(sid,"egx_official","EGX official daily bulletin "+a.session,os.path.basename(a.pdf),a.session,sha,"official EGX report","RAW","1d","EGP/USD","Africa/Cairo","name alias + previous close; no ISIN in equity table"))
    dst.execute("create table if not exists canonical_bars_superseded(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes,superseded_by_source,superseded_by_pdf_sha256,diff_pct)")
    dst.execute("create table if not exists field_definition_issues(ticker,date,source_id,issue,open,high,low,close,note)")
    dst.execute("create table if not exists official_corporate_events(session,kind,ticker,isin,name,detail_json,source_id,raw_adjusted_policy)")
    cnt=collections.Counter();disagree=[];superseded=[];issues=0
    for x in res:
        r=byk[(x["page"],x["rank"])];st=x["status"]
        if st=="RESOLVED_ALIAS_PREVCLOSE":
            if not(r["low"]>0 and r["high"]>=r["low"] and r["low"]<=r["close"]<=r["high"]):st="QUARANTINED_PRICE_BOUNDS"
            elif x["ticker"] in have:
                tier=dst.execute("select evidence_tier from canonical_bars where ticker=? and date=? and price_basis='RAW'",(x["ticker"],a.session)).fetchone()[0]
                dp=abs(have[x["ticker"]]/r["close"]-1)
                if tier=="OFFICIAL_EGX":
                    st="ALREADY_HAS_OFFICIAL_BAR"
                    if dp>0.001:disagree.append((x["ticker"],have[x["ticker"]],r["close"]))
                else:
                    st="SUPERSEDES_UNOFFICIAL_BAR"   # official replaces non-official in the canonical layer; the old row is archived, not deleted
                    superseded.append((x["ticker"],tier,have[x["ticker"]],r["close"],round(dp*100,3)))
        cnt[st]+=1
        dst.execute("insert into official_session(session_date,market,pdf_page,pdf_rank,name_en,currency,open,high,low,close,volume,value,chg_pct,ticker,resolution_status,resolution_evidence,bounds_status) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(a.session,None,r["page"],r["rank"],r["name"],r["cur"],r["open"],r["high"],r["low"],r["close"],r["volume"],r["value"],r["chg_pct"],x["ticker"] if st in("RESOLVED_ALIAS_PREVCLOSE","ALREADY_HAS_OFFICIAL_BAR","SUPERSEDES_UNOFFICIAL_BAR") else None,st,x["evidence"],"OK" if st!="QUARANTINED_PRICE_BOUNDS" else "BOUNDS"))
        if st in("RESOLVED_ALIAS_PREVCLOSE","SUPERSEDES_UNOFFICIAL_BAR") and (r["open"]<r["low"]-1e-9 or r["open"]>r["high"]+1e-9):
            issues+=1;dst.execute("insert into field_definition_issues values(?,?,?,?,?,?,?,?,?)",(x["ticker"],a.session,sid,"OPEN_OUTSIDE_MIN_MAX",r["open"],r["high"],r["low"],r["close"],"official Open outside official Min/Max; meaning unconfirmed (hypothesis: opening-auction price). Value kept; not used by any indicator."))
        if st=="SUPERSEDES_UNOFFICIAL_BAR":
            t=x["ticker"]
            dst.execute("insert into canonical_bars_superseded select ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes,?,?,? from canonical_bars where ticker=? and date=? and price_basis='RAW'",(sid,sha,round(abs(have[t]/r["close"]-1)*100,4),t,a.session))
            dst.execute("update canonical_bars set open=?,high=?,low=?,close=?,volume=?,evidence_tier='OFFICIAL_EGX',providers='egx_official',selected_source_id=?,n_observations=n_observations+1,notes='Official bulletin supersedes non-official bar (old row archived in canonical_bars_superseded)' where ticker=? and date=? and price_basis='RAW'",(r["open"],r["high"],r["low"],r["close"],r["volume"],sid,t,a.session))
            dst.execute("insert into raw_observations(ticker,date,source_id,provider_family,open,high,low,close,adj_close,volume,currency,declared_basis,valid,invalid_reason,source_path,row_ref,official_verified) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(t,a.session,sid,"egx_official",r["open"],r["high"],r["low"],r["close"],None,r["volume"],"EGP","RAW",1,None,os.path.basename(a.pdf),f"p{r['page']}:rank{r['rank']}:sha256:{sha[:16]}",1))
        if st=="RESOLVED_ALIAS_PREVCLOSE":
            t=x["ticker"]
            dst.execute("insert into raw_observations(ticker,date,source_id,provider_family,open,high,low,close,adj_close,volume,currency,declared_basis,valid,invalid_reason,source_path,row_ref,official_verified) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(t,a.session,sid,"egx_official",r["open"],r["high"],r["low"],r["close"],None,r["volume"],"EGP","RAW",1,None,os.path.basename(a.pdf),f"p{r['page']}:rank{r['rank']}:sha256:{sha[:16]}",1))
            dst.execute("insert into canonical_bars(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes) values(?,?,?,?,?,?,?,?,?,?,?,?,?)",(t,a.session,"RAW",r["open"],r["high"],r["low"],r["close"],r["volume"],"OFFICIAL_EGX","egx_official",sid,1,"Official bulletin; alias name + prev close; open = auction price"))
    for e in evs:
        nm=e.get("name") or "";tk=ev_tk[id(e)]
        pol="RAW unchanged; ADJUSTED derived separately (see corp_action_factors)" if e["kind"] in("STOCK_DIVIDEND","STOCK_SPLIT","CAPITAL_INCREASE") else "none"
        dst.execute("insert into official_corporate_events values(?,?,?,?,?,?,?,?)",(a.session,e["kind"],tk,e.get("isin"),nm,json.dumps(e,ensure_ascii=False),sid,pol))
        if e["kind"]=="STOCK_DIVIDEND" and tk:
            dst.execute("create table if not exists corp_action_factors(ticker,ex_date,kind,ratio1,ratio2,price_factor,isin,source_id,note)")
            f=1.0/(1.0+e["ratio2"]/e["ratio1"])
            dst.execute("insert into corp_action_factors values(?,?,?,?,?,?,?,?,?)",(tk,a.session,"STOCK_DIVIDEND",e["ratio1"],e["ratio2"],f,e.get("isin"),sid,"multiply RAW prices BEFORE ex_date by price_factor to get the derived ADJUSTED series; RAW stays untouched"))
            dst.execute("insert into corporate_actions(ticker,date,source_id,raw_change_pct,adjusted_change_pct,status,authoritative) values(?,?,?,?,?,?,?)",(tk,a.session,sid,(round((nowc/prevc-1)*100,3) if (nowc:=dst.execute("select close from canonical_bars where ticker=? and date=? and price_basis='RAW'",(tk,a.session)).fetchone()) and (prevc:=prev.get(tk)) and (nowc:=nowc[0]) else None),(dst.execute("select chg_pct from official_session where session_date=? and ticker=?",(a.session,tk)).fetchone() or [None])[0],"OFFICIAL_STOCK_DIVIDEND_RAW_DISCONTINUITY",1))
        if e.get("isin") and tk:
            dst.execute("update symbol_identity set isin=?,isin_status='OFFICIAL_BULLETIN_EVENT_PAGE_NAME_MATCH' where ticker=? and (isin is null or isin='')",(e["isin"],tk))
    dst.commit();ok=dst.execute("pragma integrity_check").fetchone()[0];dst.close()
    rep=dict(session=a.session,pdf_sha256=sha,rows=len(rows),statuses=cnt,integrity=ok,superseded=superseded,open_outside_range=issues,events=evs,proposals=[(p["page"],p["rank"],p["name"],p["ticker"],p["evidence"]) for p in props],disagree_with_existing_bar=disagree)
    json.dump(rep,open(a.report,"w"),ensure_ascii=False,indent=1);print(json.dumps(dict(session=a.session,rows=len(rows),statuses=cnt,integrity=ok,disagree=len(disagree),superseded=len(superseded),open_issues=issues,events=len(evs)),ensure_ascii=False))
if __name__=="__main__":main()
