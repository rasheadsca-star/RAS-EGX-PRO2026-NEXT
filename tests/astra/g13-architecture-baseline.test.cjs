'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {scan,importsFrom,zoneFor,runtimeBoundaryManifest}=require('../../astra/certification/g13-architecture-baseline.cjs');
const registry=require('../../astra/strategies/strategy-registry.cjs');
const runner=require('../../astra/strategies/strategy-runner.cjs');
const privateCore=require('../../astra/strategies/g08-final-overlay.cjs');
const {SOURCE_PATHS}=require('../../astra/contracts/strategy-provenance.cjs');
const marketCalendar=require('../../astra/core/market-calendar.cjs');
const symbolMaster=require('../../astra/core/symbol-master.cjs');
const canonicalData=require('../../astra/core/canonical-data.cjs');
const historicalStore=require('../../astra/core/historical-store.cjs');
const healthPrimitives=require('../../astra/contracts/data-health-primitives.cjs');
const indicators=require('../../astra/analysis/indicators.cjs');
const technicalAnalysis=require('../../astra/analysis/technical-analysis.cjs');
const supportResistance=require('../../astra/analysis/support-resistance.cjs');
const relativeStrength=require('../../astra/analysis/relative-strength.cjs');

test('G13 baseline preserves the certified G01-G12 boundary and keeps G13 pending',()=>{
  const r=scan();
  assert.equal(r.priorGateBoundary.g01ThroughG12Green,true);
  assert.equal(r.priorGateBoundary.g12Status,'GREEN');
  assert.equal(r.priorGateBoundary.runtimeLegacyDependencyCount,0);
  assert.equal(r.priorGateBoundary.dependenciesClosed,'8/8');
  assert.equal(r.priorGateBoundary.productionCutover,false);
  assert.equal(r.gateStatus,'PENDING');
  assert.equal(r.productionCutover,false);
  assert.equal(r.contract.logicalModuleCount,30);
});
test('G13 baseline builds a real static source/import graph',()=>{
  const r=scan();
  assert.ok(r.scanScope.sourceFiles>0);
  assert.ok(r.dependencyGraph.nodeCount>0);
  assert.ok(r.dependencyGraph.edgeCount>0);
  assert.ok(r.graph.edges.some(e=>e.classification==='relative-static-import'));
});
test('G13 baseline retains missing mappings while Family 6 removes the shared G09 physical collapse',()=>{
  const r=scan();
  assert.equal(r.findings.items.some(x=>x.code==='PHYSICAL_BOUNDARY_COLLAPSE'),false);
  assert.ok(r.findings.items.some(x=>x.code==='NO_DEDICATED_IMPLEMENTATION_BOUNDARY'));
});
test('data-health uses public registry and no longer imports the decision pipeline directly',()=>{
  const r=scan();
  const xs=r.findings.items.filter(x=>x.file==='astra/data-health/g11-data-health.cjs');
  assert.equal(xs.some(x=>x.code==='DATA_HEALTH_DECISION_COUPLING'),false);
  assert.equal(xs.some(x=>x.code==='FORBIDDEN_LOGICAL_IMPORT'),false);
  assert.equal(xs.some(x=>x.target==='astra/strategies/g08-final-overlay.cjs'),false);
  assert.ok(r.graph.edges.some(e=>e.from==='astra/data-health/g11-data-health.cjs'&&e.target==='astra/strategies/strategy-registry.cjs'));
});
test('active adapters are explicit registered boundaries outside the 30 business modules',()=>{
  assert.equal(zoneFor('astra/runtime/bridges/v19-local.cjs').kind,'registered-adapter-boundary');
  assert.equal(zoneFor('deploy/rc2-safe-shell/api/index.js').kind,'registered-adapter-boundary');
  assert.equal(zoneFor('gann-fusion-x/scripts/sync-sepa.cjs').kind,'registered-adapter-boundary');
});
test('import parser handles commonjs and esm static imports',()=>{
  const x=importsFrom("const a=require('../x.cjs');\nimport b from './y.js';\nimport 'node:fs';");
  assert.deepEqual(new Set(x),new Set(['../x.cjs','./y.js','node:fs']));
});
test('baseline scanner does not mutate gate state',()=>{
  const before=fs.readFileSync('04_ACCEPTANCE_GATES.json','utf8');
  scan();
  const after=fs.readFileSync('04_ACCEPTANCE_GATES.json','utf8');
  assert.equal(after,before);
});

