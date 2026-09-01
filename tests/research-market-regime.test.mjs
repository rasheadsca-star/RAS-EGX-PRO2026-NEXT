import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyResearchMarketRegime, scoreDynamicResearchConfidence } from '../src/research-market-regime.js';

function rows(kind='bull',n=40){return Array.from({length:n},(_,i)=>kind==='bull'?{ticker:`T${i}`,momentum20Pct:6+i%3,rsi14:58,relativeVolume20:1.2,atrPct:2,trendAligned:true,aboveSma20:true,aboveSma50:true,positiveMomentum:true}:{ticker:`T${i}`,momentum20Pct:-7,rsi14:38,relativeVolume20:.55,atrPct:5,trendAligned:false,aboveSma20:false,aboveSma50:false,positiveMomentum:false})}

test('fixed breadth policy detects broad bullish regime without outcome inputs',()=>{const r=classifyResearchMarketRegime({session:'2026-08-31',metricsRows:rows('bull')});assert.equal(r.regime,'BULLISH_BROAD');assert.equal(r.policy.maxRecommendationsPerSession,12);assert.equal(r.classificationPolicy,'FIXED_EX_ANTE_BREADTH_POLICY_V1_NOT_OUTCOME_TUNED');assert.match(r.regimeHash,/^[a-f0-9]{64}$/)});

test('risk-off regime tightens quality and confidence gate',()=>{const r=classifyResearchMarketRegime({session:'2026-08-31',metricsRows:rows('bear')});assert.equal(r.regime,'RISK_OFF');assert.equal(r.policy.maxRecommendationsPerSession,2);assert.equal(r.policy.minQualityScore,90);const weak=scoreDynamicResearchConfidence({executableResearchPlan:true,qualityScore:84,netRiskReward:1.4,diagnostics:{relativeVolume20:1.2}},r),strong=scoreDynamicResearchConfidence({executableResearchPlan:true,qualityScore:98,netRiskReward:1.8,diagnostics:{relativeVolume20:2}},r);assert.equal(weak.acceptedByRegimeGuard,false);assert.equal(strong.confidenceMeaning,'RESEARCH_RELATIVE_CONFIDENCE_INDEX_NOT_SUCCESS_PROBABILITY');assert.ok(strong.confidenceIndex>weak.confidenceIndex)});

test('insufficient cross-section fails safe to UNKNOWN',()=>{const r=classifyResearchMarketRegime({session:'2026-08-31',metricsRows:rows('bull',12)});assert.equal(r.regime,'UNKNOWN');assert.equal(r.policy.maxRecommendationsPerSession,3)});
