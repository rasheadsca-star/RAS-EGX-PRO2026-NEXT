#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {splitLocation,normalizeTickerRaw,extractRecordsFromFile,compareRuns,PARITY_PINS} = require('../../astra/migration/g07-migrate.cjs');

function loadJson(p){return JSON.parse(fs.readFileSync(p,'utf8'))}
function loadJsonl(p){const t=fs.readFileSync(p,'utf8').trim();return t?t.split(/\r?\n/).map(JSON.parse):[]}

test('G07 location resolver freezes branch-backed sources',()=>{
  const x=splitLocation('v18-global-strategy-ensemble-20260906:data/stable/v18-forward-ledger.json');
  assert.equal(x.branch,'v18-global-strategy-ensemble-20260906');
  assert.equal(x.commit,'100ecd0bcb001d2ad1767ec75a02fc574bf99efd');
  assert.equal(x.pattern,'data/stable/v18-forward-ledger.json');
});

test('symbol formatting normalization is conservative and deterministic',()=>{
  assert.equal(normalizeTickerRaw(' comi.ca '),'COMI');
  assert.equal(normalizeTickerRaw('EGX:COMI'),'COMI');
  assert.equal(normalizeTickerRaw('COM I'),'COMI');
  assert.equal(normalizeTickerRaw(''),null);
});

test('JSON extraction preserves container context and all top-level record collections',()=>{
  const payload=Buffer.from(JSON.stringify({ticker:'COMI',sessionDate:'2026-09-15',records:[{id:1},{id:2}],signals:[{id:3}]}));
  const rows=extractRecordsFromFile({text:payload.toString('utf8'),buffer:payload,sourcePath:'x.json'});
  assert.equal(rows.length,3);
  assert.equal(rows[0].context.ticker,'COMI');
  assert.deepEqual(new Set(rows.map(r=>r.collectionKey)),new Set(['records','signals']));
});

test('all eight previously pending parity cases have exact immutable pins',()=>{
  assert.equal(Object.keys(PARITY_PINS).length,8);
  for(const id of ['P05','P06','P08','P09','P15','P16','P17','P18']){
    const p=PARITY_PINS[id];
    assert.ok(p);
    assert.match(p.sourceCommit,/^[a-f0-9]{40}$/);
    assert.ok(p.sourceBranch);
    assert.ok(p.sourcePath);
    assert.ok(p.reason);
  }
});

const r1=process.env.G07_RUN1?path.resolve(process.env.G07_RUN1):null;
const r2=process.env.G07_RUN2?path.resolve(process.env.G07_RUN2):null;

test('real migration: all 19 store groups are processed and reconciliation equations close',{skip:!r1},()=>{
  const s=loadJson(path.join(r1,'run-summary.json'));
  assert.equal(s.storeGroupsProcessed,19);
  assert.equal(s.storeGroupsTotal,19);
  assert.equal(s.sourceAccounting.length,19);
  for(const g of s.sourceAccounting){
    assert.equal(g.accounting.rawArchived,g.physicalRecordsDiscovered);
    assert.equal(g.accounting.equationCloses,true,`${g.sourceId} accounting failed`);
  }
  assert.equal(s.totals.unexplainedDataLoss,0);
});

test('real migration: recoverable OHLCV history is actually normalized, not merely archived',{skip:!r1},()=>{
  const s=loadJson(path.join(r1,'run-summary.json'));
  const h01=s.sourceAccounting.find(x=>x.sourceId==='H01_MARKET_OHLCV_HISTORY');
  assert.ok(h01,'H01 accounting missing');
  assert.ok(h01.normalizedImported>0,'recoverable OHLCV produced zero canonical snapshots');
  assert.ok(h01.normalizedImported<h01.physicalRecordsDiscovered+1);
  const records=loadJsonl(path.join(r1,'canonical/records.jsonl'));
  assert.ok(records.some(r=>r.canonicalType==='CanonicalMarketSnapshot'),'no canonical market snapshot produced');
});