test('strategy registry and runner are dedicated public architecture boundaries',()=>{
  assert.deepEqual(zoneFor('astra/strategies/strategy-registry.cjs').modules,['strategy-registry']);
  assert.equal(zoneFor('astra/strategies/strategy-registry.cjs').kind,'target-module');
  assert.deepEqual(zoneFor('astra/strategies/strategy-runner.cjs').modules,['strategy-runner']);
  assert.equal(zoneFor('astra/strategies/strategy-runner.cjs').kind,'target-module');
  assert.equal(zoneFor('astra/strategies/g08-final-overlay.cjs').kind,'private-implementation');
});
test('public strategy facades preserve certified G08 descriptor and execution semantics',()=>{
  assert.deepEqual(registry.listStrategyIds(),Object.keys(privateCore.SPECS));
  for(const id of registry.listStrategyIds())assert.equal(registry.getStrategyDescriptor(id),privateCore.SPECS[id]);
  const input={snapshot:{snapshotId:'G13-FACADE',ticker:'COMI',sessionDate:'2026-09-17',validationStatus:'INVALID'},history:[]};
  assert.deepEqual(runner.executeStrategy('TREND_FOLLOW',input),privateCore.executeStrategy('TREND_FOLLOW',input));
});
test('first G13 remediation family removes direct G08 implementation access from selected consumers',()=>{
  const files=[
    'astra/data-health/g11-data-health.cjs',
    'astra/runtime/bridges/v19-local.cjs',
    'astra/runtime/bridges/v20-local.cjs',
    'astra/runtime/bridges/sepa-local.cjs',
    'astra/runtime/bridges/tfe-local.cjs'
  ];
  for(const file of files){
    const src=fs.readFileSync(file,'utf8');
    assert.equal(src.includes('g08-final-overlay.cjs'),false,file);
  }
});

