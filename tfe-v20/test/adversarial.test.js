import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBars, assessDataQuality } from '../src/quality.js';
import { analyzeTicker } from '../src/engine.js';
import { POLICY } from '../src/policy.js';

function gen(n=100, seed=1){
  let s=seed>>>0,p=20; const out=[]; const d=new Date('2026-01-01T00:00:00Z');
  const rnd=()=>((s=Math.imul(1664525,s)+1013904223>>>0)/2**32);
  for(let i=0;i<n;i++){
    const move=(rnd()-.47)*1.2; const o=p, c=Math.max(.5,p+move), h=Math.max(o,c)+rnd()*.5+.05, l=Math.max(.1,Math.min(o,c)-rnd()*.5-.05);
    out.push({date:d.toISOString().slice(0,10),open:o,high:h,low:l,close:c,volume:Math.floor(200000+rnd()*3000000)}); p=c; d.setUTCDate(d.getUTCDate()+1);
  } return out;
}

test('malformed high below close is rejected',()=>{const r=gen(70);r[5].high=r[5].close-1;assert.equal(normalizeBars(r).bars.length,69)});
test('duplicate dates cannot inflate sample',()=>{const r=gen(70);r.push({...r[10]});assert.equal(normalizeBars(r).bars.length,70)});
test('negative volume is clamped to zero',()=>{const r=gen(70);r[2].volume=-100;assert.equal(normalizeBars(r).bars[2].volume,0)});
test('stale flag fails closed',()=>assert.equal(assessDataQuality({bars:normalizeBars(gen(80)).bars,staleData:true}).state,'BLOCKED'));
test('update failure fails closed',()=>assert.equal(assessDataQuality({bars:normalizeBars(gen(80)).bars,updateFailed:true}).state,'BLOCKED'));
test('expected session behind fails closed',()=>{const b=normalizeBars(gen(80)).bars;assert.equal(assessDataQuality({bars:b,expectedSessionDate:'2027-01-01'}).state,'BLOCKED')});
test('random walk never receives execution permission',()=>{for(let i=1;i<=100;i++){const a=analyzeTicker({ticker:'R'+i,rows:gen(100,i)});assert.equal(a.permissions.executionAllowed,false)}});
test('blocked quality cannot be eligible',()=>{const a=analyzeTicker({ticker:'X',rows:gen(100),historyMeta:{warnings:['corporate_action_review_required']}});assert.equal(a.eligible,false)});
test('large stale-reference conflict remains review-only and never grants execution',()=>{const a=analyzeTicker({ticker:'X',rows:gen(100),historyMeta:{symbolVerified:true,symbolVerification:{verified:true,normalVerified:true,evidence:{localDifferencePct:30,guardedMaxDifferencePct:8}},warnings:['latest_close_conflict:25%']}});assert.equal(a.quality.state,'REVIEW');assert.equal(a.permissions.executionAllowed,false)});
test('high close conflict creates publication hold without identity hard block',()=>{const q=assessDataQuality({bars:normalizeBars(gen(100)).bars,symbolVerified:true,symbolVerification:{verified:true,normalVerified:true},warnings:['latest_close_conflict:25%']});assert.equal(q.state,'REVIEW');assert.equal(q.publicationHold,true);assert.equal(q.publicationHoldReason,'PRICE_RECONCILIATION_REQUIRED')});
test('structural RR floor is immutable',()=>assert.ok(POLICY.minStructuralNetRR>=.7));
test('pullback distance cap is immutable',()=>assert.ok(POLICY.maxPullbackDistanceAtr<=.7));
test('precision target remains subordinate to structural target',()=>{for(let i=1;i<=40;i++){const a=analyzeTicker({ticker:'X',rows:gen(120,i)});if(a.tradePlan)assert.ok(a.tradePlan.target1<=a.tradePlan.target2)}});
test('same-bar policy is declared conservative stop first',()=>{const a=analyzeTicker({ticker:'X',rows:gen(100)});assert.equal(a.methodology.sameBarAmbiguity,'STOP_FIRST')});
test('stale local-reference style conflict cannot ever unlock execution',()=>{const a=analyzeTicker({ticker:'X',rows:gen(100),historyMeta:{symbolVerified:true,symbolVerification:{verified:true,normalVerified:true,guardedVerified:false,evidence:{localDifferencePct:55,guardedMaxDifferencePct:8}},warnings:['latest_close_conflict:30%']}});assert.equal(a.permissions.executionAllowed,false);assert.notEqual(a.quality.reasons.includes('SYMBOL_IDENTITY_UNVERIFIED'),true)});
