import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/hash.js';
import { buildForwardResolutionPolicy,verifyForwardResolutionPolicy } from '../src/research-forward-resolution-policy.js';
import { evaluateForwardPlan,verifyForwardResolution,resolveForwardShadowLedger } from '../src/research-forward-shadow-resolver.js';
import { createForwardShadowLedger,appendPublicationToForwardShadowLedger } from '../src/research-forward-shadow-ledger.js';

const planHash='b'.repeat(64),strategyHash='a'.repeat(64);
const plan={ticker:'AAA',decision:'BUY_CANDIDATE',qualityScore:90,entryLow:100,entryHigh:102,stop:95,target1:110,target2:115,netRiskReward:1.2,entryExpirySessions:4,horizonSessions:6,planHash};
const strategy={authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,signalSession:'2026-09-01',strategySnapshotHash:strategyHash,validation:{selectedPreset:'CONTROLLED_PULLBACK'},policy:{costBps:25,sameBarAmbiguity:'STOP_FIRST'},recommendations:[{...plan,executableResearchPlan:true,strategyId:'CONTROLLED_PULLBACK',costAssumptionBps:25,costConvention:'ROUND_TRIP_TOTAL'}]};
const policy=buildForwardResolutionPolicy(strategy);
const pubBody={schemaVersion:'x',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,signalSession:'2026-09-01',sourceStrategySnapshotHash:strategyHash,strategyId:'CONTROLLED_PULLBACK',recommendations:[plan]};
const publication={...pubBody,publicationHash:sha256(pubBody)};
const regimeBody={authorityMode:'RESEARCH',productionAuthority:false,session:'2026-09-01',regime:'BALANCED'};const regime={...regimeBody,regimeHash:sha256(regimeBody)};
let ledger=createForwardShadowLedger({startAfterSession:'2026-08-31'});ledger=appendPublicationToForwardShadowLedger(ledger,{publication,regime});
const entry=ledger.entries[0];

function snap(session,bar){const body={schemaVersion:'egx-one-research-session-snapshot-2',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,session,parentSnapshotHash:'c'.repeat(64),researchDataReadiness:'PASS',readinessReasons:[],records:bar?[{ticker:'AAA',state:'READY_RESEARCH',authoritativeResearch:{...bar,session,researchState:'READY_RESEARCH',rowHash:'d'.repeat(64)}}]:[]};return {...body,snapshotHash:sha256(body),generatedAt:`${session}T15:00:00Z`}}
const bar=(o,h,l,c,v=1000)=>({open:o,high:h,low:l,close:c,volume:v});

test('forward policy is hash bound and mirrors frozen strategy execution rules',()=>{assert.equal(verifyForwardResolutionPolicy(policy),true);assert.equal(policy.costAssumptionBps,25);assert.equal(policy.sameBarAmbiguity,'STOP_FIRST');assert.equal(policy.strategySnapshotHash,strategyHash)});

test('no future session means strictly pending, never same-day resolution',()=>{const r=evaluateForwardPlan({entry,plan,policy,sessionSnapshots:[snap('2026-09-01',bar(101,112,94,105))]});assert.equal(r.state,'PENDING_AWAITING_FUTURE_SESSION');assert.equal(r.observedSessions.length,0)});

test('same future bar touching entry stop and targets resolves STOP_FIRST',()=>{const r=evaluateForwardPlan({entry,plan,policy,sessionSnapshots:[snap('2026-09-02',bar(101,116,94,108))]});assert.equal(r.state,'STOP');assert.equal(r.triggerSession,'2026-09-02');assert.equal(r.terminalSession,'2026-09-02');assert.equal(r.fill,102);assert.equal(r.exit,95);assert.equal(verifyForwardResolution(r),true)});

test('target2 wins over target1 after stop check',()=>{const r=evaluateForwardPlan({entry,plan,policy,sessionSnapshots:[snap('2026-09-02',bar(101,116,99,114))]});assert.equal(r.state,'TARGET2');assert.equal(r.exit,115);assert.ok(r.netReturnPct>0);assert.equal(verifyForwardResolution(r),true)});

test('not triggered is resolved only after full entry expiry window',()=>{const sessions=['2026-09-02','2026-09-03','2026-09-06','2026-09-07'].map((s,i)=>snap(s,bar(106+i,108+i,104+i,107+i)));const r=evaluateForwardPlan({entry,plan,policy,sessionSnapshots:sessions});assert.equal(r.state,'NOT_TRIGGERED');assert.equal(r.terminalSession,'2026-09-07');assert.equal(r.fill,null);assert.equal(r.netReturnPct,null);assert.equal(verifyForwardResolution(r),true)});

test('missing READY_RESEARCH bar fails closed before later evidence',()=>{const r=evaluateForwardPlan({entry,plan,policy,sessionSnapshots:[snap('2026-09-02',null),snap('2026-09-03',bar(101,111,99,109))]});assert.equal(r.state,'PENDING_EVIDENCE_GAP');assert.equal(r.missingSession,'2026-09-02')});

test('ledger resolver appends terminal result once and remains idempotent',()=>{const sessions=[snap('2026-09-02',bar(101,111,99,109))];const first=resolveForwardShadowLedger({ledger,policies:[policy],sessionSnapshots:sessions});assert.equal(first.added.length,1);assert.equal(first.ledger.resolutions.length,1);assert.equal(first.added[0].state,'TARGET1');const second=resolveForwardShadowLedger({ledger:first.ledger,policies:[policy],sessionSnapshots:sessions});assert.equal(second.added.length,0);assert.equal(second.ledger.resolutions.length,1)});