test('private strategy implementation may compose internally but active consumers cannot bypass public facades',()=>{
  const r=scan();
  const directPrivate=r.findings.items.filter(x=>x.code==='DIRECT_INTERNAL_IMPLEMENTATION_ACCESS'&&x.targetZone==='strategy-core-private');
  assert.equal(directPrivate.length,0,JSON.stringify(directPrivate,null,2));
  const guarded=[
    'astra/certification/g08-certify.cjs',
    'astra/certification/g09-certify.cjs',
    'astra/pipeline/g09-unified-decision-pipeline.cjs',
    'astra/data-health/g11-data-health.cjs',
    'astra/runtime/bridges/v19-local.cjs',
    'astra/runtime/bridges/v20-local.cjs',
    'astra/runtime/bridges/sepa-local.cjs',
    'astra/runtime/bridges/tfe-local.cjs'
  ];
  for(const file of guarded){
    const src=fs.readFileSync(file,'utf8');
    assert.equal(/require\s*\(\s*['"][^'"]*\/g08-[^'"]*\.cjs['"]\s*\)/.test(src),false,file);
  }
});
test('historical parity control remains the only non-facade policy exception for private G08 imports',()=>{
  const r=scan();
  const privateEdges=r.graph.edges.filter(e=>e.targetZone==='strategy-core-private');
  const illegal=privateEdges.filter(e=>{
    const z=zoneFor(e.from);
    return !(z.kind==='private-implementation'||z.id==='strategy-registry'||z.id==='strategy-runner'||z.id==='parity-control');
  });
  assert.deepEqual(illegal,[]);
});

test('Family 3 isolates certification and data-health from direct business implementation imports',()=>{
  const r=scan();
  assert.equal(r.findings.items.filter(x=>x.code==='FORBIDDEN_LOGICAL_IMPORT').length,0);
  assert.equal(r.findings.items.filter(x=>x.code==='DATA_HEALTH_DECISION_COUPLING').length,0);
  const dh=fs.readFileSync('astra/data-health/g11-data-health.cjs','utf8');
  assert.equal(dh.includes("require('../pipeline/g09-unified-decision-pipeline.cjs')"),false);
  for(const p of ['astra/certification/g08-certify.cjs','astra/certification/g09-certify.cjs','astra/certification/g11-certify.cjs','astra/certification/g11-derived-build-failures.cjs','astra/certification/g11-source-dispositions.cjs']){
    const s=fs.readFileSync(p,'utf8');
    assert.equal(/require\(['"]\.\.\/(?:pipeline|strategies|data-health)\//.test(s),false,p);
  }
});

test('Family 4 registry covers exactly the eight active adapters without changing target module count',()=>{
  const m=runtimeBoundaryManifest();
  assert.equal(m.boundaries.length,8);
  assert.equal(new Set(m.boundaries.map(x=>x.file)).size,8);
  assert.equal(m.ioProviders.length,3);
  assert.equal(m.policy.targetArchitectureModulesUnchanged,30);
  assert.equal(m.productionCutover,false);
  for(const b of m.boundaries)assert.equal(zoneFor(b.file).kind,'registered-adapter-boundary',b.file);
  for(const p of m.ioProviders)assert.equal(zoneFor(p.file).kind,'io-boundary',p.file);
});
test('Family 4 registered adapters have no unregistered/direct IO/network/data-path findings',()=>{
  const r=scan(),m=runtimeBoundaryManifest();
  const registered=new Set(m.boundaries.map(x=>x.file));
  const blocked=new Set(['UNREGISTERED_ACTIVE_LAYER','DIRECT_FILE_IO_BYPASS','DIRECT_NETWORK_ACCESS','DIRECT_DATA_PATH_COUPLING']);
  const bad=r.findings.items.filter(x=>registered.has(x.file)&&blocked.has(x.code));
  assert.deepEqual(bad,[]);
  assert.equal(r.findings.items.filter(x=>x.code==='UNREGISTERED_ACTIVE_LAYER').length,0);
  assert.equal(r.findings.items.filter(x=>x.code==='DIRECT_FILE_IO_BYPASS').length,0);
  assert.equal(r.findings.items.filter(x=>x.code==='DIRECT_NETWORK_ACCESS').length,0);
});
test('Family 4 moves concrete IO ownership behind explicit providers',()=>{
  const app=fs.readFileSync('astra/runtime/v18/app.js','utf8');
  const client=fs.readFileSync('astra/runtime/v18/resource-client.js','utf8');
  const api=fs.readFileSync('deploy/rc2-safe-shell/api/index.js','utf8');
  const sync=fs.readFileSync('gann-fusion-x/scripts/sync-sepa.cjs','utf8');
  const q=fs.readFileSync('astra/runtime/bridges/quant-edge-archive.cjs','utf8');
  assert.equal(/\bfetch\s*\(/.test(app),false);
  assert.equal(/docs\/astra\//.test(app),false);
  assert.equal(/\bfetch\s*\(/.test(client),true);
  assert.equal(/https?:\/\//i.test(client),false);
  assert.equal(/\b(?:readFileSync|writeFileSync|existsSync)\s*\(/.test(api),false);
  assert.equal(/\b(?:readFileSync|writeFileSync|existsSync)\s*\(/.test(sync),false);
  assert.equal(/docs\/astra\//.test(q),false);
});

test('Family 5 isolates strategy provenance paths from private G08 implementation without semantic drift',()=>{
  const src=fs.readFileSync('astra/strategies/g08-internal-strategies.cjs','utf8');
  for(const [id,paths] of Object.entries(SOURCE_PATHS)){
    for(const p of paths)assert.equal(src.includes(p),false,`${id}: provenance path leaked into private implementation: ${p}`);
    assert.deepEqual(privateCore.SPECS[id].sourcePaths,[...paths],id);
  }
  const prior=JSON.parse(fs.readFileSync('docs/astra/STRATEGY_RECONSTRUCTION_MATRIX.json','utf8'));
  const byId=new Map((prior.strategies||[]).map(x=>[x.strategyId,x]));
  for(const [id,paths] of Object.entries(SOURCE_PATHS)){
    const row=byId.get(id);
    assert.ok(row,`missing persisted G08 evidence for ${id}`);
    assert.deepEqual(row.sourcePaths,[...paths],`${id}: sourcePaths drifted from certified G08 evidence`);
  }
});
test('Family 5 keeps direct strategy data-path coupling at zero through Family 6',()=>{
  const r=scan();
  const xs=r.findings.items.filter(x=>x.code==='DIRECT_DATA_PATH_COUPLING');
  assert.deepEqual(xs,[]);
  assert.equal(r.findings.byCode.DIRECT_DATA_PATH_COUPLING||0,0);
});

test('Family 6 maps all nine former G09 shared logical modules to dedicated physical boundaries',()=>{
  const r=scan();
  const ids=['market-regime','signal-normalizer','evidence-engine','agreement-engine','ranking-engine','risk-engine','basket-engine','position-sizing','diagnostics'];
  const by=new Map(r.moduleIsolation.map(x=>[x.module,x]));
  for(const id of ids){
    const m=by.get(id);
    assert.ok(m,id);
    assert.equal(m.status,'DEDICATED_ZONE',id);
    assert.equal(m.dedicatedFiles.length,1,id);
  }
  assert.equal(zoneFor('astra/pipeline/g09-unified-decision-pipeline.cjs').kind,'control-plane');
  assert.equal(zoneFor('astra/pipeline/g09-shared.cjs').kind,'public-contract');
});
test('Family 6 keeps HIGH findings at zero during later medium-boundary remediation',()=>{
  const r=scan();
  assert.equal(r.findings.high,0,JSON.stringify(r.findings.items.filter(x=>x.severity==='HIGH'),null,2));
  assert.equal(r.findings.byCode.PHYSICAL_BOUNDARY_COLLAPSE||0,0);
  assert.ok(r.findings.medium<=16);
  assert.equal(r.productionCutover,false);
});

test('Family 7 gives market-calendar and symbol-master dedicated physical ownership',()=>{
  const r=scan(),by=new Map(r.moduleIsolation.map(x=>[x.module,x]));
  for(const id of ['market-calendar','symbol-master']){
    const m=by.get(id);
    assert.ok(m,id);
    assert.equal(m.status,'DEDICATED_ZONE',id);
    assert.equal(m.dedicatedFiles.length,1,id);
  }
  assert.equal(zoneFor('astra/core/market-calendar.cjs').kind,'target-module');
  assert.equal(zoneFor('astra/core/symbol-master.cjs').kind,'target-module');
});
test('Family 7 preserves Cairo session and symbol identity semantics through the shared contract',()=>{
  const policy={market:{tradingDays:['Sunday','Monday','Tuesday','Wednesday','Thursday'],tradingDayNumbersJs:[0,1,2,3,4],expectedPostSessionHourCairo:15}};
  assert.equal(marketCalendar.expectedSession('2026-09-14T16:00:00+03:00',policy),'2026-09-14');
  assert.equal(marketCalendar.expectedSession('2026-09-14T14:00:00+03:00',policy),'2026-09-13');
  assert.equal(marketCalendar.tradingLag('2026-09-10','2026-09-14',policy),2);
  assert.equal(healthPrimitives.expectedSession,marketCalendar.expectedSession);
  assert.equal(healthPrimitives.tradingLag,marketCalendar.tradingLag);
  assert.equal(symbolMaster.normalizeTicker(' comi.eg? '),'COMI.EG');
  assert.deepEqual(symbolMaster.symbolRows({COMI:{active:true}}),[{active:true,ticker:'COMI'}]);
  const verified={active:true,ticker:'COMI',isin:'EGS60121C018',g11IdentityVerification:{verified:true,method:'EXACT_TICKER_ISIN_EGX_EVIDENCE',canonicalTicker:'COMI',exchange:'EGX',isin:'EGS60121C018',evidenceUrls:['https://example.com/a','https://example.com/b'],evidenceSummary:'verified'}};
  assert.equal(symbolMaster.reviewedSecurityIdentity(verified),true);
  assert.equal(healthPrimitives.normalizeTicker,symbolMaster.normalizeTicker);
  assert.equal(healthPrimitives.reviewedSecurityIdentity,symbolMaster.reviewedSecurityIdentity);
});
test('Family 7 foundational mappings remain closed during later remediation',()=>{
  const r=scan();
  assert.equal(r.findings.high,0);
  const missing=r.findings.items.filter(x=>x.code==='NO_DEDICATED_IMPLEMENTATION_BOUNDARY').map(x=>x.module);
  assert.equal(missing.includes('market-calendar'),false);
  assert.equal(missing.includes('symbol-master'),false);
  assert.ok(missing.length<=14);
});

test('Family 8 gives canonical-data and historical-store dedicated physical ownership',()=>{
  const r=scan(),by=new Map(r.moduleIsolation.map(x=>[x.module,x]));
  for(const id of ['canonical-data','historical-store']){
    const m=by.get(id);
    assert.ok(m,id);
    assert.equal(m.status,'DEDICATED_ZONE',id);
    assert.equal(m.dedicatedFiles.length,1,id);
  }
  assert.equal(zoneFor('astra/core/canonical-data.cjs').kind,'target-module');
  assert.equal(zoneFor('astra/core/historical-store.cjs').kind,'target-module');
});
test('Family 8 owns canonical snapshot and point-in-time history validation without changing fail-closed semantics',()=>{
  const session='2026-09-17';
  const good={snapshotId:'C1',sessionDate:session,rows:[{ticker:'COMI',sessionDate:session,validationStatus:'VALID',migrationValidationStatus:'VALID',supportResistanceInputs:{asOfSessionDate:session},technicalInputs:{regimeSessionDate:session}}]};
  assert.deepEqual(canonicalData.validateCanonicalSnapshot(good,session),{errors:[],temporal:[],quarantined:[],rows:good.rows,universeCount:1});
  const future={...good,rows:[{...good.rows[0],supportResistanceInputs:{asOfSessionDate:'2026-09-18'}}]};
  assert.deepEqual(canonicalData.validateCanonicalSnapshot(future,session).temporal,['COMI:SUPPORT_RESISTANCE:2026-09-18']);
  assert.deepEqual(historicalStore.validateHistoricalStore({COMI:[{sessionDate:'2026-09-18',validationStatus:'VALID',migrationValidationStatus:'VALID'}]},session).temporal,['COMI:HISTORY:2026-09-18']);
  assert.deepEqual(historicalStore.validateHistoricalStore({COMI:[{sessionDate:session,validationStatus:'VALID',migrationValidationStatus:'UNRESOLVED'}]},session).quarantined,['COMI:HISTORY']);
});
test('Family 8 mappings remain closed during later medium-boundary remediation',()=>{
  const r=scan();
  assert.equal(r.findings.high,0,JSON.stringify(r.findings.items.filter(x=>x.severity==='HIGH'),null,2));
  const missing=r.findings.items.filter(x=>x.code==='NO_DEDICATED_IMPLEMENTATION_BOUNDARY').map(x=>x.module);
  assert.equal(missing.includes('canonical-data'),false);
  assert.equal(missing.includes('historical-store'),false);
  assert.ok(missing.length<=12);
  assert.equal(r.productionCutover,false);
});

test('Family 9 gives indicators and technical-analysis dedicated physical ownership',()=>{
  const r=scan(),by=new Map(r.moduleIsolation.map(x=>[x.module,x]));
  for(const id of ['indicators','technical-analysis']){
    const m=by.get(id);
    assert.ok(m,id);
    assert.equal(m.status,'DEDICATED_ZONE',id);
    assert.equal(m.dedicatedFiles.length,1,id);
  }
  assert.equal(zoneFor('astra/analysis/indicators.cjs').kind,'target-module');
  assert.equal(zoneFor('astra/analysis/technical-analysis.cjs').kind,'target-module');
});
test('Family 9 indicator boundary is point-in-time and preserves certified technical inputs when supplied',()=>{
  const session='2026-09-20';
  const history=Array.from({length:20},(_,i)=>({
    sessionDate:`2026-09-${String(i+1).padStart(2,'0')}`,
    open:100+i,high:102+i,low:99+i,close:101+i,volume:1000+i*10
  }));
  const row={
    snapshotId:'IND-COMI',securityId:'EGX:COMI',ticker:'COMI',sessionDate:session,
    validationStatus:'VALID',migrationValidationStatus:'VALID',
    ohlc:{open:119,high:122,low:118,close:120},volume:1400,
    technicalInputs:{return1Pct:1.25,return5Pct:4.5,return20Pct:8,aboveSma20:true,aboveSma50:false,volatility20AnnualizedPct:24,relativeVolume20:1.4}
  };
  const frame=indicators.pointInTimeIndicators(row,history,session);
  assert.equal(frame.return1Pct,1.25);
  assert.equal(frame.return5Pct,4.5);
  assert.equal(frame.return20Pct,8);
  assert.equal(frame.aboveSma20,true);
  assert.equal(frame.aboveSma50,false);
  assert.equal(frame.volatility20AnnualizedPct,24);
  assert.equal(frame.relativeVolume20,1.4);
  assert.ok(Number.isFinite(indicators.sma(history,20,session)));
  assert.equal(indicators.pointInTimeHistory([...history,{sessionDate:'2026-09-21',close:999}],session).length,20);
});
test('Family 9 technical-analysis emits technical evidence only and preserves canonical source identity',()=>{
  const session='2026-09-20';
  const row={
    snapshotId:'TA-COMI',securityId:'EGX:COMI',ticker:'COMI',sessionDate:session,
    validationStatus:'VALID',migrationValidationStatus:'VALID',
    ohlc:{open:119,high:122,low:118,close:120},volume:1400,
    technicalInputs:{return1Pct:1,return5Pct:2,return20Pct:6,aboveSma20:true,aboveSma50:true,volatility20AnnualizedPct:24,relativeVolume20:1.4}
  };
  const x=technicalAnalysis.buildTechnicalEvidence(row,[],session);
  assert.equal(x.sourceRef,'TA-COMI');
  assert.equal(x.asOfSessionDate,session);
  assert.deepEqual(x.momentum,{return1Pct:1,return5Pct:2,return20Pct:6});
  assert.deepEqual(x.trend,{aboveSma20:true,aboveSma50:true});
  assert.equal(Object.prototype.hasOwnProperty.call(x,'ranking'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(x,'strategy'),false);
});
test('Family 9 reduces exactly indicators and technical-analysis MEDIUM mappings with no HIGH regression',()=>{
  const r=scan();
  assert.equal(r.findings.high,0,JSON.stringify(r.findings.items.filter(x=>x.severity==='HIGH'),null,2));
  assert.equal(r.findings.medium,10);
  const missing=r.findings.items.filter(x=>x.code==='NO_DEDICATED_IMPLEMENTATION_BOUNDARY').map(x=>x.module);
  assert.equal(missing.includes('indicators'),false);
  assert.equal(missing.includes('technical-analysis'),false);
  for(const id of ['support-resistance','relative-strength','vcp','liquidity'])assert.equal(missing.includes(id),true,id);
  assert.equal(missing.length,10);
  assert.equal(r.productionCutover,false);
});

test('Family 10 gives support-resistance and relative-strength dedicated physical ownership',()=>{
  const r=scan(),by=new Map(r.moduleIsolation.map(x=>[x.module,x]));
  for(const id of ['support-resistance','relative-strength']){
    const m=by.get(id);
    assert.ok(m,id);
    assert.equal(m.status,'DEDICATED_ZONE',id);
    assert.equal(m.dedicatedFiles.length,1,id);
  }
  assert.equal(zoneFor('astra/analysis/support-resistance.cjs').kind,'target-module');
  assert.equal(zoneFor('astra/analysis/relative-strength.cjs').kind,'target-module');
});
test('Family 10 preserves point-in-time S/R and relative-strength source semantics without strategy thresholds',()=>{
  const session='2026-09-17';
  const row={
    snapshotId:'AN-COMI-2026-09-17',securityId:'EGX:COMI',ticker:'COMI',sessionDate:session,
    validationStatus:'VALID',migrationValidationStatus:'VALID',
    ohlc:{open:99,high:104,low:98,close:103},volume:1000000,turnover:30000000,
    technicalInputs:{relativeStrength20:5,return20Pct:6,aboveSma20:true,aboveSma50:true,volatility20AnnualizedPct:24,relativeVolume20:1.4},
    supportResistanceInputs:{asOfSessionDate:session,support:100,resistance:106}
  };
  const sr=supportResistance.buildSupportResistanceEvidence(row,[],session);
  assert.equal(sr.support,100);assert.equal(sr.resistance,106);assert.equal(sr.sourceRef,row.snapshotId);
  assert.equal(sr.availability.both,true);
  const rs=relativeStrength.buildRelativeStrengthEvidence(row,[],session,[row,{...row,snapshotId:'AN-SWDY',ticker:'SWDY',securityId:'EGX:SWDY',technicalInputs:{...row.technicalInputs,relativeStrength20:3}}]);
  assert.equal(rs.relativeStrength20,5);assert.equal(rs.crossSection.rank,1);assert.equal(rs.crossSection.comparableCount,2);
  assert.equal(Object.hasOwn(rs,'productionEligible'),false);
});
test('Family 10 reduces exactly two additional medium mappings and keeps HIGH at zero',()=>{
  const r=scan();
  assert.equal(r.findings.high,0,JSON.stringify(r.findings.items.filter(x=>x.severity==='HIGH'),null,2));
  assert.equal(r.findings.medium,8);
  const missing=r.findings.items.filter(x=>x.code==='NO_DEDICATED_IMPLEMENTATION_BOUNDARY').map(x=>x.module);
  assert.equal(missing.includes('support-resistance'),false);
  assert.equal(missing.includes('relative-strength'),false);
  assert.equal(missing.length,8);
  assert.equal(r.productionCutover,false);
});
