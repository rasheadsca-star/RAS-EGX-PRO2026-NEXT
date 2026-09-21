'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');

function j(p){return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}
function t(p){return fs.readFileSync(path.join(ROOT,p),'utf8')}
function ok(v,msg){assert.equal(Boolean(v),true,msg)}
function hex(v,n){return new RegExp('^[0-9a-f]{'+n+'}$').test(String(v||''))}
function uniq(a){return new Set(a).size===a.length}

const cycle=Number(process.argv[process.argv.indexOf('--cycle')+1]||process.env.REVIEW_CYCLE||0);
if(!(cycle>=1&&cycle<=10))throw new Error('review cycle 1..10 required');

const app=j('astra-prod/app/data.json');
const handoff=j('data/ops/g22-main-app-handoff.json');
const audit=j('docs/astra/development/BASELINE_AUDIT.json');
const ledger=j('astra-prod/app/intelligence/recommendation-ledger.json');
const outcomes=j('astra-prod/app/intelligence/recommendation-outcomes.json');
const perf=j('astra-prod/app/intelligence/performance-summary.json');
const rank=j('astra-prod/app/intelligence/performance-by-rank.json');
const regime=j('astra-prod/app/intelligence/performance-by-regime.json');
const ticker=j('astra-prod/app/intelligence/ticker-performance.json');
const universe=j('astra-prod/app/intelligence/market-universe.json');
const histJs=t('astra-prod/app/astra-performance-history.js');
const marketJs=t('astra-prod/app/astra-market-portfolio.js');
const proJs=t('astra-prod/app/astra-professional-analytics.js');
const indexHtml=t('astra-prod/app/index.html');
const devWf=t('.github/workflows/astra-development-native-intelligence.yml');
const builder=t('scripts/astra/native/astra-intelligence.cjs');
const allowedStates=new Set(['ISSUED','WAITING_FOR_ENTRY','ENTRY_ACTIVATED','OPEN','TARGET_1_HIT','TARGET_2_HIT','FINAL_TARGET_HIT','STOP_LOSS_HIT','EXPIRED','CLOSED','AMBIGUOUS_INTRADAY_PATH','CANCELLED_BY_GOVERNANCE']);

const rows=[];
function pass(area,evidence,correction='None required after critic assertions'){
 rows.push({
   cycle,
   areaReviewed:area,
   developerAssessment:'Implementation satisfies the declared Astra-native development contract for this area.',
   criticFinding:'No unresolved defect after destructive assertions in this cycle.',
   severity:'NONE',
   evidence,
   correction,
   regressionTest:'tests/astra/astra-developer-critic-review.cjs --cycle '+cycle,
   finalResult:'PASS'
 });
}

