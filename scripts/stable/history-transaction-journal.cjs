'use strict';
// Local crash-recoverable history transaction. Caller MUST hold a cross-run
// writer lock, and MUST NOT push until complete() returns successfully.
// Intent is durable before first canonical write; recovery restores originals.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function durable(file, bytes) {
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.tmp-'+process.pid;
 const fd=fs.openSync(tmp,'wx');
 try{fs.writeSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,file);
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function txnPath(root){return path.join(root,'data/quarantine/history-transaction-intent.json');}
function checkedRecord(record) {
 if(!record||record.schemaVersion!==1||record.status!=='prepared'||typeof record.runId!=='string'||!record.runId||!Array.isArray(record.entries)||!record.entries.length)throw new Error('INVALID_TRANSACTION_JOURNAL');
 const seen=new Set();
 for(const e of record.entries){
  if(!e||typeof e.ticker!=='string'||!/^[A-Z0-9._-]+$/.test(e.ticker)||e.ticker==='.'||e.ticker==='..'||seen.has(e.ticker))throw new Error('INVALID_JOURNAL_TICKER');
  seen.add(e.ticker);
  for(const side of ['before','after']){
   const encoded=e[side+'Base64'];const digest=e[side+'Sha256'];
   if(typeof encoded!=='string'||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||Buffer.from(encoded,'base64').toString('base64')!==encoded||sha(Buffer.from(encoded,'base64'))!==digest)
    throw new Error('JOURNAL_CONTENT_HASH_MISMATCH:'+e.ticker);
  }
 }
 return record;
}
function storedRecord(root){return checkedRecord(JSON.parse(fs.readFileSync(txnPath(root),'utf8')));}
function begin({root,runId,updates}) {
 if(!runId||!Array.isArray(updates)||!updates.length)throw new Error('INVALID_HISTORY_TRANSACTION');
 const intent=txnPath(root);
 if(fs.existsSync(intent))throw new Error('UNRECOVERED_HISTORY_TRANSACTION');
 const entries=[],seen=new Set();
 for(const update of updates) {
  const ticker=update.ticker;
  if(typeof ticker!=='string'||!/^[A-Z0-9._-]+$/.test(ticker)||ticker==='.'||ticker==='..'||seen.has(ticker))
    throw new Error('INVALID_TRANSACTION_TICKER');
  seen.add(ticker);
  const filename=path.join(root,'data/history',ticker+'.json');
  const before=fs.readFileSync(filename);
  if(!Array.isArray(JSON.parse(before.toString('utf8'))?.sessions))throw new Error('INVALID_EXISTING_HISTORY:'+ticker);
  const after=Buffer.from(typeof update.after==='string'?update.after:JSON.stringify(update.after,null,2)+'\n');
  const parsed=JSON.parse(after.toString('utf8'));
  if(!parsed||!Array.isArray(parsed.sessions))throw new Error('INVALID_STAGED_HISTORY:'+ticker);
  entries.push({ticker,beforeSha256:sha(before),afterSha256:sha(after),beforeBase64:before.toString('base64'),afterBase64:after.toString('base64')});
 }
 const record={schemaVersion:1,runId,status:'prepared',entries};
 durable(intent,Buffer.from(JSON.stringify(record,null,2)+'\n'));
 return record;
}
function apply({root,record,faultAfter=-1}) {
 if(!fs.existsSync(txnPath(root)))throw new Error('MISSING_TRANSACTION_INTENT');
 const stored=storedRecord(root);checkedRecord(record);
 if(sha(Buffer.from(JSON.stringify(stored.entries)))!==sha(Buffer.from(JSON.stringify(record.entries)))||stored.runId!==record.runId)throw new Error('JOURNAL_RECORD_MISMATCH');
 for(let i=0;i<record.entries.length;i++){
  const e=record.entries[i],file=path.join(root,'data/history',e.ticker+'.json');
  const current=sha(fs.readFileSync(file));
  if(current!==e.beforeSha256&&current!==e.afterSha256)throw new Error('EXTERNAL_HISTORY_MUTATION:'+e.ticker);
  durable(file,Buffer.from(e.afterBase64,'base64'));
  if(i===faultAfter)throw new Error('INJECTED_TRANSACTION_INTERRUPTION');
 }
}
function recover({root}) {
 const file=txnPath(root);
 if(!fs.existsSync(file))return {recovered:false};
 const record=storedRecord(root);
 // Fail closed rather than overwrite externally modified files.
 for(const e of record.entries){
  const filename=path.join(root,'data/history',e.ticker+'.json');
  const current=sha(fs.readFileSync(filename));
  if(current!==e.beforeSha256&&current!==e.afterSha256)throw new Error('RECOVERY_CONFLICT:'+e.ticker);
 }
 for(const e of record.entries) durable(path.join(root,'data/history',e.ticker+'.json'),Buffer.from(e.beforeBase64,'base64'));
 fs.unlinkSync(file);
 return {recovered:true,runId:record.runId,restoredFiles:record.entries.length};
}
function complete({root,record}) {
 const file=txnPath(root);
 if(!fs.existsSync(file))throw new Error('MISSING_TRANSACTION_INTENT');
 const stored=storedRecord(root);checkedRecord(record);
 if(stored.runId!==record.runId||sha(Buffer.from(JSON.stringify(stored.entries)))!==sha(Buffer.from(JSON.stringify(record.entries))))throw new Error('JOURNAL_RECORD_MISMATCH');
 for(const e of record.entries){
  if(sha(fs.readFileSync(path.join(root,'data/history',e.ticker+'.json')))!==e.afterSha256)throw new Error('INCOMPLETE_TRANSACTION:'+e.ticker);
 }
 fs.unlinkSync(file);
 return {complete:true,files:record.entries.length};
}
module.exports={begin,apply,recover,complete,txnPath};
