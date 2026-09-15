'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const pipeline=require('../../astra/pipeline/g09-unified-decision-pipeline.cjs');
const {SPECS}=require('../../astra/strategies/g08-final-overlay.cjs');

const SESSION='2026-09-15';
function trainSessions(count=50,size=60){
  return Array.from({length:count},(_,d)=>Array.from({length:size},(_,i)=>({
    sessionDate:`2026-${d<28?'07':'08'}-${String(1+(d%28)).padStart(2,'0')}`,
    ticker:`T${String(i).padStart(2,'0')}`,xNew:[1,(i-size/2)/size,(d%5)/5],
    yTop10:i<10?1:0,yNetPositive:(i+d)%3!==0?1:0,yLargeLoss:(i+d)%19===0?1:0,
    validationStatus:'VALID',migrationValidationStatus:'VALID'
  })));
}
function currentRows(size=80,{lowTurnover=false}={}){
  return Array.from({length:size},(_,i)=>({
    sessionDate:SESSION,ticker:`T${String(i).padStart(2,'0')}`,xNew:[1,(i-30)/60,.4],
    momentumFailureRisk:.1,effectiveSupport:1.2,turnover20:lowTurnover?500000:30000000,
    rsi14:58,ret20:10,ret5:2,breakout20:1,atr14:2+(i%3)*.1,close:100+i*.25,
    validationStatus:'VALID',migrationValidationStatus:'VALID'
  }));
}
function canonicalRows(size=80){
  return Array.from({length:size},(_,i)=>({
    snapshotId:`SN-${String(i).padStart(2,'0')}`,securityId:`SEC-${String(i).padStart(2,'0')}`,ticker:`T${String(i).padStart(2,'0')}`,sessionDate:SESSION,
    validationStatus:'VALID',migrationValidationStatus:'VALID',ohlc:{open:99+i*.25,high:102+i*.25,low:98+i*.25,close:100+i*.25},volume:1000000+i*1000,turnover:30000000+i*10000,
    technicalInputs:{return1Pct:1+(i%5)*.05,return5Pct:2.5,return20Pct:6,aboveSma20:true,aboveSma50:true,volatility20AnnualizedPct:24,relativeVolume20:1.4},
    supportResistanceInputs:{asOfSessionDate:SESSION}
  }));
}
function guardHistory(n=60){return Array.from({length:n},(_,i)=>{const d=new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10);return{sessionDate:d,close:100+i*.1,volume:1000000+i,turnover:30000000+i*1000,validationStatus:'VALID',migrationValidationStatus:'VALID'}})}
function context(overrides={}){
  const c={
    sessionDate:SESSION,canonicalSnapshot:{snapshotId:'UNIVERSE-2026-09-15',sessionDate:SESSION,rows:canonicalRows()},
    historyIdentities:{range:'validation-approved-through-2026-09-15'},historyByTicker:{},modelGuardHistory:guardHistory(),
    modelTrainingSessions:trainSessions(),modelCurrentRows:currentRows(),capitalEgp:1000000,
    approvedStrategyVersions:{PORTFOLIO_BASKET_EQUAL_WEIGHT:SPECS.PORTFOLIO_BASKET_EQUAL_WEIGHT.sourceCommit},
    approvedConfig:{basketSize:3},requestedStrategyIds:Object.keys(SPECS),generatedAt:'2026-09-15T20:00:00+03:00',applicationVersion:'ASTRA_SHADOW_G09',codeVersion:pipeline.VERSION.pipeline
  };
  return Object.assign(c,overrides);
}
function run(o={}){return pipeline.runUnifiedDecisionPipeline(context(o))}