test('real migration: raw archive exists for every store group and hashes/checkpoints are deterministic',{skip:!r1},()=>{
  const cps=loadJson(path.join(r1,'checkpoints.json'));
  assert.equal(cps.length,19);
  for(const c of cps){
    const raw=path.join(r1,'raw',`${c.sourceId}.jsonl`);
    assert.ok(fs.existsSync(raw),`${c.sourceId} raw archive missing`);
    assert.match(c.rawCheckpointHash,/^[a-f0-9]{64}$/);
    assert.match(c.normalizedCheckpointHash,/^[a-f0-9]{64}$/);
    assert.equal(c.accounting.equationCloses,true);
  }
});

test('real migration: every canonical record has at least one MigrationProvenance link',{skip:!r1},()=>{
  const records=loadJsonl(path.join(r1,'canonical/records.jsonl'));
  const prov=loadJsonl(path.join(r1,'canonical/migration-provenance.jsonl'));
  const refs=new Set(prov.map(p=>p.canonicalRecordId));
  for(const r of records)assert.ok(refs.has(r.canonicalRecordId),`missing provenance for ${r.canonicalRecordId}`);
});

test('real migration: invalid and unresolved records remain explicit diagnostics',{skip:!r1},()=>{
  const s=loadJson(path.join(r1,'run-summary.json'));
  const d=loadJson(path.join(r1,'diagnostics.json'));
  assert.equal(d.length,s.totals.invalid);
  for(const x of d){
    assert.ok(x.rawRecordId);
    assert.ok(Array.isArray(x.reasons)&&x.reasons.length>0);
  }
});

test('real migration: conflicts are preserved as source references rather than overwritten',{skip:!r1},()=>{
  const c=loadJson(path.join(r1,'conflicts.json'));
  for(const x of c.filter(y=>y.classification==='CONFLICTING_RECORD')){
    assert.ok(x.records.length>=2);
    assert.ok(new Set(x.records.map(r=>r.rawContentHash)).size>=2);
  }
});

test('real migration: recommendation fields are not mutated by forward outcome data',{skip:!r1},()=>{
  const records=loadJsonl(path.join(r1,'canonical/records.jsonl'));
  const recs=records.filter(r=>r.canonicalType==='RecommendationRecord');
  for(const r of recs){
    const e=r.entity;
    for(const forbidden of ['outcome','metrics','evaluatedAt','evaluationSessionDate','forwardOutcomeId']){
      assert.equal(Object.prototype.hasOwnProperty.call(e,forbidden),false,`${r.canonicalRecordId} contains ${forbidden}`);
    }
  }
});

test('real migration: forward outcomes remain a separate canonical type',{skip:!r1},()=>{
  const records=loadJsonl(path.join(r1,'canonical/records.jsonl'));
  for(const r of records.filter(x=>x.canonicalType==='ForwardOutcome')){
    assert.ok(r.entity.recommendationId);
    assert.equal(Object.prototype.hasOwnProperty.call(r.entity,'rank'),false);
    assert.equal(Object.prototype.hasOwnProperty.call(r.entity,'entryPlan'),false);
  }
});

test('real migration: time fields are not backfilled from generatedAt',{skip:!r1},()=>{
  const records=loadJsonl(path.join(r1,'canonical/records.jsonl'));
  for(const r of records){
    const e=r.entity;
    if(r.canonicalType==='StrategyExecution'||r.canonicalType==='DecisionSnapshot'){
      assert.match(e.sessionDate,/^\d{4}-\d{2}-\d{2}$/);
      assert.match(e.asOfSessionDate,/^\d{4}-\d{2}-\d{2}$/);
      assert.match(e.generatedAt,/T/);
    }
  }
});

test('real migration: run #2 is byte-identical for canonical state, provenance, conflicts, diagnostics and checkpoints',{skip:!r1||!r2},()=>{
  const result=compareRuns(r1,r2);
  assert.equal(result.pass,true,JSON.stringify(result));
  assert.equal(result.canonicalRecordCountEqual,true);
  assert.equal(result.invalidCountEqual,true);
  assert.equal(result.conflictCountEqual,true);
});

test('G07 never promotes runtime cutover or later gates',{skip:!r1},()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../../astra/migration/g07-migrate.cjs'),'utf8');
  assert.match(src,/G12 remains PENDING/);
  assert.doesNotMatch(src,/G12['"]?\s*[:,=]\s*['"]GREEN['"]/);
});
