'use strict';
// Read-only preflight for S3-B1 shadow worktrees. No production hook, no push.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {evaluation,SOURCE}=require('./history-quarantine-policy.cjs');
const {capture}=require('./history-r8-integrity.cjs');
function preflight({root,runId,startedAt}){
 if(!root||!runId||!Number.isFinite(Date.parse(startedAt)))throw Error('S3_INVALID_CONTEXT');
 const real=fs.realpathSync(root),tmp=fs.realpathSync(os.tmpdir());
 if(!real.startsWith(tmp+path.sep)||real===fs.realpathSync(process.cwd()))throw Error('S3_NOT_ISOLATED_WORKTREE');
 const git=cp.execFileSync('git',['rev-parse','--show-toplevel'],{cwd:real,encoding:'utf8'}).trim();
 if(fs.realpathSync(git)!==real)throw Error('S3_WORKTREE_ROOT_REQUIRED');
 if(!fs.existsSync(path.join(real,'.git')))throw Error('S3_GIT_WORKTREE_REQUIRED');
 const report=JSON.parse(fs.readFileSync(path.join(real,'data/stable/v15-price-truth.json'),'utf8'));
 const session=report.expectedSession,historyDir=path.join(real,'data/history');
 if(report.schemaVersion!=='16.3.4-session-aware-price-truth'||report.ready!==true||report.executionGrade!==true||report.source?.realFetch!==true||report.source?.preciseSource!==true)throw Error('S3_REPORT_NOT_READY');
 if(!Number.isFinite(Date.parse(report.generatedAt))||Date.parse(report.generatedAt)<Date.parse(startedAt))throw Error('S3_STALE_REPORT');
 if(!Array.isArray(report.missingHistoryFiles)||!Array.isArray(report.sampleRejected)||!Array.isArray(report.sampleDropped)||report.rejectedRows!==report.sampleRejected.length||report.droppedRows!==report.sampleDropped.length)throw Error('S3_INCOMPLETE_ASSESSMENT');
 const rejected=report.sampleRejected.map(x=>({ticker:x.ticker,reason:x.reason})),bad=new Set(rejected.map(x=>x.ticker));
 const missing=new Set(report.missingHistoryFiles),accepted=[];
 for(const name of fs.readdirSync(historyDir)){
  if(!name.endsWith('.json'))continue;
  const file=path.join(historyDir,name),ticker=name.slice(0,-5);
  if(fs.lstatSync(file).isSymbolicLink())throw Error('S3_HISTORY_SYMLINK');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(doc.sessions))throw Error('S3_BAD_HISTORY');
  if(bad.has(ticker)||missing.has(ticker))continue;
  accepted.push(...doc.sessions.filter(x=>x.source===SOURCE&&String(x.date||x.sessionDate).slice(0,10)===session));
 }
 const assessment=evaluation({runId,expectedSession:session,sourceEligible:true,acceptedRows:report.acceptedRows,accepted,rejected,missingHistory:[...missing]});
 const affectedTickers=new Set(accepted.map(x=>x.ticker));
 for(const ticker of bad){
  const file=path.join(historyDir,ticker+'.json');
  if(!fs.existsSync(file))continue;
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  if(doc.sessions.some(x=>x.source===SOURCE&&String(x.date||x.sessionDate).slice(0,10)===session))affectedTickers.add(ticker);
 }
 const baseline=capture({root:real,expectedSession:session,affectedTickers,assessment});
 return {root:real,session,assessment,affectedTickers,baseline,head:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:real,encoding:'utf8'}).trim()};
}
module.exports={preflight};