test('pipeline integration: canonical -> regime -> farm -> evidence -> agreement -> rank -> risk -> basket -> snapshot',()=>{
  const r=run();assert.equal(r.ok,true);assert.equal(r.status,'DECISION_SNAPSHOT_READY');assert.equal(r.decisionSnapshot.marketUniverseEvaluated,80);assert.equal(r.decisionSnapshot.top5.length,3);assert.equal(r.decisionSnapshot.productionCutover,false);
});
test('production eligibility is distinct from internal executability',()=>{
  const c=context();const regime=pipeline.computeRegime(c);const rows=Object.keys(SPECS).map(id=>pipeline.productionEligibility(id,c,regime));assert.equal(rows.filter(x=>x.internallyExecutable).length,18);assert.equal(rows.filter(x=>x.productionEligible).length,1);
});
test('11 retired/experimental strategies stay excluded from production ranking',()=>{
  const r=run();const excluded=r.decisionSnapshot.productionEligibility.researchExcluded;assert.equal(excluded,17);const re=Object.values(SPECS).filter(x=>['retired','experimental'].includes(x.lifecycleStatus));assert.equal(re.length,11);assert.ok(re.every(x=>x.productionEligible===false));
});
test('QUANT_EDGE is explicitly forbidden from production eligibility',()=>{const c=context(),reg=pipeline.computeRegime(c),q=pipeline.productionEligibility('QUANT_EDGE',c,reg);assert.equal(q.productionEligible,false);assert.match(q.reason,/HISTORICAL_OUTPUT_ONLY/)});
test('QUANT_EDGE payload cannot influence live semantic decision hash',()=>{const a=run();const b=run({quantEdge:{score:999,signal:'BUY',confidence:1}});assert.equal(a.decisionSnapshot.semanticDecisionHash,b.decisionSnapshot.semanticDecisionHash);assert.equal(b.decisionSnapshot.quantEdgeLiveInfluence,0)});
test('all 18 requested strategies cannot leak non-production voters into the farm',()=>{const c=context();const reg=pipeline.computeRegime(c),farm=pipeline.runStrategyFarm(c,reg,pipeline.decisionInputIdentity(c,reg));assert.deepEqual(farm.productionStrategyIds,['PORTFOLIO_BASKET_EQUAL_WEIGHT']);assert.equal(farm.executions.length,1)});
test('unknown research strategy request is failure-isolated and does not crash active production strategy',()=>{const c=context({requestedStrategyIds:['UNKNOWN_RESEARCH','PORTFOLIO_BASKET_EQUAL_WEIGHT']});const reg=pipeline.computeRegime(c),farm=pipeline.runStrategyFarm(c,reg,pipeline.decisionInputIdentity(c,reg));assert.equal(farm.allProductionFailed,false);assert.equal(farm.executions.length,1)});
test('single canonical snapshot rule rejects mixed current sessions',()=>{const c=context();c.canonicalSnapshot.rows[4].sessionDate='2026-09-14';const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'DECISION_INPUT_INVALID')});
test('future historical bar is rejected by temporal-leakage guard',()=>{const c=context();c.historyByTicker={T00:[{sessionDate:'2026-09-16',validationStatus:'VALID',migrationValidationStatus:'VALID'}]};const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'TEMPORAL_LEAKAGE_GUARD_FAILED')});
test('future support/resistance is rejected by temporal-leakage guard',()=>{const c=context();c.canonicalSnapshot.rows[0].supportResistanceInputs.asOfSessionDate='2026-09-16';const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'TEMPORAL_LEAKAGE_GUARD_FAILED')});
test('future model-training row is rejected',()=>{const c=context();c.modelTrainingSessions[0][0].sessionDate='2026-09-16';const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'TEMPORAL_LEAKAGE_GUARD_FAILED')});
test('future outcome fields cannot enter decision input',()=>{const c=context();c.modelTrainingSessions[0][0].forwardOutcome={returnPct:99};const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'TEMPORAL_LEAKAGE_GUARD_FAILED')});
test('invalid migrated canonical row remains quarantined from entire G09 pipeline',()=>{const c=context();c.canonicalSnapshot.rows[0].migrationValidationStatus='INVALID';const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'INVALID_UNRESOLVED_DATA_QUARANTINED')});
test('unresolved training data remains quarantined from entire G09 pipeline',()=>{const c=context();c.modelTrainingSessions[0][0].migrationValidationStatus='UNRESOLVED';const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'INVALID_UNRESOLVED_DATA_QUARANTINED')});
test('market regime is deterministic, versioned and tied to same session',()=>{const c=context(),a=pipeline.computeRegime(c),b=pipeline.computeRegime(structuredClone(c));assert.equal(a.semanticHash,b.semanticHash);assert.equal(a.version,'EGX_PRO_MARKET_REGIME_BREADTH_1.0');assert.equal(a.metrics.sessionDate,SESSION);assert.equal(a.regime,'RISK_ON')});
test('market regime does not invent calibrated confidence probability',()=>{const x=pipeline.computeRegime(context());assert.equal(Object.hasOwn(x,'confidenceProbability'),false);assert.equal(Object.hasOwn(x,'probability'),false)});
test('raw and normalized strategy signals are both preserved',()=>{const r=run(),o=r.decisionSnapshot.top5[0];assert.equal(o.entryPlan.low<o.entryPlan.high,true);const ref=o.strategyExecutionRef;assert.match(ref,/^G09-SE-/);assert.equal(o.trace.strategyExecutionRefs[0],ref)});
test('evidence-family mechanism prevents same-family double counting',()=>{const items=[{evidenceId:'a',evidenceFamily:'MODEL_SELECTION'},{evidenceId:'b',evidenceFamily:'MODEL_SELECTION'},{evidenceId:'c',evidenceFamily:'LIQUIDITY'}];const d=pipeline.dedupeEvidence(items);assert.equal(d.filter(x=>x.independent).length,2);assert.equal(d[1].duplicateOf,'a')});
test('agreement exposes raw vs independent evidence and contradictions separately',()=>{const r=run(),a=r.decisionSnapshot.top5[0].agreement;assert.ok(a.rawEvidenceCount>a.independentEvidenceCount);assert.deepEqual(a.evidenceFamilies,['LIQUIDITY','MODEL_SELECTION','REGIME','STRUCTURE']);assert.equal(Array.isArray(a.contradictionFlags),true)});
test('ranking is deterministic across identical executions',()=>{const a=run(),b=run();assert.deepEqual(a.decisionSnapshot.top5.map(x=>[x.ticker,x.rank,x.decisionScore]),b.decisionSnapshot.top5.map(x=>[x.ticker,x.rank,x.decisionScore]));assert.equal(a.decisionSnapshot.semanticDecisionHash,b.decisionSnapshot.semanticDecisionHash)});
test('ranking tie-break is ticker ascending',()=>{const mk=t=>({ticker:t,signal:{rawScore:1}});const r=pipeline.rankCandidates([mk('ZZZZ'),mk('AAAA')]);assert.deepEqual(r.map(x=>x.ticker),['AAAA','ZZZZ'])});
test('decision score is explicitly not described as probability of success',()=>{const r=run(),meaning=r.decisionSnapshot.top5[0].ranking.meaning.toLowerCase();assert.match(meaning,/not a probability of success/)});
test('ranking introduces no unexplained magic weight',()=>{const r=run(),components=r.decisionSnapshot.top5[0].ranking.components;assert.equal(components.length,1);assert.equal(components[0].weight,null);assert.ok(components[0].provenance.path)});
test('risk validates EGP units, positive quantity, max loss and exposure',()=>{const r=run(),risk=r.decisionSnapshot.top5[0].risk;assert.ok(risk.quantity>0);assert.ok(risk.maxLossEgp>=0);assert.ok(risk.exposurePct>0);assert.equal(risk.units.capital,'EGP');assert.ok(risk.exposurePct<=risk.memberExposureCapPct)});
test('zero or invalid capital fails instead of producing NaN risk',()=>{const r=run({capitalEgp:0});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'DECISION_INPUT_INVALID')});
test('NaN capital is rejected at pipeline boundary',()=>{const r=run({capitalEgp:NaN});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'DECISION_INPUT_INVALID')});
test('risk cannot rescue an invalid stop relationship',()=>{const candidate={ticker:'X',signal:{entry:{high:100},stopLoss:100,targets:[110]}};const x=pipeline.riskPlan(candidate,1000000,pipeline.computeRegime(context()),3);assert.equal(x.ok,false);assert.equal(x.diagnostic.code,'RISK_PLAN_INVALID')});
test('basket obeys 50% recovered pilot allocation and KEEP_CASH policy',()=>{const b=run().decisionSnapshot.basket;assert.ok(b.totalExposurePct<=50);assert.ok(b.cashReservePct>=50);assert.equal(b.failedWeightPolicy,'KEEP_CASH')});
test('Top 5 is derived from ranking and never padded beyond valid candidates',()=>{const r=run();assert.equal(r.decisionSnapshot.top5.length,3);assert.deepEqual(r.decisionSnapshot.top5.map(x=>x.rank),[1,2,3])});
test('Top 5 entries all belong to one DecisionSnapshot/session lineage',()=>{const r=run(),s=r.decisionSnapshot;assert.equal(s.sessionDate,SESSION);assert.ok(s.top5.every(x=>x.trace.decisionInputSnapshotId===s.decisionInputSnapshotId));assert.equal(new Set(s.top5.map(x=>x.trace.decisionInputSnapshotId)).size,1)});
test('full market decision state retains all 80 evaluated securities',()=>{const s=run().decisionSnapshot;assert.equal(s.marketStates.length,80);assert.equal(s.marketUniverseEvaluated,80);assert.equal(new Set(s.marketStates.map(x=>x.ticker)).size,80)});
test('non-selected securities preserve rejection/state traceability',()=>{const s=run().decisionSnapshot;const non=s.marketStates.filter(x=>x.state!=='ELIGIBLE_OPPORTUNITY');assert.ok(non.length>0);assert.ok(non.every(x=>Array.isArray(x.reasons)&&x.reasons.length))});
test('DecisionSnapshot semantic hash ignores generatedAt nondeterminism',()=>{const a=run({generatedAt:'2026-09-15T20:00:00+03:00'}),b=run({generatedAt:'2026-09-15T20:10:00+03:00'});assert.notEqual(a.decisionSnapshot.generatedAt,b.decisionSnapshot.generatedAt);assert.equal(a.decisionSnapshot.semanticDecisionHash,b.decisionSnapshot.semanticDecisionHash);assert.equal(a.decisionSnapshot.decisionSnapshotId,b.decisionSnapshot.decisionSnapshotId)});
test('meaningful approved configuration change changes semantic decision hash',()=>{const a=run(),b=run({approvedConfig:{basketSize:4}});assert.notEqual(a.decisionSnapshot.semanticDecisionHash,b.decisionSnapshot.semanticDecisionHash);assert.equal(b.decisionSnapshot.top5.length,4)});
test('invalid unapproved basket-size config blocks production execution',()=>{const r=run({approvedConfig:{basketSize:2}});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,'ALL_PRODUCTION_STRATEGIES_FAILED')});
test('valid zero-opportunity session is distinct from pipeline failure',()=>{const c=context({modelCurrentRows:currentRows(80,{lowTurnover:true})});const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,true);assert.equal(r.status,'VALID_ZERO_OPPORTUNITY_SESSION');assert.equal(r.decisionSnapshot.top5.length,0);assert.ok(r.decisionSnapshot.diagnostics.some(d=>d.code==='VALID_ZERO_OPPORTUNITY_SESSION'))});
test('broken canonical pipeline cannot masquerade as valid zero opportunities',()=>{const c=context();c.canonicalSnapshot.rows=[];const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,false);assert.equal(r.status,'PIPELINE_FAILED');assert.notEqual(r.diagnostics[0].code,'VALID_ZERO_OPPORTUNITY_SESSION')});
test('missing canonical model guard history is pipeline failure, not valid zero',()=>{const c=context();delete c.modelGuardHistory;const r=pipeline.runUnifiedDecisionPipeline(c);assert.equal(r.ok,false);assert.equal(r.status,'PIPELINE_FAILED');assert.notEqual(r.diagnostics[0].code,'VALID_ZERO_OPPORTUNITY_SESSION')});
test('DecisionSnapshot is immutable once issued',()=>{const s=run().decisionSnapshot;assert.equal(Object.isFrozen(s),true);assert.equal(Object.isFrozen(s.top5),true);assert.throws(()=>{s.status='MUTATED'},TypeError)});
test('new G09 pipeline contains no legacy network/runtime calls or fallback endpoints',()=>{const src=fs.readFileSync(path.join(__dirname,'../../astra/pipeline/g09-unified-decision-pipeline.cjs'),'utf8');for(const token of ['fetch(','axios','http.request','https.request','quant-edge-shadow.vercel.app','sepax-strategy-stable.vercel.app','raw.githubusercontent.com'])assert.equal(src.includes(token),false,token)});
test('pipeline reports zero legacy-network calls and no production cutover',()=>{const s=run().decisionSnapshot;assert.equal(s.legacyNetworkCalls,0);assert.equal(s.productionCutover,false);assert.equal(s.shadowMode,true)});
test('adding all research/retired strategy inputs cannot change production output',()=>{const a=run(),b=run({researchInputsByStrategy:Object.fromEntries(Object.keys(SPECS).map(id=>[id,{fakeScore:999,fakeSignal:'BUY'}]))});assert.equal(a.decisionSnapshot.semanticDecisionHash,b.decisionSnapshot.semanticDecisionHash)});
test('strategy execution and ranking traces reach canonical snapshot refs',()=>{const s=run().decisionSnapshot;for(const o of s.top5){assert.ok(o.trace.evidenceRefs.length);assert.ok(o.trace.strategyExecutionRefs.length);assert.ok(o.trace.inputSnapshotRefs.length);assert.ok(o.ranking.components[0].provenance.path)}});
test('same meaningful inputs always produce identical stable snapshot identity',()=>{const ids=Array.from({length:3},()=>run().decisionSnapshot.decisionSnapshotId);assert.equal(new Set(ids).size,1)});
test('80-security certification fixture completes without N+1 network access',()=>{const s=run().decisionSnapshot;assert.equal(s.marketUniverseEvaluated,80);assert.ok(s.durationMs<5000);assert.equal(s.legacyNetworkCalls,0)});
test('G09 diagnostic registry includes required material failure classes',()=>{for(const code of ['DECISION_INPUT_INVALID','REGIME_EXECUTION_FAILED','STRATEGY_EXECUTION_FAILED','INSUFFICIENT_INDEPENDENT_EVIDENCE','EVIDENCE_CONTRADICTION','RISK_PLAN_INVALID','BASKET_CONSTRAINT_FAILED','VALID_ZERO_OPPORTUNITY_SESSION','DECISION_SNAPSHOT_INCONSISTENT','TEMPORAL_LEAKAGE_GUARD_FAILED'])assert.ok(pipeline.DIAGNOSTIC_CODES.includes(code))});
