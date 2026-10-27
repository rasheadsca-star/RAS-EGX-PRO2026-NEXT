'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {build}=require('../../scripts/research/egx-unified-gann-feed.cjs');
const s={sessionDate:'2026-10-27',status:'RESEARCH_READY',market:{analyzed:200,freshCount:176},funnelSummary:{speculative:{actionable:0,watch:12}},watchRadar:[{ticker:'ABUK',score:66,close:95}]};
test('current scan research never triggers trade execution',()=>{const x=build(s,{passed:true,critical:0,major:0},{expectedSession:'2026-10-27'});assert.equal(x.current,true);assert.equal(x.executionEligible,false);assert.equal(x.actionable,0);assert.equal(x.watchRadar[0].ticker,'ABUK')});
test('outdated scan is blocked',()=>{const x=build(s,{passed:true},{expectedSession:'2026-10-28'});assert.equal(x.current,false);assert.equal(x.publicationState,'HISTORICAL_OR_UNVERIFIED_RESEARCH')});
test('review failure is not certifiable',()=>{const x=build(s,{passed:false,major:1},{expectedSession:'2026-10-27'});assert.equal(x.reviewPassed,false);assert.equal(x.executionEligible,false)});
