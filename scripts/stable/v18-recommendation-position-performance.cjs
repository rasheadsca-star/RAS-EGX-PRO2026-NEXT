#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const LEDGER=path.join(ROOT,'data/stable/v18-forward-ledger.json');
const OUT=path.join(ROOT,'data/stable/v18-global-strategy-ensemble.json');
const START='2026-09-07';
const COMPARISON_LIMIT=20;
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,x)=>fs.writeFileSync(f,JSON.stringify(x,null,2)+'\n','utf8');
const pct=(a,b)=>b>0?Number((a/b*100).toFixed(1)):null;
if(!fs.existsSync(LEDGER)||!fs.existsSync(OUT))throw new Error('Required V18 forward files missing');
const ledger=read(LEDGER),out=read(OUT);
const entries=(ledger.entries||[]).filter(e=>Number.isFinite(Number(e.issued?.rank)));
const maxRank=Math.max(COMPARISON_LIMIT,...entries.map(e=>Number(e.issued.rank)));
const positions=[];
for(let rank=1;rank<=maxRank;rank++){
  const rows=entries.filter(e=>Number(e.issued.rank)===rank);
  const ev=rows.map(e=>e.futurePerformance||{});
  const evaluable=ev.filter(x=>!['NO_EVALUABLE_PLAN','PENDING_FUTURE_SESSION','CANONICAL_STOCK_MISSING'].includes(x.status));
  const activated=ev.filter(x=>x.referenceActivation);
  const targets=ev.filter(x=>x.outcome==='TARGET').length;
  const stops=ev.filter(x=>x.outcome==='STOP').length;
  const ambiguous=ev.filter(x=>x.ambiguous).length;
  const unresolved=ev.filter(x=>x.referenceActivation&&!x.resolved&&!x.ambiguous).length;
  const resolved=targets+stops;
  const cancelled=ev.filter(x=>['CANCELLED_NO_CHASE_GAP','CANCELLED_OPEN_BELOW_STOP','NOT_TRIGGERED_NEXT_SESSION'].includes(x.status)).length;
  positions.push({recommendationNumber:rank,issuedSignals:rows.length,evaluableSignals:evaluable.length,referenceActivated:activated.length,target1Hits:targets,stopHits:stops,ambiguous,unresolved,cancelledOrNotTriggered:cancelled,resolvedSignals:resolved,activationRatePct:pct(activated.length,evaluable.length),targetHitRateResolvedPct:pct(targets,resolved),targetHitRateActivatedPct:pct(targets,activated.length),rankingEligible:resolved>=5});
}
const comparedPositions=positions.slice(0,COMPARISON_LIMIT);
const byTargetCount=[...comparedPositions].sort((a,b)=>b.target1Hits-a.target1Hits||(Number(b.targetHitRateResolvedPct)||-1)-(Number(a.targetHitRateResolvedPct)||-1)||a.recommendationNumber-b.recommendationNumber);
const byTargetRate=[...comparedPositions].filter(x=>x.rankingEligible&&x.targetHitRateResolvedPct!=null).sort((a,b)=>b.targetHitRateResolvedPct-a.targetHitRateResolvedPct||b.target1Hits-a.target1Hits||a.recommendationNumber-b.recommendationNumber);
out.recommendationPositionPerformance={schemaVersion:'18.3.1-forward-position-20',trackingStartsOn:START,noBackfillBeforeStart:true,definition:'Unified daily recommendation rank at issuance time. Rank 1 means the first recommendation in that day’s V18 list.',comparisonRange:{from:1,to:COMPARISON_LIMIT},rankingMinimumResolvedSignals:5,positions,bestByTargetCount:byTargetCount[0]||null,bestByTargetRate:byTargetRate[0]||null,top10:positions.slice(0,10),top20:comparedPositions,summary:{positionsCompared:COMPARISON_LIMIT,positionsTracked:comparedPositions.filter(x=>x.issuedSignals>0).length,totalIssuedSignals:entries.filter(e=>Number(e.issued?.rank)<=COMPARISON_LIMIT).length,totalTarget1Hits:entries.filter(e=>Number(e.issued?.rank)<=COMPARISON_LIMIT&&e.futurePerformance?.outcome==='TARGET').length,totalStopHits:entries.filter(e=>Number(e.issued?.rank)<=COMPARISON_LIMIT&&e.futurePerformance?.outcome==='STOP').length}};
write(OUT,out);
console.log(JSON.stringify({trackingStartsOn:START,comparisonRange:out.recommendationPositionPerformance.comparisonRange,bestByTargetCount:out.recommendationPositionPerformance.bestByTargetCount,bestByTargetRate:out.recommendationPositionPerformance.bestByTargetRate,top20:out.recommendationPositionPerformance.top20.map(x=>({rank:x.recommendationNumber,issued:x.issuedSignals,target1:x.target1Hits,stop:x.stopHits,targetRate:x.targetHitRateResolvedPct}))},null,2));
