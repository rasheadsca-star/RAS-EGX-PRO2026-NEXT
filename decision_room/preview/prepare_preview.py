#!/usr/bin/env python3
"""Build a Vercel-deployable static folder from <public>/current (a SYMLINK to a release dir).
 * resolves the symlink (copies real files, never links - Vercel uploads do not follow links reliably)
 * verifies MANIFEST sha256 of every file, requires job_health.status == OK and that health.serving == the release being copied
 * refuses output containing symlinks or files not listed in the manifest (only vercel.json/PREVIEW.txt are added)
 * writes vercel.json with no-store + noindex headers (preview only, never indexed)
 * never touches any other Vercel project: it only writes the output folder. Linking to the project `egx-pro-decision-preview` happens in CI
   with secrets (see .github/workflows/decision-room-daily.yml); this script holds no credentials.
usage: prepare_preview.py --public <dir> --out <dist>"""
import argparse,json,os,sys,hashlib,pathlib,shutil
PROJECT="egx-pro-decision-preview"
VERCEL={"cleanUrls":True,"trailingSlash":False,"headers":[{"source":"/(.*)","headers":[
  {"key":"Cache-Control","value":"no-store"},{"key":"X-Robots-Tag","value":"noindex, nofollow"},{"key":"X-Content-Type-Options","value":"nosniff"},{"key":"Referrer-Policy","value":"no-referrer"}]}]}
class PreviewError(RuntimeError):pass
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def prepare(public,out):
    public=pathlib.Path(public);out=pathlib.Path(out)
    cur=public/"current"
    if not cur.exists():raise PreviewError("no current release to deploy")
    real=pathlib.Path(os.path.realpath(cur))
    if not (real/"MANIFEST.json").exists():raise PreviewError("release has no MANIFEST.json")
    try:h=json.loads((public/"job_health.json").read_text(encoding="utf-8"))
    except Exception as e:raise PreviewError(f"job_health.json unreadable: {e}")
    if h.get("status")!="OK":raise PreviewError(f"last daily job status is {h.get('status')!r}, not OK; not deploying")
    m=json.loads((real/"MANIFEST.json").read_text(encoding="utf-8"))
    if h.get("serving")!=real.name or m.get("release")!=real.name:raise PreviewError("health.serving / manifest do not match the current release")
    for name,hh in m["files"].items():
        if sha(real/name)!=hh:raise PreviewError(f"hash mismatch {name}")
    if out.exists():shutil.rmtree(out)
    out.mkdir(parents=True)
    for name in m["files"]:shutil.copyfile(real/name,out/name)             # real files only
    (out/"vercel.json").write_text(json.dumps(VERCEL,indent=1),encoding="utf-8")
    (out/"PREVIEW.txt").write_text(f"EGX PRO decision-room RESEARCH PREVIEW. project={PROJECT}. release={real.name}. NO_STRATEGY_APPROVED. Not investment advice; no orders.\n",encoding="utf-8")
    extra=[str(p) for p in out.rglob("*") if p.is_symlink()]
    if extra:raise PreviewError(f"symlinks in output: {extra}")
    allowed=set(m["files"])|{"vercel.json","PREVIEW.txt"}
    unknown=[p.name for p in out.iterdir() if p.name not in allowed]
    if unknown:raise PreviewError(f"unexpected files: {unknown}")
    return dict(project=PROJECT,release=real.name,files=sorted(allowed),source_session=h.get("source_session"))
def main(argv=None):
    ap=argparse.ArgumentParser();ap.add_argument("--public",required=True);ap.add_argument("--out",required=True);x=ap.parse_args(argv)
    try:r=prepare(x.public,x.out);print(json.dumps(r,ensure_ascii=False));return 0
    except BaseException as e:
        print(json.dumps(dict(status="FAILED",error=f"{type(e).__name__}: {e}"),ensure_ascii=False));return 2
if __name__=="__main__":sys.exit(main())
