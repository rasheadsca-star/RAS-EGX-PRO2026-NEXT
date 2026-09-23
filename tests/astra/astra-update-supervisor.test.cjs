'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateState, parseHolidays } = require('../../scripts/astra/astra-update-supervisor.cjs');

const now = { date:'2026-09-23', hour:18, minute:30, dow:3 };
const handoff = {
  schemaVersion:'g22-main-app-final-handoff-1',
  final:true, sourceReady:true, currentSessionReady:true, executionGrade:true,
  pagesPublished:true, pagesPublishedAt:'2026-09-23T14:47:41.883Z',
  sessionDate:'2026-09-23', expectedSession:'2026-09-23',
  acceptedRows:201, sourceSessionEvidenceCoveragePct:96.23,
  canonicalDataHead:'3'.repeat(40), materialFingerprint:'a'.repeat(64),
  sourceSessionDataHash:'b'.repeat(64), producerRunId:'35876337954'
};
const app = {
  sourceDecision:{
    session:'2026-09-23', decisionSnapshotId:'G09-DS-current', semanticDecisionHash:'c'.repeat(64),
    upstream:{
      canonicalDataHead:handoff.canonicalDataHead,
      mainAppMaterialFingerprint:handoff.materialFingerprint,
      sourceSessionDataHash:handoff.sourceSessionDataHash,
      producerRunId:handoff.producerRunId
    }
  },
  decisionSnapshot:{
    sessionDate:'2026-09-23', asOfSessionDate:'2026-09-23',
    decisionSnapshotId:'G09-DS-current', semanticDecisionHash:'c'.repeat(64),
    top5:[]
  }
};
const manifest = {
  currentSession:'2026-09-23',
  currentDecisionSnapshotId:'G09-DS-current',
  currentSemanticDecisionHash:'c'.repeat(64)
};
const audit = { session:{expected:'2026-09-23',decision:'2026-09-23',available:'2026-09-23'} };
const ledger = {records:[]};
const perf = {
  sessionRange:{last:'2026-09-23'},
  sourceSnapshot:{
    decisionSnapshotId:'G09-DS-current',
    canonicalDataHead:handoff.canonicalDataHead,
    handoffFingerprint:handoff.materialFingerprint,
    handoffProducerRunId:handoff.producerRunId
  },
  currentOpportunities:0
};
const live = JSON.parse(JSON.stringify(app));
const state = overrides => evaluateState({handoff,app,manifest,audit,ledger,perf,live,now,...overrides});

test('READY accepts a legitimate current zero-opportunity session',()=>{
  const out=state({});
  assert.equal(out.action,'READY');
  assert.equal(out.recommendationsCurrent,true);
  assert.equal(out.recommendationCount,0);
});

test('new finalized handoff forces Astra refresh when app is stale',()=>{
  const staleApp=JSON.parse(JSON.stringify(app));
  staleApp.sourceDecision.session='2026-09-22';
  staleApp.decisionSnapshot.sessionDate='2026-09-22';
  staleApp.decisionSnapshot.asOfSessionDate='2026-09-22';
  const out=state({app:staleApp});
  assert.equal(out.action,'REFRESH_ASTRA');
  assert.equal(out.reason,'ASTRA_SESSION_STALE');
});

test('sub-90 source evidence recovers MAIN APP instead of publishing stale recommendations',()=>{
  const bad={...handoff,sourceSessionEvidenceCoveragePct:88.39};
  const out=state({handoff:bad});
  assert.equal(out.action,'RECOVER_MAIN_APP');
  assert.equal(out.handoffReady,false);
});

test('missing current trading session recovers MAIN APP',()=>{
  const old={...handoff,sessionDate:'2026-09-22',expectedSession:'2026-09-22'};
  const out=state({handoff:old});
  assert.equal(out.action,'RECOVER_MAIN_APP');
  assert.equal(out.reason,'LATEST_TRADING_SESSION_NOT_FINALIZED');
});

test('stale recommendation ledger forces Astra rebuild',()=>{
  const recApp=JSON.parse(JSON.stringify(app));
  recApp.decisionSnapshot.top5=[{ticker:'ABCD'}];
  const out=state({app:recApp,live:recApp});
  assert.equal(out.action,'REFRESH_ASTRA');
  assert.equal(out.reason,'ASTRA_RECOMMENDATION_LEDGER_STALE');
});

test('current repository with stale live deployment forces Vercel deployment',()=>{
  const staleLive=JSON.parse(JSON.stringify(app));
  staleLive.sourceDecision.session='2026-09-22';
  staleLive.decisionSnapshot.sessionDate='2026-09-22';
  const out=state({live:staleLive});
  assert.equal(out.action,'DEPLOY_VERCEL');
  assert.equal(out.reason,'VERCEL_LIVE_STALE');
});


test('holiday-aware expected session falls back to the prior trading day',()=>{
  const holidayNow={date:'2026-09-24',hour:18,minute:0,dow:4};
  const out=state({
    now:holidayNow,
    holidays:new Set(['2026-09-24']),
    expectedTradingSession:'2026-09-23'
  });
  assert.equal(out.expectedTradingSession,'2026-09-23');
});

test('repository-current state with unavailable live truth keeps deployment recovery active',()=>{
  const out=state({live:null});
  assert.equal(out.action,'DEPLOY_VERCEL');
  assert.equal(out.reason,'VERCEL_LIVE_UNVERIFIED');
});


test('holiday parser accepts JSON-like and comma-separated configured dates',()=>{
  const out=parseHolidays('["2026-01-07", "2026-04-13"];2026-07-23');
  assert.equal(out.has('2026-01-07'),true);
  assert.equal(out.has('2026-04-13'),true);
  assert.equal(out.has('2026-07-23'),true);
});

test('stalled Astra refresh escalates to a fresh MAIN APP source cycle',()=>{
  const staleApp=JSON.parse(JSON.stringify(app));
  staleApp.sourceDecision.session='2026-09-22';
  staleApp.decisionSnapshot.sessionDate='2026-09-22';
  staleApp.decisionSnapshot.asOfSessionDate='2026-09-22';
  const aged={...handoff,generatedAt:'2026-09-23T14:00:00.000Z'};
  const out=state({app:staleApp,handoff:aged,nowMs:Date.parse('2026-09-23T15:00:00.000Z')});
  assert.equal(out.action,'RECOVER_MAIN_APP');
  assert.equal(out.reason,'ASTRA_REFRESH_STALLED_ESCALATE_SOURCE');
});
