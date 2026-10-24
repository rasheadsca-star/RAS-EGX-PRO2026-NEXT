'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {loadResearchOnlyCentral}=require('../../scripts/research/egx-central-research-ohlcv-gateway-v1.cjs');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-central-research-'));
 fs.mkdirSync(path.join(dir,'raw-long-history-gzip'));
 const sessions=[];for(let i=0,d=new Date(Date.UTC(2024,0,7));sessions.length<260;i++,d.setUTCDate(d.getUTCDate()+1)){
  if([5,6].includes(d.getUTCDay()))continue;
  sessions.push({date:d.toISOString().slice(0,10),open:10,high:11,low:9,close:10,adjustedClose:10,volume:10000});
 }
 const doc={ticker:'ABC',source:'YAHOO_CHART_API',dataQualityStatus:'VALID',symbolIdentity:{verified:true},sessions};
 fs.writeFileSync(path.join(dir,'raw-long-history-gzip','ABC.json.gz'),zlib.gzipSync(JSON.stringify(doc)));
 fs.writeFileSync(path.join(dir,'raw-long-history-quality.json'),JSON.stringify({schemaVersion:'egx-central-long-history-restore-quality-1',stocks:[{ticker:'ABC',researchHistoryCandidate:true}]}));
 return dir;
}
test('read central compressed source, not 167-session main files',()=>{const dir=fixture();try{const r=loadResearchOnlyCentral(dir,new Set());assert.equal(r.audit.usableSymbols,1);assert.equal(r.universe.ABC.length,260);assert.equal(r.productionEligible,false)}finally{fs.rmSync(dir,{recursive:true,force:true})}});
test('quality-blocked ticker must not be imported even with a real file',()=>{const dir=fixture();try{fs.writeFileSync(path.join(dir,'raw-long-history-quality.json'),JSON.stringify({schemaVersion:'egx-central-long-history-restore-quality-1',stocks:[{ticker:'ABC',researchHistoryCandidate:false}]}));const r=loadResearchOnlyCentral(dir,new Set());assert.equal(r.audit.usableSymbols,0)}finally{fs.rmSync(dir,{recursive:true,force:true})}});
test('fail closed when central quality report absent',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egx-central-noaudit-'));try{assert.throws(()=>loadResearchOnlyCentral(dir,new Set()),/missing/)}finally{fs.rmSync(dir,{recursive:true,force:true})}});
