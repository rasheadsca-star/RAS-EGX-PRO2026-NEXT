import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/hash.js';
import { createForwardShadowLedger, appendPublicationToForwardShadowLedger, verifyForwardShadowLedger } from '../src/research-forward-shadow-ledger.js';

function publication(session='2026-09-01'){const rec={ticker:'TEST',decision:'BUY_CANDIDATE',qualityScore:92,entryLow:99,entryHigh:100,stop:95,target1:108,target2:114,netRiskReward:1.5,entryExpirySessions:3,horizonSessions:10,planHash:'a'.repeat(64)};const body={authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,signalSession:session,sourceStrategySnapshotHash:'b'.repeat(64),strategyId:'CONTROLLED_PULLBACK',recommendations:[rec]};return {...body,publicationHash:sha256(body)}}
function regime(session='2026-09-01'){const body={authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,session,regime:'BALANCED'};return {...body,regimeHash:sha256(body)}}

test('forward shadow ledger starts after existing historical publication and stays empty',()=>{const l=createForwardShadowLedger({startAfterSession:'2026-08-31'}),same=appendPublicationToForwardShadowLedger(l,{publication:publication('2026-08-31'),regime:regime('2026-08-31')});assert.equal(same.entries.length,0);assert.equal(same.forwardEvidence,false);assert.ok(verifyForwardShadowLedger(same))});

test('new publication is hash chained and cannot be rewritten',()=>{let l=createForwardShadowLedger({startAfterSession:'2026-08-31'});l=appendPublicationToForwardShadowLedger(l,{publication:publication(),regime:regime()});assert.equal(l.entries.length,1);assert.ok(verifyForwardShadowLedger(l));assert.match(l.entries[0].entryHash,/^[a-f0-9]{64}$/);const changed=publication();changed.publicationHash='c'.repeat(64);assert.throws(()=>appendPublicationToForwardShadowLedger(l,{publication:changed,regime:regime()}),/SHADOW_SESSION_ALREADY_FROZEN/)});

test('tampering with frozen plan invalidates ledger hash verification',()=>{let l=createForwardShadowLedger({startAfterSession:'2026-08-31'});l=appendPublicationToForwardShadowLedger(l,{publication:publication(),regime:regime()});const x=structuredClone(l);x.entries[0].plans[0].target1=999;assert.equal(verifyForwardShadowLedger(x),false)});
