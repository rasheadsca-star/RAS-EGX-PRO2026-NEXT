import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/hash.js';
import { importLegacyHistoryFile,verifyResearchHistoryDataset } from '../src/research-history-import.js';

const commit='0b4cb244dcea90f68c8808a824a0e4d0c3e05b1e';
const opts={legacyCommit:commit,sourcePath:'data/history/ABUK.json',sourceFileHash:'a'.repeat(64),importedAt:'2026-08-31T20:00:51Z'};
const base={schemaVersion:'12.5.0',ticker:'ABUK',generatedAt:'2026-08-31T19:35:52Z',primarySource:'yahoo',symbolVerified:true,officiallyVerifiedLatestSession:false,sessions:[
  {date:'2026-08-27',open:48,high:50,low:47.5,close:49,volume:100000,primarySource:'yahoo'},
  {date:'2026-08-30',open:49,high:50.5,low:48.5,close:50,volume:120000,primarySource:'yahoo'},
  {date:'2026-08-31',open:50,high:52,low:49.5,close:51,volume:150000,primarySource:'yahoo'}
]};

test('valid legacy history imports as immutable research-only dataset',()=>{
  const r=importLegacyHistoryFile(base,opts);
  assert.equal(r.state,'IMPORTED_RESEARCH');
  assert.equal(r.dataset.authorityMode,'RESEARCH');
  assert.equal(r.dataset.productionAuthority,false);
  assert.equal(r.dataset.metadata.readyResearchSessions,3);
  assert.equal(verifyResearchHistoryDataset(r.dataset).state,'READY');
});

test('latest close conflict quarantines only latest session',()=>{
  const r=importLegacyHistoryFile({...base,warnings:['latest_close_conflict:9.6261%']},opts);
  assert.equal(r.dataset.metadata.readyResearchSessions,2);
  assert.equal(r.dataset.metadata.quarantinedResearchSessions,1);
  assert.equal(r.dataset.sessions[2].researchState,'QUARANTINED_RESEARCH');
  assert.ok(r.dataset.sessions[2].quarantineReasons.some(x=>x.startsWith('CROSS_SOURCE_CONFLICT:')));
  assert.equal(r.dataset.sessions[1].researchState,'READY_RESEARCH');
});

test('invalid OHLC row is preserved but quarantined from research calculations',()=>{
  const bad={...base,sessions:[base.sessions[0],{date:'2026-08-30',open:50,high:49,low:48,close:50,volume:10}]};
  const r=importLegacyHistoryFile(bad,opts);
  assert.equal(r.state,'IMPORTED_RESEARCH');
  assert.equal(r.dataset.metadata.quarantinedResearchSessions,1);
  assert.ok(r.dataset.sessions[1].quarantineReasons.includes('HIGH_LT_OPEN'));
});

test('duplicate sessions block the file instead of silently deduplicating',()=>{
  const dup={...base,sessions:[base.sessions[0],{...base.sessions[0]}]};
  const r=importLegacyHistoryFile(dup,opts);
  assert.equal(r.state,'BLOCKED');
  assert.ok(r.reasons.some(x=>x.startsWith('DUPLICATE_SESSION:')));
});

test('dataset hash is deterministic and excludes migration timestamp',()=>{
  const a=importLegacyHistoryFile(base,{...opts,importedAt:'2026-08-31T20:00:51Z'}).dataset;
  const b=importLegacyHistoryFile(base,{...opts,importedAt:'2026-09-01T01:00:00Z'}).dataset;
  assert.equal(a.datasetHash,b.datasetHash);
  const {datasetHash,importedAt,...stable}=a;
  assert.equal(datasetHash,sha256(stable));
});

test('legacy payload cannot smuggle production authority',()=>{
  const r=importLegacyHistoryFile({...base,authorityMode:'CERTIFIED_PRODUCTION',productionAuthority:true},opts);
  assert.equal(r.dataset.authorityMode,'RESEARCH');
  assert.equal(r.dataset.productionAuthority,false);
  assert.ok(r.dataset.sessions.every(x=>x.authorityMode==='RESEARCH'&&x.productionAuthority===false));
});
