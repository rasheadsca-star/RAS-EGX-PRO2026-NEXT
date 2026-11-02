#!/usr/bin/env python3
"""Single-command EGX research pipeline (no production DB writes, no live deploy).

PDF -> parse -> quality -> provisional symbol mapping -> SQLite staged merge ->
snapshot -> full local decision-room release -> local manifest verification.
Missing current official PDF or any failed gate stops publication.
"""
import argparse,datetime,hashlib,json,os,shutil,sqlite3,subprocess,sys
from pathlib import Path
from official_bulletin import parse_pdf
from official_quality import inspect
from official_resolver import resolve
from official_atomic_merge import merge,sha

class PipelineError(RuntimeError):pass
def run(pdf,db,session,previous_session,out):
    pdf,db,out=Path(pdf).resolve(),Path(db).resolve(),Path(out).resolve()
    if not pdf.is_file() or not db.is_file():raise PipelineError("PDF_OR_DB_UNAVAILABLE")
    out.mkdir(parents=True,exist_ok=True)
    if out==db.parent or db.is_relative_to(out):raise PipelineError("OUTPUT_OVERLAPS_SOURCE_DB")
    input_sha=sha(db);pdf_sha=sha(pdf)
    bulletin=parse_pdf(pdf,session)
    if bulletin.get("pdf_sha256")!=pdf_sha or bulletin.get("session")!=session:
        raise PipelineError("SOURCE_DATE_OR_HASH_MISMATCH")
    staged=out/"official_bulletin.json"
    staged.write_text(json.dumps(bulletin,ensure_ascii=False,indent=2),encoding="utf-8")
    check=inspect(bulletin)
    (out/"official_quality.json").write_text(json.dumps(check,ensure_ascii=False,indent=2),encoding="utf-8")
    if not check["ok"]:raise PipelineError("OFFICIAL_SOURCE_QUALITY_FAILED:"+str(check["errors"][:10]))
    base=out/"central_research.sqlite"
    if base.exists():raise PipelineError("RESEARCH_DESTINATION_EXISTS: choose fresh output")
    source=sqlite3.connect("file:"+str(db)+"?mode=ro",uri=True)
    dest=sqlite3.connect(base)
    try:source.backup(dest)
    finally:source.close();dest.close()
    try:
        mapped=resolve(bulletin["items"],base,previous_session,pdf_sha)
        mapped_path=out/"symbol_resolution.json"
        mapped_path.write_text(json.dumps(mapped,ensure_ascii=False,indent=2),encoding="utf-8")
        if mapped["summary"]["provisional"]<1:raise PipelineError("NO_SAFE_CANDIDATE_MAPPINGS")
        merged=merge(base,pdf,mapped_path,session,research_allow_provisional=True)
        (out/"merge_report.json").write_text(json.dumps(merged,indent=2),encoding="utf-8")
        engine=Path(__file__).resolve().parents[1]/"run_daily.py"
        result=subprocess.run([sys.executable,str(engine),"--db",str(base),
            "--out",str(out/"decision_room"),"--now",session+"T18:30:00+02:00"],
            text=True,capture_output=True,timeout=180)
        if result.returncode:
            raise PipelineError("DECISION_ENGINE_FAILED:"+result.stderr[-1000:])
        health=json.loads((out/"decision_room"/"job_health.json").read_text())
        if health.get("status")!="OK" or health.get("source_session")!=session:
            raise PipelineError("ENGINE_OUTPUT_SESSION_OR_HEALTH_FAILED")
        current=(out/"decision_room"/"current").resolve()
        snapshot=json.loads((current/"decision_snapshot.json").read_text())
        if snapshot.get("source_session")!=session or snapshot.get("content_sha256")!=health["content_sha256"]:
            raise PipelineError("SNAPSHOT_SOURCE_OR_HASH_MISMATCH")
        if not (current/"index.html").is_file():raise PipelineError("MISSING_FULL_DECISION_ROOM")
        if sha(db)!=input_sha:raise PipelineError("INPUT_DB_MODIFIED")
        evidence=dict(status="RESEARCH_ONLY",approved_for_paper_automation=False,
            approved_for_trading=False,source_session=session,pdf_sha256=pdf_sha,
            original_db_sha256=input_sha,untouched_original=sha(db)==input_sha,
            research_db_sha256=sha(base),matched_provisional=mapped["summary"]["provisional"],
            unresolved=len(mapped["items"])-mapped["summary"]["provisional"],
            snapshot_sha256=snapshot["content_sha256"],generated_release=health.get("release"),
            engine_status=health["status"],market_state=health.get("market_state"))
        (out/"evidence.json").write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding="utf-8")
        return evidence
    except BaseException:
        # Never disguise an interrupted run as a verified, publishable snapshot.
        (out/"FAILED_RESEARCH_RUN").write_text("Research run failed: check logs; never promote this output.")
        raise
def main():
    p=argparse.ArgumentParser()
    for k in ("pdf","db","session","previous-session","out"):
        p.add_argument("--"+k,required=True)
    a=p.parse_args()
    try:
        print(json.dumps(run(a.pdf,a.db,a.session,a.previous_session,a.out),ensure_ascii=False))
    except Exception as exc:
        print("::error::"+type(exc).__name__+": "+str(exc),file=sys.stderr)
        raise SystemExit(2)
if __name__=="__main__":main()
