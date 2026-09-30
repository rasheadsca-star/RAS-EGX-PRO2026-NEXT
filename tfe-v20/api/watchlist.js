import { POLICY } from '../src/policy.js';
import { analyzeTicker, analyzeTickerBase, rankAnalyses } from '../src/engine.js';
import { loadUniverse, loadHistory, loadV17 } from '../src/repository.js';
import { normalizeBars } from '../src/quality.js';
import { simulateHistoricalConfidence } from '../src/confidence.js';
import { buildConfidenceV2 } from '../sidecars/confidence-v2.js';
import { buildHighPotentialWatchlist } from '../src/watchlist.js';

const sourceCommit = () => process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.TFE_SOURCE_COMMIT || null;
const json = (res,status,body) => {
  res.statusCode=status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.setHeader('x-tfe-engine',POLICY.engineId);
  const commit=sourceCommit(); if(commit)res.setHeader('x-tfe-source-commit',commit);
  res.end(JSON.stringify(body));
};

function buildEvidenceConfidence(candidate, rows, mode) {
  const bars = normalizeBars(rows || []).bars;
  const historical = simulateHistoricalConfidence({
    ticker:candidate.ticker,
    bars,
    analyzeBase:analyzeTickerBase,
  });
  const confidenceV2 = buildConfidenceV2({
    analysis:candidate,
    bars,
    historicalConfidence:historical,
    mode,
  });
  return {
    ...candidate,
    shadowHistoricalConfidence:{...historical,trades:undefined},
    confidenceV2,
  };
}

export default async function handler(req,res){
  try{
    const url=new URL(req.url,`https://${req.headers.host}`);
    const limit=Math.max(1,Math.min(50,Number(url.searchParams.get('limit'))||20));
    const [{candidates,expectedSessionDate,universeMode},v17]=await Promise.all([loadUniverse(),loadV17()]);
    const analyses=[];
    const errors=[];
    const historyRows=new Map();
    for(let i=0;i<candidates.length;i+=16){
      const batch=candidates.slice(i,i+16);
      const settled=await Promise.allSettled(batch.map(async d=>{
        const h=await loadHistory(d.ticker);
        historyRows.set(d.ticker,h.rows);
        return analyzeTicker({ticker:d.ticker,nameAr:d.nameAr,nameEn:d.nameEn,rows:h.rows,historyMeta:h.meta,v17,discovery:d,expectedSessionDate});
      }));
      settled.forEach((x,j)=>{
        if(x.status==='fulfilled')analyses.push(x.value);
        else errors.push({ticker:batch[j].ticker,error:'DATA_SOURCE_ERROR'});
      });
    }

    const watch=buildHighPotentialWatchlist(analyses,limit);
    const highPotentialCandidates=watch.candidates.map((candidate)=>{
      try {
        return buildEvidenceConfidence(candidate,historyRows.get(candidate.ticker),'WATCHLIST_SHADOW_RESEARCH_ONLY');
      } catch (error) {
        console.error('[RC2_WATCHLIST_CONFIDENCE]',candidate.ticker,error?.message||error);
        return {...candidate,confidenceV2:null,shadowHistoricalConfidence:null,confidenceError:'CONFIDENCE_V2_BUILD_FAILED'};
      }
    });

    const officialEligible=analyses.filter(x=>x.eligible===true);
    const officialPublishable=officialEligible.filter(x=>!x.quality?.publicationHold);
    const officialRanked=rankAnalyses(officialPublishable).slice(0,limit);
    const officialCandidatesWithConfidenceV2=officialRanked.map((candidate)=>{
      try {
        return buildEvidenceConfidence(candidate,historyRows.get(candidate.ticker),'OFFICIAL_RECOMMENDATION_DIAGNOSTIC');
      } catch (error) {
        console.error('[RC2_OFFICIAL_CONFIDENCE]',candidate.ticker,error?.message||error);
        return {...candidate,confidenceV2:null,shadowHistoricalConfidence:null,confidenceError:'CONFIDENCE_V2_BUILD_FAILED'};
      }
    });

    return json(res,200,{
      ok:true,
      engine:POLICY.engineId,
      schemaVersion:'20.tfe.watchlist.2',
      sourceCommit:sourceCommit(),
      generatedAt:new Date().toISOString(),
      sessionDate:expectedSessionDate,
      universeMode,
      mode:'RESEARCH_WATCHLIST_ONLY',
      methodology:{
        inspiration:'CROSS_SECTIONAL_RANKING_PLUS_HARD_SAFETY_GATES',
        officialRecommendationMutation:false,
        officialThresholdMutation:false,
        productionScanMutation:false,
        candidateDefinition:'bounded near miss or safe relative leader; no critical blocker; valid entry alignment',
        relativeRanking:'within-current-session percentile ranking over existing RC2 research/core/liquidity/SR/structural-RR/data-quality dimensions',
        confidenceV2:'Bayesian small-sample shrinkage + regime match + chronological walk-forward stability over no-lookahead historical eligible events',
        shadowHistoricalEvidence:'diagnostic only; cannot convert a watchlist item into an official recommendation and cannot alter official ranking',
      },
      thresholds:{
        core:POLICY.minCoreScore,research:POLICY.minResearchScore,liquidity:POLICY.minLiquidityScore,
        supportResistance:POLICY.minSrScore,structuralNetRR:POLICY.minStructuralNetRR,
      },
      summary:{
        scanned:analyses.length,
        officialEligibleTotal:officialEligible.length,
        officialPublishableTotal:officialPublishable.length,
        officialConfidenceV2Ready:officialCandidatesWithConfidenceV2.filter(x=>x.confidenceV2).length,
        highPotentialTotal:highPotentialCandidates.length,
        confidenceV2Ready:highPotentialCandidates.filter(x=>x.confidenceV2).length,
        strongEvidenceTotal:highPotentialCandidates.filter(x=>x.confidenceV2?.evidenceLevel==='STRONG').length,
        moderateOrBetterEvidenceTotal:highPotentialCandidates.filter(x=>['STRONG','MODERATE'].includes(x.confidenceV2?.evidenceLevel)).length,
        criticalRejected:watch.summary.criticalRejected,
        otherRejected:watch.summary.otherRejected,
        errors:errors.length,
      },
      officialCandidatesWithConfidenceV2,
      highPotentialCandidates,
      errors,
      permissions:{...POLICY.permissions,watchlistOnly:true,recommendationMutationAllowed:false,confidenceV2ScoringImpact:'NONE'},
      disclaimer:'Confidence V2 is an evidence-quality diagnostic, not a probability guarantee or execution signal. It does not change official RC2 recommendations, ranking, hard gates, or execution permissions.'
    });
  }catch(error){
    console.error('[RC2_WATCHLIST]',error?.stack||error?.message||error);
    return json(res,500,{ok:false,engine:POLICY.engineId,error:'WATCHLIST_BUILD_FAILED'});
  }
}
