#!/usr/bin/env python3
"""Reproducible tracked-file backup archive with portable derived SQLite and SHA256 manifests.
Never includes .git, private dotenv/keys or unpublished private production databases.
"""
from pathlib import Path
import argparse,datetime,hashlib,json,os,subprocess,zipfile
def sha(b):return hashlib.sha256(b).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',default='.');p.add_argument('--output',required=True);p.add_argument('--sqlite',required=True);a=p.parse_args()
 root=Path(a.root).resolve();out=Path(a.output).resolve();db=Path(a.sqlite).resolve()
 files=subprocess.check_output(['git','-C',str(root),'ls-files','-z']).split(b'\0')
 entries=[];excluded=[];size=0;MAX_FILE=32*1024*1024;MAX_TOTAL=600*1024*1024
 deny_tokens=('.env','secrets','credentials','private_key','id_rsa','node_modules/','.git/','.pem','.p12','.pfx','.key')
 for raw in files:
  if not raw:continue
  path=raw.decode('utf8','surrogateescape');lo=path.lower();f=root/path
  if not f.is_file():continue
  if any(s in lo for s in deny_tokens) or f.stat().st_size>MAX_FILE:
   excluded.append({'file':path,'reason':'sensitive-name-or-size'});continue
  if size+f.stat().st_size>MAX_TOTAL:
   excluded.append({'file':path,'reason':'archive-total-limit'});continue
  entries.append((path,f));size+=f.stat().st_size
 manifest={'format':'EGX_PRO_PORTABLE_BACKUP_V1','createdUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
   'repoCommit':subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip(),
   'dbStatus':'DERIVED_HISTORY_SNAPSHOT_NOT_PRIVATE_PRODUCTION_SQLITE',
   'privateCentralDbIncluded':False,'officialIdentityCertified':False,
   'included':[],'excluded':excluded,'restoreInstructions':'Extract, verify SHA256_MANIFEST.json, open DATABASE/egx_research_snapshot.sqlite, run PRAGMA integrity_check. Not a live production backup.',
   'notes':['Repository is PUBLIC. Never upload private SQL databases, secrets or credentials here.','Official PDF supplied in the ChatGPT conversation is not versioned in this repo.','Snapshot bars inherit original source evidence and validation flags, not invented EGX certification.']}
 out.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=7,allowZip64=True) as z:
  for path,f in entries:
   b=f.read_bytes();z.writestr('EGX_PRO_BACKUP/'+path,b);manifest['included'].append({'path':path,'sha256':sha(b),'bytes':len(b)})
  b=db.read_bytes()
  z.writestr('EGX_PRO_BACKUP/DATABASE/egx_research_snapshot.sqlite',b)
  manifest['included'].append({'path':'DATABASE/egx_research_snapshot.sqlite','sha256':sha(b),'bytes':len(b)})
  intro='''EGX PRO — PORTABLE RESEARCH BACKUP
Repository: rasheadsca-star/RAS-EGX-PRO2026-NEXT
This ZIP contains versioned code and source assets plus a newly constructed research SQLite snapshot. 
It is NOT a verified copy of the unavailable private production database.
Data and scenarios are RESEARCH_ONLY, non-executable, identity/tick-size/broker fees still require review.
To verify all files, compare SHA256_MANIFEST.json entries and PRAGMA integrity_check=ok.
Restore production only after secret/DB authorization and independent validation.
'''
  z.writestr('EGX_PRO_BACKUP/README_BACKUP.txt',intro)
  z.writestr('EGX_PRO_BACKUP/SHA256_MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2).encode('utf8'))
 print(json.dumps({'output':str(out),'bytes':out.stat().st_size,'trackedFiles':len(entries),'excludedFiles':len(excluded),'sqliteBytes':db.stat().st_size,'commit':manifest['repoCommit'],'zip_sha256':sha(out.read_bytes())}))
if __name__=='__main__':main()
