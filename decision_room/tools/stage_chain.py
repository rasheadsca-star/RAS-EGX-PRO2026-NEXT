#!/usr/bin/env python3
"""Stage several official bulletins in date order into ONE new staged DB (the source DB is never touched).
usage: stage_chain.py --src-db prod_copy.sqlite --dst-db staged.sqlite --alias alias.json --outdir reports/ SESSION=PDF [SESSION=PDF ...]"""
import argparse,os,pathlib,shutil,sys,tempfile,json
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import stage_official as S
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("src-db","dst-db","alias","outdir")];ap.add_argument("items",nargs="+");a=ap.parse_args(argv)
    if os.path.exists(a.dst_db):sys.exit("dst exists")
    os.makedirs(a.outdir,exist_ok=True);items=sorted(i.split("=",1) for i in a.items);cur=a.src_db;tmp=tempfile.mkdtemp()
    for n,(sess,pdf) in enumerate(items):
        nxt=a.dst_db if n==len(items)-1 else os.path.join(tmp,f"s{n}.sqlite")
        S.main(["--src-db",cur,"--dst-db",nxt,"--pdf",pdf,"--session",sess,"--alias",a.alias,"--report",os.path.join(a.outdir,f"stage_{sess}.json")]);cur=nxt
    shutil.rmtree(tmp)
if __name__=="__main__":main()
