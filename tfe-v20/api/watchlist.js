import { POLICY } from '../src/policy.js';
import { analyzeTicker } from '../src/engine.js';
import { loadUniverse, loadHistory, loadV17 } from '../src/repository.js';
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

export default async function handler(req,res){
  try{
    const url=new URL(req.url,`https://${req.headers.host}`);
    const limit=Math.max(1,Math.min(50,Number(url.searchParams.get('limit'))||20));
    const [{candidates,expectedSessionDate,universeMode},v17]=await Promise.all([loadUniverse(),loadV17()]);
    const analyses=[];
    const errors=[];
    for(let i=0;i<candidates.length;i+=16){
      const batch=candidates.slice(i,i+16);
      const settled=await Promise.allSettled(batch.map(async d=>{
        const h=await loadHistory(d.ticker);
        return analyzeTicker({ticker:d.ticker,nameAr:d.nameAr,nameEn:d.nameEn,rows:h.rows,historyMeta:h.meta,v17,discovery:d,expectedSessionDate});
      }));
      settled.forEach((x,j)=>{
        if(x.status==='fulfilled')analyses.push(x.value);
        else errors.push({ticker:batch[j].ticker,error:'DATA_SOURCE_ERROR'});
      });
    }
    const watch=buildHighPotentialWatchlist(analyses,limit);
    const officialEligible=analyses.filter(x=>x.eligible===true);
    const officialPublishable=officialEligible.filter(x=>!x.quality?.publicationHold);
    return json(res,200,{
      ok:true,
      engine:POLICY.engineId,
      schemaVersion:'20.tfe.watchlist.1',
      sourceCommit:sourceCommit(),
      generatedAt:new Date().toISOString(),
      sessionDate:expectedSessionDate,
      universeMode,
      mode:'RESEARCH_WATCHLIST_ONLY',
      methodology:{
        inspiration:'CROSS_SECTIONAL_RANKING_PLUS_HARD_SAFETY_GATES',
        officialRecommendationMutation:false,
        officialThresholdMutation:false,
        candidateDefinition:'bounded near miss on at most two numeric gates; no critical blocker; valid entry alignment',
        relativeRanking:'within-current-session percentile ranking over existing RC2 research/core/liquidity/SR/structural-RR/data-quality dimensions',
      },
      thresholds:{
        core:POLICY.minCoreScore,research:POLICY.minResearchScore,liquidity:POLICY.minLiquidityScore,
        supportResistance:POLICY.minSrScore,structuralNetRR:POLICY.minStructuralNetRR,
      },
      summary:{
        scanned:analyses.length,
        officialEligibleTotal:officialEligible.length,
        officialPublishableTotal:officialPublishable.length,
        highPotentialTotal:watch.candidates.length,
        criticalRejected:watch.summary.criticalRejected,
        otherRejected:watch.summary.otherRejected,
        errors:errors.length,
      },
      highPotentialCandidates:watch.candidates,
      errors,
      permissions:{...POLICY.permissions,watchlistOnly:true,recommendationMutationAllowed:false},
      disclaimer:'High-potential candidates are relative research watchlist items, not buy recommendations. Official RC2 recommendations and hard gates remain unchanged.'
    });
  }catch(error){
    console.error('[RC2_WATCHLIST]',error?.stack||error?.message||error);
    return json(res,500,{ok:false,engine:POLICY.engineId,error:'WATCHLIST_BUILD_FAILED'});
  }
}
