import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY } from '../src/policy.js';
import { normalizeBars, assessDataQuality, assessDataReadiness, parseLatestConflictPct } from '../src/quality.js';
import { analyzeTicker, rankAnalyses, blendFusionScore } from '../src/engine.js';
import { backtestHistory, summarizeBacktest } from '../src/backtest.js';
import { scoreBars as originalScoreBars } from '../src/originalScore.js';
import { selectUniverseCandidates } from '../src/repository.js';
import { withPublicationGate } from '../api/index.js';

function bars(n=100,{start=20,drift=.11,vol=1_500_000,noise=.18}={}){
  const out=[]; let p=start; const d=new Date('2026-01-01T00:00:00Z');
  for(let i=0;i<n;i++){
    const wave=Math.sin(i/4)*noise; const open=p+wave*.25; const close=Math.max(.5,p+drift+wave);
    const high=Math.max(open,close)+.25+Math.abs(Math.sin(i))*noise;
    const low=Math.min(open,close)-.25-Math.abs(Math.cos(i))*noise;
    out.push({date:d.toISOString().slice(0,10),open,high,low,close,volume:vol*(.9+(i%7)/20)});
    p=close; d.setUTCDate(d.getUTCDate()+1);
  }
  return out;
}

test('policy hard blocks execution',()=>{assert.equal(POLICY.permissions.executionAllowed,false);assert.equal(POLICY.permissions.automaticOrders,false);assert.equal(POLICY.permissions.automaticChampionPromotion,false);assert.equal(POLICY.minStructuralNetRR,.7)});
test('normalize deduplicates and rejects broken OHLC',()=>{const x=bars(3);x.push({...x[1],close:-1});x.push({...x[2]});const n=normalizeBars(x);assert.equal(n.bars.length,3);assert.equal(n.rejected,1)});
test('normalize sorts dates',()=>{const x=bars(5).reverse();const n=normalizeBars(x);assert.ok(n.bars[0].date<n.bars[4].date)});
test('normalize preserves missing volume as unknown and real zero as zero',()=>{const x=bars(2);delete x[0].volume;x[1].volume=0;const n=normalizeBars(x);assert.equal(n.bars[0].volume,null);assert.equal(n.bars[1].volume,0)});
test('conflict parser',()=>assert.equal(parseLatestConflictPct(['latest_close_conflict:7.25%']),7.25));
test('quality blocks short history',()=>{const q=assessDataQuality({bars:bars(20),warnings:[]});assert.equal(q.state,'BLOCKED')});
test('quality blocks corporate action review',()=>{const q=assessDataQuality({bars:bars(80),warnings:['corporate_action_review_required']});assert.equal(q.state,'BLOCKED')});
test('quality reviews moderate conflict',()=>{const q=assessDataQuality({bars:bars(80),warnings:['latest_close_conflict:8%']});assert.equal(q.state,'REVIEW')});
test('quality reviews large conflict when reference freshness is unknown',()=>{const q=assessDataQuality({bars:bars(80),warnings:['latest_close_conflict:25%']});assert.equal(q.state,'REVIEW');assert.ok(q.reviewFlags.includes('HIGH_LOCAL_REFERENCE_CONFLICT_REVIEW'))});
test('normal verified identity divergence is review evidence not a false hard block',()=>{const q=assessDataQuality({bars:bars(80),symbolVerified:true,symbolVerification:{verified:true,normalVerified:true,guardedVerified:false,evidence:{localDifferencePct:12,guardedMaxDifferencePct:8}}});assert.equal(q.state,'REVIEW');assert.ok(q.reviewFlags.includes('LOCAL_REFERENCE_DIVERGENCE_REVIEW'))});
test('explicit symbol identity failure blocks research',()=>{const q=assessDataQuality({bars:bars(80),symbolVerified:false,symbolVerification:{verified:false}});assert.equal(q.state,'BLOCKED');assert.ok(q.reasons.includes('SYMBOL_IDENTITY_UNVERIFIED'))});
test('quality accepts guarded identity reconciliation',()=>{const q=assessDataQuality({bars:bars(80),symbolVerified:true,symbolVerification:{verified:true,guardedVerified:true,evidence:{localDifferencePct:12,guardedMaxDifferencePct:8}}});assert.notEqual(q.state,'BLOCKED')});
test('readiness fails when latest scoring window has unknown volume',()=>{const x=normalizeBars(bars(100)).bars;x[95].volume=null;const r=assessDataReadiness({bars:x});assert.equal(r.readyForRanking,false);assert.ok(r.reasons.includes('VOLUME_DATA_INCOMPLETE'));assert.equal(r.missingDataPolicy,'UNKNOWN_NEVER_COERCED_TO_ZERO')});
test('historical readiness is stricter than current signal readiness for old missing volume',()=>{const x=normalizeBars(bars(100)).bars;x[30].volume=null;const current=assessDataReadiness({bars:x,requireAllVolume:false});const historical=assessDataReadiness({bars:x,requireAllVolume:true});assert.equal(current.readyForRanking,true);assert.equal(historical.readyForBacktest,false);assert.ok(historical.reasons.includes('VOLUME_DATA_INCOMPLETE'))});
test('missing historical evidence is neutral in fusion rather than zero-scored',()=>{const b=blendFusionScore(81.4,{confidenceWilsonLower95Pct:null,sampleReliability:0});assert.equal(b.fusionRank,81.4);assert.equal(b.researchWeight,1);assert.equal(b.historicalWeight,0)});
test('data-not-ready is withheld from ranking without being labeled rejected',()=>{const x=withPublicationGate({ticker:'MISS',eligible:false,reasonCodes:['DATA_NOT_READY','VOLUME_DATA_INCOMPLETE']});assert.equal(x.publicationEligible,false);assert.equal(x.dataNotReady,true);assert.equal(x.publicationState,'DATA_NOT_READY')});
test('ordinary failed hard gate remains rejected',()=>{const x=withPublicationGate({ticker:'LOW',eligible:false,reasonCodes:['CORE_SCORE_LOW']});assert.equal(x.dataNotReady,false);assert.equal(x.publicationState,'REJECTED')});
test('analysis always research only',()=>{const a=analyzeTicker({ticker:'TEST',rows:bars(100),historyMeta:{warnings:[]}});assert.equal(a.permissions.executionAllowed,false);assert.equal(a.researchOnly,true)});
test('analysis requires ticker',()=>assert.throws(()=>analyzeTicker({rows:bars(100)}),/TICKER_REQUIRED/));
test('short history returns no recommendation',()=>{const a=analyzeTicker({ticker:'X',rows:bars(30)});assert.equal(a.eligible,false);assert.equal(a.decision,'NO_RECOMMENDATION')});
test('analysis blocks incomplete liquidity before scoring instead of assigning zero',()=>{const x=bars(100);delete x[95].volume;const a=analyzeTicker({ticker:'MISS',rows:x,historyMeta:{warnings:[]}});assert.equal(a.eligible,false);assert.ok(a.reasonCodes.includes('DATA_NOT_READY'));assert.ok(a.reasonCodes.includes('VOLUME_DATA_INCOMPLETE'));assert.equal(a.scores.liquidity,null);assert.equal(a.scores.research,null)});
test('a real zero-volume session is known data, not missing data',()=>{const x=bars(100);x[99].volume=0;const a=analyzeTicker({ticker:'ZERO',rows:x,historyMeta:{warnings:[]}});assert.equal(a.dataReadiness.volumeReady,true);assert.equal(a.reasonCodes.includes('DATA_NOT_READY'),false)});
test('complete valid data keeps original technical scorer unchanged',()=>{const x=bars(120);const last=x.at(-1).date;const a=analyzeTicker({ticker:'FULL',rows:x,historyMeta:{warnings:[],symbolVerified:true},expectedSessionDate:last});const normalized=normalizeBars(x).bars;assert.equal(a.dataReadiness.state,'READY');assert.equal(a.scores.technical,originalScoreBars(normalized).score);assert.equal(a.liquidity.dataReady,true)});
test('current ranked analysis requires verified identity when a market session reference exists',()=>{const x=bars(100);const a=analyzeTicker({ticker:'ID',rows:x,historyMeta:{warnings:[]},expectedSessionDate:x.at(-1).date});assert.equal(a.eligible,false);assert.ok(a.reasonCodes.includes('SYMBOL_IDENTITY_NOT_VERIFIED'))});
test('analysis exposes separate precision and structural targets when plan exists',()=>{const a=analyzeTicker({ticker:'X',rows:bars(120),historyMeta:{warnings:[]}});if(a.tradePlan){assert.ok(a.tradePlan.target2>=a.tradePlan.target1);assert.ok(a.tradePlan.structuralNetRR!==null)}});
test('rank only eligible',()=>{const xs=[{ticker:'B',eligible:true,scores:{research:80,core:80,supportResistance:80,liquidity:80}},{ticker:'A',eligible:false,scores:{research:99}},{ticker:'C',eligible:true,scores:{research:90,core:70,supportResistance:70,liquidity:70}}];const r=rankAnalyses(xs);assert.deepEqual(r.map(x=>x.ticker),['C','B'])});
test('rank deterministic tie breaker',()=>{const z={eligible:true,scores:{research:80,core:80,supportResistance:80,liquidity:80}};assert.deepEqual(rankAnalyses([{...z,ticker:'B'},{...z,ticker:'A'}]).map(x=>x.ticker),['A','B'])});
test('V17 overlay can never grant execution',()=>{const a=analyzeTicker({ticker:'X',rows:bars(100),v17:{status:'READY',readiness:{executionReady:true},recommendations:[{ticker:'X',executionAllowed:true}]}});assert.equal(a.v17.executionAllowed,false);assert.equal(a.v17.matchedRecommendation.executionAllowed,false)});
test('discovery score is provenance only',()=>{const a=analyzeTicker({ticker:'X',rows:bars(100),discovery:{rank:1,nativeResearchScore:99}});assert.equal(a.discovery.source,'V20_NATIVE_DISCOVERY_ONLY_NOT_SCORING_INPUT')});
test('unready history cannot fall back into ranking universe',()=>{const snapshot={publishedCandidates:[{ticker:'FALL',rank:1}]};const summary={latestMarketSession:'2026-08-28',symbols:[{ticker:'FALL',symbolVerified:false,availableSessions:120,staleData:false,updateFailed:false,lastSession:'2026-08-28'}]};const s=selectUniverseCandidates(summary,snapshot);assert.equal(s.candidates.length,0);assert.equal(s.discoveryOnlyCandidates.length,1);assert.equal(s.readinessGate.fallbackMayEnterRanking,false);assert.equal(s.universeMode,'DATA_READINESS_BLOCKED_NO_CURRENT_HISTORY')});
test('fallback discovery keeps unknown turnover unknown instead of zero-ranking it',()=>{const snapshot={rows:[{ticker:'UNK',price:10,turnover:null},{ticker:'KNOWN',price:10,turnover:100}]};const s=selectUniverseCandidates(null,snapshot);assert.deepEqual(s.discoveryOnlyCandidates.map(x=>x.ticker),['KNOWN','UNK']);assert.equal(s.discoveryOnlyCandidates[1].turnoverKnown,false);assert.equal(s.candidates.length,0)});
test('backtest uses next session or later',()=>{const r=backtestHistory({ticker:'X',rows:bars(140,{drift:.18})});for(const t of r.trades)assert.ok(t.entryDate>t.signalDate)});
test('backtest fails closed on any missing historical volume',()=>{const x=bars(140,{drift:.18});delete x[30].volume;const r=backtestHistory({ticker:'MISSBT',rows:x});assert.equal(r.skipped,true);assert.equal(r.skipReason,'DATA_NOT_READY');assert.equal(r.summary.entered,0);assert.ok(r.dataReadiness.reasons.includes('VOLUME_DATA_INCOMPLETE'))});
test('backtest charges transaction cost',()=>{const s=summarizeBacktest([{outcome:'TARGET1',netPct:1},{outcome:'STOP',netPct:-.5}],[]);assert.equal(s.summary.entered,2);assert.equal(s.summary.avgNetPct,.25)});
test('wilson bound never exceeds observed target rate',()=>{const s=summarizeBacktest(Array.from({length:10},(_,i)=>({outcome:i<7?'TARGET1':'STOP',netPct:i<7?1:-1})),[]);assert.ok(s.summary.wilson95LowerTarget1Pct<=70)});
test('analysis does not mutate caller OHLC rows',()=>{const x=bars(90);const before=JSON.stringify(x);analyzeTicker({ticker:'IMM',rows:x});assert.equal(JSON.stringify(x),before)});
