#!/usr/bin/env node
'use strict';
// Read-only recovery: never rewrite data/history, price truth, or a G22 handoff.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const read=(p,fallback=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}};
const abs=p=>path.join(ROOT,p);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const num=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const tickerOf=p=>path.basename(p,'.json').toUpperCase();
function validBar(r,expected,ticker){
 if(!r||typeof r!=='object'||!DAY.test(String(r.date||''))||r.date>expected)return null;
 if(r.ticker&&String(r.ticker).toUpperCase()!==ticker)return null;
 const [open,high,low,close,volume]=[r.open,r.high,r.low,r.close,r.volume].map(num);
 if([open,high,low,close,volume].some(v=>v===null)||open<=0||low<=0||close<=0||volume<0)return null;
 if(high<Math.max(open,close,low)||low>Math.min(open,close))return null;
 return {date:r.date,open,high,low,close,volume};
}
function candidatePaths(root){
 try {
  const stdout=cp.execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:40*1024*1024});
  return stdout.split('\0').filter(Boolean).filter(p=>/\.json$/i.test(p)&&
   !p.startsWith('data/history/')&&
   /(?:^|\/)(?:archive[^/]*|backups?|legacy[^/]*|preview[^/]*|v1[5-9][^/]*|gann-fusion-x|sepa[^/]*|old[^/]*|engines?)(?:\/|$)/i.test(p));
 }catch{return []}
}
function analyze({root=ROOT,archivePaths=null,expected=null}={}){
 const readRel=(p,d=null)=>read(path.join(root,p),d);
 const truth=readRel('data/stable/v15-price-truth.json',{}),summary=readRel('data/history-summary.json',{symbols:[]});
 const session=expected||truth.expectedSession;
 if(!DAY.test(String(session||'')))throw new Error('Expected ISO session required');
 const symbols=Array.isArray(summary.symbols)?summary.symbols:[];
 const missing=new Set(truth.missingHistoryFiles||[]);
 const failed=new Set(symbols.filter(x=>x.processingStatus==='failed').map(x=>x.ticker));
 const stale=new Set(symbols.filter(x=>x.processingStatus==='stale').map(x=>x.ticker));
 const rejected=new Set((truth.sampleRejected||[]).map(x=>x.ticker));
 const targets=[...new Set([...missing,...failed,...stale,...rejected])].filter(x=>/^[A-Z0-9._-]+$/.test(x)).sort();
 const targetSet=new Set(targets);
 const report={schemaVersion:'EGX_CENTRAL_HISTORY_RECOVERY_1',mode:'QUARANTINE_ONLY',
  expectedSession:session,sourceFiles:['data/stable/v15-price-truth.json','data/history-summary.json'],
  summary:{historySymbols:summary.symbolsTotal||symbols.length,complete100:summary.symbolsComplete100||0,
   sourceFailed:failed.size,missingCurrentHistory:missing.size,staleHistory:stale.size,
   targets:targets.length,archiveFilesScanned:0,archivalCandidateFiles:0,archivalNewSessionRows:0,
   historicalOverlapValidated:0,canonicalRowsWritten:0},
  gaps:targets.map(t=>{const x=symbols.find(s=>s.ticker===t)||{};return{
   ticker:t,currentHistoryMissing:missing.has(t),fetchFailed:failed.has(t),
   staleHistory:stale.has(t),sampleRejected:rejected.has(t),
   availableSessions:x.availableSessions??null,lastKnownSession:x.lastSession||null,
   historySource:x.primarySource||null,
   fetchReason:/HTTP 404/.test(x.lastUpdateError||'')?'YAHOO_HTTP_404':x.lastUpdateError?'OTHER':'NONE',
   recoveryPriority:missing.has(t)?'P0_NO_HISTORY':stale.has(t)?'P1_STALE_HISTORY':'P2_REJECTED_OR_FAILED'};}),
  candidates:[],rejections:[]};
 const paths=archivePaths||candidatePaths(root);
 const known=new Map();
 for(const t of targets){
  const d=readRel('data/history/'+t+'.json',{}),map=new Map();
  for(const r of d?.sessions||[]){const b=validBar(r,session,t);if(b)map.set(b.date,b)}
  known.set(t,map);
 }
 for(const filename of paths){
  if(!filename.endsWith('.json')||filename.startsWith('data/history/')||filename.includes('..'))continue;
  const t=tickerOf(filename);
  if(!targetSet.has(t))continue;
  const full=path.join(root,filename);
  let raw;try{const stat=fs.lstatSync(full);if(!stat.isFile()||stat.size>8*1024*1024)continue;raw=fs.readFileSync(full)}catch{continue}
  report.summary.archiveFilesScanned++;
  let doc;try{doc=JSON.parse(raw.toString('utf8'))}catch{report.rejections.push({file:filename,reason:'BAD_JSON'});continue}
  if(doc.ticker&&String(doc.ticker).toUpperCase()!==t){
   report.rejections.push({file:filename,reason:'TICKER_IDENTITY_CONFLICT'});continue
  }
  const series=Array.isArray(doc.sessions)?doc.sessions:Array.isArray(doc.bars)?doc.bars:Array.isArray(doc.rows)?doc.rows:null;
  if(!series?.length)continue;
  const reference=known.get(t)||new Map();
  const distinct=new Map(),invalid=[];
  for(const row of series){
   if(row?.date&&row.date>session)continue;
   const b=validBar(row,session,t);
   if(!b){invalid.push(row?.date||null);continue}
   if(distinct.has(b.date)&&JSON.stringify(distinct.get(b.date))!==JSON.stringify(b)){
    invalid.push('DUPLICATE_CONFLICT:'+b.date);continue
   }
   distinct.set(b.date,b);
  }
  let overlaps=0,conflicts=0,news=[];
  for(const bar of distinct.values()){
   const ref=reference.get(bar.date);
   if(!ref){news.push(bar);continue}
   if(Math.abs(ref.close-bar.close)<=Math.max(0.005,ref.close*0.002)&&Math.abs(ref.volume-bar.volume)<=Math.max(1,ref.volume*0.03))overlaps++;
   else conflicts++;
  }
  if(!news.length&&!conflicts)continue;
  const gated=invalid.length===0&&conflicts===0&&overlaps>=3;
  report.summary.archivalCandidateFiles++;
  report.summary.archivalNewSessionRows+=news.length;
  if(gated)report.summary.historicalOverlapValidated+=news.length;
  report.candidates.push({ticker:t,sourceFile:filename,sha256:hash(raw),sourceTicker:doc.ticker||null,
   sourceLabel:doc.primarySource||doc.source||'UNSPECIFIED_LEGACY',
   sourceTrust:'ARCHIVE_REQUIRES_INDEPENDENT_CONFIRMATION',
   overlaps,conflicts,invalidBars:invalid.length,
   additionalDates:news.map(x=>x.date).sort(),
   additionalBars:news.sort((a,b)=>a.date.localeCompare(b.date)),
   stageStatus:gated?'OVERLAP_VALIDATED_NEEDS_INDEPENDENT_SECOND_SOURCE':'QUARANTINED_UNVERIFIED',
   eligibleForAutomaticCanonicalWrite:false});
 }
 // Explicit cross-repository legacy snapshot imported with Git blob SHA provenance.
 const bundlePath='data/recovery/legacy-ras-egx-pro2026-history50-20260702.json';
 const bundle=readRel(bundlePath,null);
 if(bundle?.mode==='QUARANTINED_NO_CANONICAL_WRITE'&&bundle?.sourceRepository&&bundle?.sourceBlobSha&&bundle?.symbols){
  report.summary.archiveFilesScanned++;
  for(const [t,rows] of Object.entries(bundle.symbols)){
   if(!targetSet.has(t)||!Array.isArray(rows)||!rows.length)continue;
   const reference=known.get(t)||new Map();
   let overlaps=0,conflicts=0,bad=0;
   const news=[];
   for(const row of rows){
    const bar=validBar(row,session,t);
    if(!bar){bad++;continue}
    const ref=reference.get(bar.date);
    if(!ref){news.push(bar);continue}
    if(Math.abs(ref.close-bar.close)<=Math.max(0.005,ref.close*0.002)&&Math.abs(ref.volume-bar.volume)<=Math.max(1,ref.volume*0.03))overlaps++;
    else conflicts++;
   }
   report.summary.archivalCandidateFiles++;
   report.summary.archivalNewSessionRows+=news.length;
   const stageStatus=bad||conflicts?'MALFORMED_OR_CONFLICTING_QUARANTINE':
    overlaps>=3?'OVERLAP_VALIDATED_NEEDS_INDEPENDENT_SECOND_SOURCE':'SINGLE_ARCHIVE_SOURCE_UNVERIFIED';
   report.candidates.push({ticker:t,sourceFile:bundlePath,sourceRepository:bundle.sourceRepository,
    sourceRepositoryFile:bundle.sourcePath,sourceBlobSha:bundle.sourceBlobSha,sourceGeneratedAt:bundle.sourceGeneratedAt,
    sourceTrust:'ARCHIVE_REQUIRES_INDEPENDENT_CONFIRMATION',
    overlaps,conflicts,invalidBars:bad,additionalDates:news.map(x=>x.date).sort(),
    additionalBars:news.sort((a,b)=>a.date.localeCompare(b.date)),
    stageStatus,eligibleForAutomaticCanonicalWrite:false});
  }
 }
 report.candidates.sort((a,b)=>a.ticker.localeCompare(b.ticker)||a.sourceFile.localeCompare(b.sourceFile));
 return report;
}
if(require.main===module){
 const output=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/central-history-recovery.json';
 const report=analyze();
 const target=abs(output);fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
 console.log('CENTRAL_HISTORY_RECOVERY',JSON.stringify({session:report.expectedSession,...report.summary,out:output}));
}
module.exports={analyze,validBar,candidatePaths};
