const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function performanceAnalytics(history){
  const recs=history?.recommendations??[];
  const resolved=recs.filter(r=>r.stop_hit||r.hit_2R);
  const netR=resolved.map(r=>r.stop_hit?-1:(r.hit_3R?3:2));
  const wins=netR.filter(x=>x>0),loss=netR.filter(x=>x<0);
  const grossWin=wins.reduce((a,b)=>a+b,0),grossLoss=Math.abs(loss.reduce((a,b)=>a+b,0));
  const top=(k)=>{const a=recs.filter(r=>r.rank!=null&&r.rank<=k&&(r.hit_2R||r.stop_hit));return a.length?a.filter(r=>r.hit_2R&&!r.stop_hit).length/a.length:null;};
  return {
    totalRecommendations:recs.length,resolved:resolved.length,
    winRate:resolved.length?wins.length/resolved.length:null,averageWin:avg(wins),averageLoss:avg(loss),
    expectancy:avg(netR),profitFactor:grossLoss?grossWin/grossLoss:null,
    maxDrawdownPct:recs.length?Math.min(...recs.map(r=>Number(r.max_drawdown_after_signal)).filter(Number.isFinite)):null,
    hit2RBeforeStopRate:resolved.length?recs.filter(r=>r.hit_2R&&!r.stop_hit).length/resolved.length:null,
    hit3RBeforeStopRate:resolved.length?recs.filter(r=>r.hit_3R&&!r.stop_hit).length/resolved.length:null,
    falseBreakoutRate:resolved.length?recs.filter(r=>r.status==='BREAKOUT CONFIRMED'&&r.stop_hit).length/Math.max(1,recs.filter(r=>r.status==='BREAKOUT CONFIRMED'&&(r.stop_hit||r.hit_2R)).length):null,
    averageHoldingSessions:avg(resolved.map(r=>r.observed_sessions).filter(Number.isFinite)),
    top1Precision:top(1),top3Precision:top(3),top5Precision:top(5),top10Precision:top(10),
    methodology:'CONSERVATIVE_DAILY_BAR_STOP_FIRST_WHEN_TARGET_AND_STOP_ORDER_IS_AMBIGUOUS'
  };
}