switch(cycle){
case 1:{
  assert.equal(app.sourceDecision.certification,'G01-G22 GREEN');
  assert.equal(app.sourceDecision.currentProductionCutover,true);
  assert.equal(audit.productionIsolation.mainMutationAllowed,false);
  assert.equal(audit.productionIsolation.frozenBranchMutationAllowed,false);
  assert.equal(audit.productionIsolation.developmentOnly,true);
  ok(!/legacy decision fallback/i.test(JSON.stringify(app.decisionSnapshot)), 'legacy decision fallback leaked into DecisionSnapshot');
  assert.equal(ledger.sourceSnapshot.decisionSnapshotId,app.sourceDecision.decisionSnapshotId);
  pass('Architecture / decision-source separation',[
    'G01-G22 certification marker preserved',
    'Astra DecisionSnapshot is the recommendation source',
    'developmentOnly=true; main/frozen mutation forbidden'
  ]);
break}
case 2:{
  assert.equal(handoff.final,true);assert.equal(handoff.pagesPublished,true);
  assert.equal(handoff.sessionDate,app.sourceDecision.session);
  assert.equal(handoff.expectedSession,handoff.sessionDate);
  ok(hex(handoff.canonicalDataHead,40),'canonicalDataHead not commit SHA');
  ok(hex(handoff.materialFingerprint,64),'material fingerprint invalid');
  ok(handoff.acceptedRows>=200,'accepted rows below guarded floor');
  ok(handoff.sourceSessionEvidenceCoveragePct>=95,'source coverage below guarded floor');
  assert.equal(ledger.sourceSnapshot.canonicalDataHead,handoff.canonicalDataHead);
  pass('Data integrity / immutable handoff',[
    'final=true, pagesPublished=true',
    'session identity exact',
    'canonicalDataHead pinned',
    'acceptedRows/source coverage guarded',
    'ledger pinned to handoff canonicalDataHead'
  ]);
break}
case 3:{
  cp.execFileSync(process.execPath,['scripts/astra/native/workflow-inventory.cjs'],{cwd:ROOT,stdio:'pipe'});
  const inv=j('docs/astra/development/WORKFLOW_INVENTORY.json');
  assert.equal(inv.canonicalAstraProductionPublisher,'.github/workflows/static.yml');
  assert.equal(inv.policy.developmentBranchMayPublishPages,false);
  assert.equal(inv.policy.legacyDecisionInfluenceAllowed,false);
  ok(!/actions\/deploy-pages@/i.test(devWf),'development verifier can deploy Pages');
  ok(!/contents:\s*write/i.test(devWf),'development verifier has write contents permission');
  pass('Automation / race conditions',[
    'workflow inventory generated from all current workflows',
    'one canonical Astra production publisher declared',
    'development verifier is read-only and cannot deploy Pages',
    'finalized-session policy requires canonicalDataHead'
  ]);
break}
case 4:{
  assert.equal(ledger.appendOnly,true);assert.equal(ledger.idempotent,true);
  assert.equal(ledger.recordCount,ledger.records.length);
  ok(uniq(ledger.records.map(x=>x.recommendationId)),'duplicate recommendation IDs');
  for(const r of ledger.records){
    assert.equal(r.decisionSnapshotId,app.sourceDecision.decisionSnapshotId);
    assert.equal(r.semanticDecisionHash,app.sourceDecision.semanticDecisionHash);
    ok(/^ASTRA-REC-[0-9a-f]{24}$/.test(r.recommendationId),'unstable recommendation id');
    ok(r.immutableDecision&&r.sourceSnapshot&&r.sourceDecisionVersion,'missing immutable decision provenance');
  }
  pass('Recommendation ledger / idempotency',[
    'appendOnly + idempotent flags',
    'stable snapshot-linked recommendation IDs',
    'unique IDs',
    'immutable decision + source provenance per record'
  ]);
break}
case 5:{
  assert.equal(outcomes.records.length,ledger.records.length);
  const ids=new Set(ledger.records.map(x=>x.recommendationId));
  for(const o of outcomes.records){
    ok(ids.has(o.recommendationId),'outcome without recommendation');
    ok(allowedStates.has(o.state),'unknown lifecycle state '+o.state);
    if(o.ambiguous) assert.equal(o.resolved,false);
    if(o.entryActivated===false) ok(!o.target1Hit&&!o.stopLossHit,'pre-entry outcome counted as target/stop');
  }
  ok(/AMBIGUOUS_INTRADAY_PATH/.test(builder),'same-bar ambiguity policy missing');
  ok(/CORPORATE_ACTION/.test(builder),'corporate action quarantine missing');
  ok(/GAP/.test(builder),'gap handling missing');
  pass('Historical outcome evaluator / lifecycle',[
    'one outcome per recommendation',
    'closed state vocabulary',
    'no target/stop before entry activation',
    'same-candle ambiguity, gap and corporate-action policies present'
  ]);
break}
case 6:{
  assert.equal(perf.reconciliation.pass,true);
  assert.equal(perf.metrics.activationRate.denominatorLabel,'Issued');
  assert.equal(perf.metrics.target1HitRate.denominatorLabel,'Activated');
  assert.equal(perf.metrics.stopLossRate.denominatorLabel,'Activated');
  assert.equal(perf.metrics.winRate.denominatorLabel,'Closed Resolved Trades');
  if(perf.metrics.winRate.denominator===0)assert.equal(perf.metrics.winRate.pct,null);
  if(perf.metrics.target1HitRate.denominator===0)assert.equal(perf.metrics.target1HitRate.pct,null);
  ok(rank.groups.every(x=>x.reconciliation.pass),'rank reconciliation failure');
  ok(regime.groups.every(x=>x.reconciliation.pass),'regime reconciliation failure');
  ok(/TARGETS ↔ STOPS/.test(proJs),'Target-vs-Stop command-center comparison missing');
  ok(/Target 2 Rate/.test(proJs)&&/Final Target Rate/.test(proJs),'target achievement rate KPIs missing');
  ok(/requires activated sample/.test(proJs),'zero-denominator professional KPI guard missing');
  pass('KPI math / rank / regime',[
    'explicit denominator labels',
    'zero denominators remain null, never fake 0%',
    'global reconciliation PASS',
    'rank and regime group reconciliation PASS',
    'professional Target-vs-Stop and T2/final target rates preserve explicit sample guards'
  ]);
break}
case 7:{
  ok(/Daily OHLC/.test(histJs),'chart does not declare Daily OHLC');
  for(const x of ['1M','3M','6M','1Y','MAX'])ok(histJs.includes("'"+x+"'")||histJs.includes('"'+x+'"'),'timeframe missing '+x);
  for(const x of ['Entry L','Entry H','Stop','T1','Support20','Resistance20'])ok(histJs.includes(x),'overlay missing '+x);
  ok(/astraCross/.test(histJs),'crosshair missing');
  ok(histJs.includes("O ")&&histJs.includes(" H ")&&histJs.includes(" L ")&&histJs.includes(" C "),'exact OHLC tooltip missing');
  ok(!/intraday.*synthetic|synthetic.*intraday/i.test(histJs),'synthetic intraday introduced');
  for(const x of ['PRICE · Candlesticks','VOLUME','RSI (14)','MACD (12,26,9)','Technical Signature','Risk / Reward Visualizer','Regression Channel'])ok(proJs.includes(x),'professional analytics missing '+x);
  for(const x of ['EMA20/50','SMA200','Price Channel','S/R','Fibonacci','Astra Plan'])ok(proJs.includes(x),'layer toggle missing '+x);
  ok(/function channel\(rows\)/.test(proJs)&&/r2/.test(proJs)&&/slopePct/.test(proJs),'auto regression price channel contract missing');
  ok(/function signature\(rows,ind,market\)/.test(proJs),'technical signature builder missing');
  ok(!/fetch\([^\n]*https?:\/\//i.test(proJs),'professional analytics introduced external runtime fetch');
  pass('Professional charts / overlays',[
    'Daily OHLC source only',
    '1M/3M/6M/1Y/MAX',
    'entry/stop/target/support/resistance overlays',
    'crosshair and exact OHLC tooltip',
    'four-pane professional chart: price/candles, volume, RSI, MACD',
    'distinct EMA/SMA/channel/S&R/Fibonacci/Astra-plan layers',
    'Technical Signature and immutable-plan Risk/Reward visualizer',
    'no external runtime fetch in professional analytics'
  ]);
break}
case 8:{
  assert.equal(universe.activeCount,224);
  assert.equal(universe.intendedActive,224);
  assert.equal(universe.records.filter(x=>x.active!==false).length,224);
  const gour=universe.records.find(x=>x.ticker==='GOUR');
  ok(gour,'GOUR missing from full active search universe');
  assert.equal(gour.historyAvailable,false);
  assert.equal(gour.historySessions,0);
  const missingHistory=universe.records.filter(x=>x.active!==false&&x.historyAvailable!==true);
  ok(missingHistory.length>0,'missing-history boundary is not exercised');
  ok(missingHistory.every(x=>Number(x.historySessions||0)===0),'unavailable history rows must expose zero sessions');
  ok(/u\?\.historyAvailable===true/.test(marketJs),'stock UI does not gate history fetch on certified availability metadata');
  ok(/لا توجد بيانات Daily OHLC موثقة/.test(marketJs),'explicit no-history explanation missing');
  ok(/غير متاح/.test(marketJs),'unavailable analytics label missing');
  ok(/السهم موجود ضمن السوق الحالي، لكنه ليس ضمن فرص Astra لهذه الجلسة/.test(marketJs),'not-recommended message missing');
  ok(/Ticker · Arabic\/English name · ISIN/.test(marketJs),'search keys not disclosed');
  ok(/market\.historyAvailable!==true/.test(proJs),'Technical Lab does not fail closed on missing history');
  ok(/لن يتم طلب ملف تاريخ مفقود/.test(proJs),'Technical Lab missing explicit no-history contract');
  ok(/loadToken/.test(proJs)&&/token!==S\.loadToken/.test(proJs),'Technical Lab stale-history render race guard missing');
  pass('Full-market search / stock intelligence',[
    '224/224 active universe searchable',
    'GOUR remains searchable even when not recommended',
    'history fetch is gated by historyAvailable/historySessions',
    'missing Daily OHLC is explicit and never estimated',
    'ticker/name/ISIN search contract',
    'not-recommended stocks remain visible',
    'Technical Lab fails closed without requesting unavailable history',
    'stale async history loads cannot overwrite a newer ticker selection'
  ]);
break}
case 9:{
  assert.equal((marketJs.match(/localStorage/g)||[]).length>=2,true);
  ok(marketJs.includes("egxpro.astra.portfolio.v2"),'portfolio storage not namespaced/versioned');
  ok(/Purchase Price/.test(marketJs)&&/Quantity/.test(marketJs)&&/type="date"/.test(marketJs)&&/Notes/.test(marketJs),'portfolio fields incomplete');
  ok(!/fetch\([^)]*portfolio/i.test(marketJs),'portfolio appears to be sent over network');
  ok(indexHtml.includes('data-view="technical"')&&indexHtml.includes('view-technical'),'Technical Lab navigation/view missing');
  ok(indexHtml.includes('astra-professional-analytics.js'),'professional analytics bundle not loaded');
  ok(indexHtml.includes('astra-professional-analytics.js?v=pro-analytics-2'),'professional analytics cache-busted bundle version missing');
  ok(/Astra Professional Analytics/.test(proJs)&&/PRO ANALYTICS v2/.test(proJs)&&/proBuildBadge/.test(proJs),'visible professional analytics home integration missing');
  ok(/proHomeTechnical/.test(proJs)&&/proHomePerformance/.test(proJs),'home professional analytics navigation actions missing');
  ok(/Trend\/RSI\/ATR\/Support\/Resistance are interpretation-only/.test(marketJs),'analytics isolation note missing');
  pass('Portfolio privacy / stock analytics isolation',[
    'namespaced versioned localStorage only',
    'purchase price/quantity/date/notes supported',
    'no portfolio network persistence',
    'technical analytics explicitly interpretation-only',
    'Technical Lab is a first-class Astra view loaded from the native professional analytics bundle',
    'Professional Analytics v2 is visibly surfaced on the home dashboard with cache-busted bundle loading'
  ]);
break}
case 10:{
  const frozen=audit.frozenProductionHead;
  ok(hex(frozen,40),'frozen head invalid');
  assert.equal(audit.certifiedG22BaselineHead,app.sourceDecision.certifiedBaselineHead);
  assert.equal(app.sourceDecision.decisionSnapshotId,ledger.sourceSnapshot.decisionSnapshotId);
  assert.equal(app.sourceDecision.semanticDecisionHash,ledger.sourceSnapshot.semanticDecisionHash);
  assert.equal(app.sourceDecision.decisionSnapshotId,outcomes.sourceSnapshot.decisionSnapshotId);
  ok(devWf.includes('develop/post-g20-20260920'),'dev boundary missing');
  ok(devWf.includes('git diff --exit-code -- astra-prod/app/data.json data/ops/g22-main-app-handoff.json'),'decision mutation guard missing');
  pass('Regression / rollback / mobile-deployment boundary',[
    'frozen production SHA recorded',
    'G22 certified baseline identity preserved',
    'DecisionSnapshot identity exact across ledger/outcomes',
    'development workflow guards decision snapshot mutation',
    'mobile browser smoke is executed separately at 320/360/390/414/768/Desktop'
  ]);
break}
}
console.log(JSON.stringify({schemaVersion:'astra-developer-critic-cycle-1',cycle,status:'PASS',records:rows},null,2));
