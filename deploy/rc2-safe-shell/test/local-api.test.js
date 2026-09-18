import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import handler,{readHistory,evaluateRequest} from '../api/index.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
function history60(){return Array.from({length:60},(_,i)=>({sessionDate:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),open:1,high:2,low:.5,close:1.5,volume:1000,validationStatus:'VALID',migrationValidationStatus:'VALID'}))}
function mockRes(){return{statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v},end(v){this.body=v;return this}}}

test('local API health has no legacy network influence',async()=>{
  const res=mockRes();await handler({method:'GET',query:{route:'health'}},res);
  const j=JSON.parse(res.body);
  assert.equal(res.statusCode,200);assert.equal(j.ok,true);assert.equal(j.legacyNetworkCalls,0);assert.equal(j.productionCutover,false);
});
test('local API reads repository history directly',()=>{
  const j=readHistory('COMI',20);assert.equal(j.ok,true);assert.equal(j.ticker,'COMI');assert.ok(j.bars.length>0&&j.bars.length<=20);
});
test('local API evaluates TFE hard gate internally',()=>{
  const j=evaluateRequest({snapshot:{snapshotId:'X',ticker:'COMI',sessionDate:'2026-09-15',validationStatus:'VALID',migrationValidationStatus:'VALID'},history:history60(),components:{technicalScore:80,researchScore:80,liquidityScore:65,liquidityEligible:true,srConfluenceScore:65,srStrongMethods:3,netRiskReward:1.1,pullbackAtr:.4,entryState:'READY'}});
  assert.equal(j.result.eligibility,'ELIGIBLE');assert.equal(j.legacyNetworkCalls,0);
});
test('vendored technical asset is exact pinned Git blob',()=>{
  const bytes=fs.readFileSync(path.join(root,'technical-analysis-tools.js'));
  const hash=crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
  assert.equal(hash,'350b05a6a3f253faf44533f7747e03bba9095953');
});
