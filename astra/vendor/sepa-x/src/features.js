import { DEFAULT_CONFIG } from './config.js';
import { atr, clamp, maxDrawdown, mean, median, pct, percentileRank, ret, round, slopePct, sma, std, trueRanges, weightedAvailable } from './math.js';

const gate=(pass,score,reasonCodes=[],raw={})=>({pass:Boolean(pass),score:round(score,1),reasonCodes,raw,timestamp:new Date().toISOString()});
const closes=(b)=>b.map(x=>x.close), vols=(b)=>b.map(x=>x.volume), turnover=(x)=>Number.isFinite(x.valueTraded)?x.valueTraded:x.close*x.volume;
const scoreLinear=(x,a,b)=>x==null?null:clamp((x-a)/(b-a)*100);

export function dataIntegrity(stock,cfg=DEFAULT_CONFIG){
  const {rows,entry,meta}=stock, expected=entry.summary?.lastSession||meta.expectedSessionDate;
  const valid=rows.filter(x=>x.close>0&&x.high>=x.low&&x.volume>=0);
  const latest=rows.at(-1)?.date||null, enough=rows.length>=cfg.market.requiredHistorySessions;
  const freshness=expected&&latest?latest===expected:true;
  const zero60=rows.slice(-60).filter(x=>x.volume===0).length;
  const factorJumps=[]; for(let i=1;i<rows.length;i++){const a=rows[i-1].adjustmentFactor,b=rows[i].adjustmentFactor;if(a&&b&&Math.abs(b/a-1)>0.15)factorJumps.push(rows[i].date);}
  const warnings=(entry.summary?.warnings||[]).map(String);
  const corpReview=warnings.some(x=>/corporate_action_review_required/i.test(x))||String(entry.longHistory?.dataQualityStatus||'').includes('REVIEW');
  const priceIntegrity=valid.length===rows.length?100:clamp(valid.length/Math.max(1,rows.length)*100);
  const volumeIntegrity=clamp(100-zero60/60*100);
  const historyCompleteness=clamp(rows.length/cfg.market.requiredHistorySessions*100);
  const fundamentalUnavailable=!entry.fundamentals||entry.fundamentals?.fundamentalDataConfidence==='UNAVAILABLE';
  const fundamentalFreshness=fundamentalUnavailable?35:(entry.fundamentals?.publicationDate?100:60);
  const corporateActionIntegrity=corpReview?40:(factorJumps.length?75:100);
  let confidence=weightedAvailable([[freshness?100:0,30],[historyCompleteness,25],[priceIntegrity,15],[volumeIntegrity,10],[fundamentalFreshness,5],[corporateActionIntegrity,15]])??0;
  const reasons=[]; if(!freshness)reasons.push('STALE_DATA');if(!enough)reasons.push('INSUFFICIENT_253_SESSION_HISTORY_FOR_R252');if(priceIntegrity<95)reasons.push('PRICE_INTEGRITY_FAIL');if(corpReview)reasons.push('CORPORATE_ACTION_REVIEW_REQUIRED');if(fundamentalUnavailable)reasons.push('FUNDAMENTALS_UNAVAILABLE_CONFIDENCE_PENALTY');
  const pass=freshness&&enough&&priceIntegrity>=95&&!corpReview&&confidence>=cfg.gates.minDataConfidence;
  return gate(pass,confidence,reasons,{data_freshness:freshness?100:0,history_completeness:round(historyCompleteness,1),price_integrity:round(priceIntegrity,1),volume_integrity:round(volumeIntegrity,1),fundamental_freshness:fundamentalFreshness,corporate_action_integrity:corporateActionIntegrity,latest,expected,sessionCount:rows.length,requiredSessionCount:cfg.market.requiredHistorySessions,longHistorySource:meta.longHistorySource??null,longHistoryRange:meta.longHistoryRange??null,longHistoryCoverageStart:meta.longHistoryCoverageStart??null,longHistoryCoverageEnd:meta.longHistoryCoverageEnd??null,overlapReconciliation:meta.overlapReconciliation??null,factorJumps});
}

export function liquidityEngine(bars,cfg=DEFAULT_CONFIG){
  const w20=bars.slice(-20),w50=bars.slice(-50),w60=bars.slice(-60);
  const m20=median(w20.map(turnover)),m50=median(w50.map(turnover)),av20=mean(w20.map(x=>x.volume));
  const traded=w60.length?w60.filter(x=>x.volume>0).length/w60.length:0,zero=w60.filter(x=>x.volume===0).length;
  const t=cfg.market.liquidity; let category='DANGEROUS';
  if(m20>=t.highMedianTurnover20&&traded>=0.9)category='HIGH';
  else if(m20>=t.acceptableMedianTurnover20&&traded>=t.minTradedDaysRatio60)category='ACCEPTABLE';
  else if(m20>=t.dangerousMedianTurnover20)category='LOW';
  const score=weightedAvailable([[scoreLinear(m20,t.dangerousMedianTurnover20,t.highMedianTurnover20),65],[traded*100,25],[clamp(100-zero/Math.max(1,w60.length)*100),10]])??0;
  return gate(category!=='DANGEROUS',score,category==='DANGEROUS'?['DANGEROUS_LIQUIDITY']:[],{MedianDailyTurnover20:round(m20,0),MedianDailyTurnover50:round(m50,0),AverageVolume20:round(av20,0),TradedDaysRatio60:round(traded,3),ZeroVolumeDays:zero,BidAskSpread:null,category});
}

export function trendTemplate(bars){
  const c=closes(bars),price=c.at(-1),s50=sma(c,50),s150=sma(c,150),s200=sma(c,200),s200old=bars.length>=220?sma(c,200,c.length-20):null;
  const w52=bars.length>=252?c.slice(-252):[],hi=w52.length?Math.max(...w52):null,lo=w52.length?Math.min(...w52):null;
  const conditions={
    price_gt_sma50:price>s50,price_gt_sma150:price>s150,price_gt_sma200:price>s200,
    sma50_gt_sma150:s50>s150,sma50_gt_sma200:s50>s200,sma150_gt_sma200:s150>s200,
    sma200_rising:s200old!=null&&s200>s200old,above_52w_low:lo!=null&&price>=1.30*lo,near_52w_high:hi!=null&&price>=0.75*hi
  };
  const known=Object.values(conditions),pass=known.every(Boolean)&&[s50,s150,s200,hi,lo].every(Number.isFinite);
  const score=known.filter(Boolean).length/known.length*100;
  return gate(pass,score,Object.entries(conditions).filter(([,v])=>!v).map(([k])=>`TREND_FAIL:${k}`),{
    price:round(price,4),SMA50:round(s50,4),SMA150:round(s150,4),SMA200:round(s200,4),SMA200_20_ago:round(s200old,4),
    high52w:round(hi,4),low52w:round(lo,4),distance_from_52w_high_pct:hi?pct(price,hi):null,distance_above_52w_low_pct:lo?pct(price,lo):null,
    sma50_slope:slopePct(c.slice(-70).map((_,i,a)=>sma(c,50,c.length-a.length+i+1)).filter(Number.isFinite),10),
    sma150_slope:slopePct(c.slice(-170).map((_,i,a)=>sma(c,150,c.length-a.length+i+1)).filter(Number.isFinite),10),
    sma200_slope:s200old&&s200?pct(s200,s200old):null,conditions
  });
}

export function rsRaw(bars,cfg=DEFAULT_CONFIG){
  const c=closes(bars),r63=ret(c,63),r126=ret(c,126),r189=ret(c,189),r252=ret(c,252);
  const w=cfg.rs.weights;
  const raw=[r63,r126,r189,r252].every(Number.isFinite)?r63*w.r63+r126*w.r126+r189*w.r189+r252*w.r252:null;
  return {raw,returns:{R63:round(r63,2),R126:round(r126,2),R189:round(r189,2),R252:round(r252,2)}};
}
export function applyRs(row,all,cfg=DEFAULT_CONFIG){
  const p=percentileRank(row.rs.raw,all.map(x=>x.rs.raw).filter(Number.isFinite));
  const klass=p==null?'UNKNOWN':p>=90?'ELITE':p>=80?'STRONG':p>=70?'ACCEPTABLE':'WEAK';
  return gate(p!=null&&p>=cfg.rs.minTop,p??0,p!=null&&p<cfg.rs.minTop?['RS_BELOW_70']:(p==null?['RS_UNAVAILABLE']:[]),{...row.rs.returns,RS_RAW:round(row.rs.raw,3),RS_PERCENTILE:round(p,1),classification:klass});
}

export function fundamentalEngine(entry){
  const f=entry.fundamentals;
  if(!f||f.fundamentalDataConfidence==='UNAVAILABLE')return gate(true,null,['FUNDAMENTALS_UNKNOWN'],{score:null,eps_growth:null,sales_growth:null,earnings_acceleration:null,margin_trend:null,earnings_quality:'UNKNOWN',asOf:f?.publicationDate||null});
  const m=f.metrics||{}, score=Number.isFinite(Number(f.fundamentalQualityScore))?Number(f.fundamentalQualityScore):null;
  const eps=m.latestQuarterlyEpsGrowthPct??m.epsGrowthPct??null, sales=m.latestSalesGrowthPct??m.revenueGrowthPct??null;
  return gate(true,score,[],{score:round(score,1),eps_growth:eps,sales_growth:sales,earnings_acceleration:m.earningsAcceleration??null,sales_acceleration:m.salesAcceleration??null,margin_trend:m.marginTrend??null,ROE:m.roe??null,debt_trend:m.debtTrend??null,operating_cash_flow:m.operatingCashFlow??null,free_cash_flow:m.freeCashFlow??null,earnings_quality:m.earningsQuality??'UNKNOWN',confidence:f.fundamentalDataConfidence,asOf:f.publicationDate||f.latestReportingPeriod||null});
}
export function catalystEngine(entry){
  const n=entry.news;
  const events=n?.materialEvents||[];
  if(!events.length)return gate(true,null,['CATALYST_UNKNOWN'],{catalyst:'UNKNOWN',coverageStatus:n?.coverageStatus||'UNKNOWN'});
  const e=events[0],score=n.newsImpactScore??50;
  return gate(true,score,[],{catalyst:{type:e.type||e.category||'MATERIAL_EVENT',date:e.date||e.publishedAt||null,strength:score,estimated_persistence:e.persistence||null,source:e.source||null,confidence:n.newsConfidence??null}});
}

function localExtrema(bars){
  const highs=[],lows=[];
  for(let i=2;i<bars.length-2;i++){
    const h=bars[i].high,l=bars[i].low,wh=bars.slice(i-2,i+3).map(x=>x.high),wl=bars.slice(i-2,i+3).map(x=>x.low);
    if(h>=Math.max(...wh))highs.push({i,value:h,date:bars[i].date});
    if(l<=Math.min(...wl))lows.push({i,value:l,date:bars[i].date});
  }
  return {highs,lows};
}
export function vcpEngine(bars){
  const w=bars.slice(-120),ex=localExtrema(w),contractions=[];
  for(const h of ex.highs){
    const low=ex.lows.find(x=>x.i>h.i&&x.i<=h.i+35);
    if(!low)continue;
    const nextHigh=ex.highs.find(x=>x.i>low.i);
    contractions.push({peak:round(h.value,4),trough:round(low.value,4),depth_pct:round((h.value-low.value)/h.value*100,2),duration_days:low.i-h.i,peakIndex:h.i,troughIndex:low.i,nextHighIndex:nextHigh?.i??null});
  }
  const recent=contractions.slice(-6);
  let seq=0; for(let i=1;i<recent.length;i++)if(recent[i].depth_pct<recent[i-1].depth_pct*1.05)seq++;
  const seqRatio=recent.length>1?seq/(recent.length-1):0;
  const tr=trueRanges(w),a5=sma(tr,5),a10=sma(tr,10),a20=sma(tr,20),a50=sma(tr,50);
  const c=closes(w),s5=std(c.slice(-5)),s10=std(c.slice(-10)),s20=std(c.slice(-20));
  const m20=sma(c,20), sd20=std(c.slice(-20)), bw=m20?4*sd20/m20*100:null;
  const compression=(a5<a20&&a10<a50);
  const compressionScore=weightedAvailable([[compression?100:30,50],[a20?clamp((1-a5/a20)*180+50):null,25],[a50?clamp((1-a10/a50)*180+50):null,25]])??0;
  const detected=recent.length>=2&&seqRatio>=0.5&&recent.at(-1).depth_pct<recent[0].depth_pct&&compression;
  const quality=weightedAvailable([[Math.min(100,recent.length/4*100),25],[seqRatio*100,35],[compressionScore,25],[recent.length?clamp(100-recent.at(-1).depth_pct*4):null,15]])??0;
  return gate(detected,quality,detected?[]:['VCP_NOT_CONFIRMED'],{detected,quality:round(quality,1),contractions:recent,volatility_compression_score:round(compressionScore,1),ATR5:round(a5,4),ATR10:round(a10,4),ATR20:round(a20,4),ATR50:round(a50,4),STD5:round(s5,4),STD10:round(s10,4),STD20:round(s20,4),BollingerBandwidth:round(bw,2),AverageTrueRangePercent:round(a20/w.at(-1).close*100,2)});
}

export function volumeEngine(bars,liquidity){
  const av=(p)=>mean(bars.slice(-p).map(x=>x.volume)),v5=av(5),v10=av(10),v20=av(20),v50=av(50),dry=v50?v5/v50:null;
  const highVol=v20||0; let accumulation=0,distribution=0,obv=0,obvSeries=[];
  for(let i=1;i<bars.length;i++){const b=bars[i],p=bars[i-1];if(b.close>p.close)obv+=b.volume;else if(b.close<p.close)obv-=b.volume;obvSeries.push(obv);if(b.volume>highVol*1.1){if(b.close>p.close)accumulation++;else if(b.close<p.close)distribution++;}}
  const dryHealthy=dry!=null&&dry<0.8&&liquidity.raw.category!=='DANGEROUS';
  const dryScore=dry==null?null:clamp((1-dry)*120+55);
  const accScore=clamp(50+(accumulation-distribution)*5);
  const distributionRisk=clamp(50+(distribution-accumulation)*5);
  return gate(true,weightedAvailable([[dryScore,50],[accScore,50]]),[],{AvgVolume5:round(v5,0),AvgVolume10:round(v10,0),AvgVolume20:round(v20,0),AvgVolume50:round(v50,0),volume_dryup_ratio:round(dry,3),healthy_supply_contraction:dryHealthy,accumulation_days:accumulation,distribution_days:distribution,accumulation_score:round(accScore,1),distribution_risk:round(distributionRisk,1),obv_slope:slopePct(obvSeries,10)});
}
export function tightnessEngine(bars){
  const calc=(p)=>{const w=bars.slice(-p),hi=Math.max(...w.map(x=>x.high)),lo=Math.min(...w.map(x=>x.low)),c=closes(w),a=atr(w,Math.min(14,w.length));return{range_pct:round((hi-lo)/lo*100,2),close_to_close_volatility:round(std(c.map((x,i)=>i?pct(x,c[i-1]):0).slice(1)),2),ATR_pct:round(a/w.at(-1).close*100,2),max_drawdown:round(maxDrawdown(c),2),close_position_in_range:round((w.at(-1).close-lo)/(hi-lo||1)*100,1)}};
  const x={3:calc(3),5:calc(5),10:calc(10),20:calc(20)}, score=weightedAvailable([[clamp(100-x[5].range_pct*8),35],[clamp(100-x[10].range_pct*5),30],[clamp(100-x[20].range_pct*3),20],[x[5].close_position_in_range,15]])??0;
  return gate(true,score,[],{...x,tightness_score:round(score,1)});
}

export function pivotEngine(bars,vcp){
  const w=bars.slice(-80),price=w.at(-1).close,a=atr(w,14),ex=localExtrema(w);
  const highs=ex.highs.filter(x=>x.i<w.length-1);
  const tolerance=Math.max(price*0.012,(a||0)*0.5);
  const candidates=[];
  for(const h of highs){
    const cluster=highs.filter(x=>Math.abs(x.value-h.value)<=tolerance);
    if(cluster.length>=2)candidates.push({value:median(cluster.map(x=>x.value)),touches:cluster.length,lastIndex:Math.max(...cluster.map(x=>x.i))});
  }
  if(vcp.raw.contractions?.length){const p=vcp.raw.contractions.at(-1).peak;if(p)candidates.push({value:p,touches:1,lastIndex:50,source:'LAST_CONTRACTION'});}
  const uniq=candidates.sort((a,b)=>b.lastIndex-a.lastIndex||b.touches-a.touches);
  const best=uniq.find(x=>x.value>=price*0.96)||uniq[0]||null;
  if(!best)return gate(false,0,['PIVOT_NOT_FOUND'],{pivot_price:null,pivot_confidence:0,pivot_touches:0,days_below_pivot:null,distance_to_pivot_pct:null,distance_to_pivot_ATR:null});
  const pivot=best.value,touches=best.touches,days=w.filter(x=>x.close<pivot).length,dist=(pivot-price)/pivot*100,distAtr=a?(pivot-price)/a:null;
  const conf=clamp(45+Math.min(30,touches*10)+Math.min(15,days/4)+(vcp.pass?10:0));
  return gate(conf>=55,conf,conf<55?['PIVOT_LOW_CONFIDENCE']:[],{pivot_price:round(pivot,4),pivot_confidence:round(conf,1),pivot_touches:touches,days_below_pivot:days,distance_to_pivot_pct:round(dist,2),distance_to_pivot_ATR:round(distAtr,2)});
}

export function entryEngine(bars,pivot,volume,trend,rs,cfg=DEFAULT_CONFIG){
  const price=bars.at(-1).close,p=pivot.raw.pivot_price,a=atr(bars,14),v20=volume.raw.AvgVolume20||null,currentV=bars.at(-1).volume,vr=v20?currentV/v20:null;
  if(!p)return gate(false,0,['NO_PIVOT'],{status:'AVOID'});
  const d=(p-price)/p*100,above=(price-p)/p*100,previous=bars.at(-2)?.close;
  let status='FORMING', action='WATCH';
  const recentBreakout=price>p&&previous!=null&&previous<=p;
  const priorBreakout=bars.slice(-8,-1).some(x=>x.close>p);
  if(priorBreakout&&price<p&&currentV>(v20||Infinity)*1.2){status='FAILED BREAKOUT';action='AVOID';}
  else if(price>p&&(above>cfg.entry.maxAbovePivotPct||(a&&price-p>a*cfg.entry.maxAbovePivotAtr))){status='EXTENDED';action='WAIT FOR NEW SETUP';}
  else if(price>p&&recentBreakout&&vr>=cfg.entry.breakoutVolumeConfirm&&trend.pass&&rs.pass){status='BREAKOUT CONFIRMED';action='BUY ZONE';}
  else if(d>=0&&d<=cfg.entry.readyBelowPivotPct&&trend.pass&&rs.pass){status='READY NOW';action='WATCH TRIGGER';}
  else if(d>cfg.entry.readyBelowPivotPct&&d<=cfg.entry.nearBelowPivotPct&&trend.pass&&rs.pass){status='NEAR PIVOT';action='WATCH';}
  else if(!trend.pass||!rs.pass){status='AVOID';action='AVOID';}
  const readiness=({ 'BREAKOUT CONFIRMED':100,'READY NOW':96,'NEAR PIVOT':82,'FORMING':55,'EXTENDED':20,'FAILED BREAKOUT':5,'AVOID':0})[status]??0;
  return gate(!['EXTENDED','FAILED BREAKOUT','AVOID'].includes(status),readiness,['EXTENDED','FAILED BREAKOUT','AVOID'].includes(status)?[status.replace(/ /g,'_')]:[],{status,action,price:round(price,4),pivot:round(p,4),distance_to_pivot_pct:round(d,2),breakout_volume_ratio:round(vr,2),do_not_chase:status==='EXTENDED'});
}

export function riskEngine(bars,pivot,vcp,entry,cfg=DEFAULT_CONFIG){
  const p=pivot.raw.pivot_price,a=atr(bars,14);if(!p||!a)return gate(false,0,['RISK_INPUT_MISSING'],{entry:null,stop:null,risk_pct:null,reward_risk:null});
  const recentLows=bars.slice(-20).map(x=>x.low),lastContractionLow=vcp.raw.contractions?.at(-1)?.trough;
  const structural=Math.max(...[Math.min(...recentLows),lastContractionLow].filter(x=>Number.isFinite(x)&&x<p));
  const entryFrom=p,entryTo=p*(1+cfg.entry.buyZoneAbovePivotPct/100), stopCandidate=structural-a*0.20;
  const stop=stopCandidate>0?stopCandidate:null, riskPct=stop?(entryTo-stop)/entryTo*100:null;
  const high52=bars.length>=252?Math.max(...bars.slice(-252).map(x=>x.high)):null;
  const baseLow=Math.min(...bars.slice(-60).map(x=>x.low)),projection=p+(p-baseLow);
  const resistance=[high52,projection].filter(x=>Number.isFinite(x)&&x>entryTo).sort((a,b)=>a-b)[0]||null;
  const rr=(stop&&resistance)?(resistance-entryTo)/(entryTo-stop):null;
  const pass=riskPct!=null&&riskPct<=cfg.risk.maxInitialRiskPct&&rr!=null&&rr>=cfg.risk.preferredRewardRisk;
  const reasons=[];if(riskPct==null)reasons.push('STOP_UNAVAILABLE');else if(riskPct>cfg.risk.maxInitialRiskPct)reasons.push('RISK_TOO_WIDE');if(rr==null||rr<cfg.risk.preferredRewardRisk)reasons.push('RR_BELOW_2');
  const score=weightedAvailable([[riskPct==null?null:clamp((cfg.risk.maxInitialRiskPct-riskPct)/(cfg.risk.maxInitialRiskPct-cfg.risk.minInitialRiskPct)*60+40),45],[rr==null?null:clamp(rr/3*100),55]])??0;
  return gate(pass,score,reasons,{entry:round(entryFrom,4),entry_zone:{from:round(entryFrom,4),to:round(entryTo,4)},stop_loss:round(stop,4),risk_per_share:stop?round(entryTo-stop,4):null,risk_pct:round(riskPct,2),nearest_resistance:round(resistance,4),technical_projection:round(projection,4),reward_risk:round(rr,2),R_multiple:round(rr,2)});
}

export function sectorEngine(rows){
  const groups=new Map();
  for(const r of rows){const s=r.sector||'UNKNOWN';if(!groups.has(s))groups.set(s,[]);groups.get(s).push(r);}
  const groupScores=new Map();
  for(const [s,a] of groups){
    const r1=median(a.map(x=>x.rs.returns.R63/3)),r3=median(a.map(x=>x.rs.returns.R63)),r6=median(a.map(x=>x.rs.returns.R126));
    groupScores.set(s,{sector_return_1m:r1,sector_return_3m:r3,sector_return_6m:r6,raw:weightedAvailable([[r1,0.2],[r3,0.4],[r6,0.4]])});
  }
  const vals=[...groupScores.values()].map(x=>x.raw).filter(Number.isFinite);
  for(const [s,x] of groupScores)x.sector_RS_percentile=percentileRank(x.raw,vals);
  return groupScores;
}

export function marketRegime(rows,benchmark=[]){
  const eligible=rows.filter(x=>x.bars?.length>=200),n=eligible.length||1;
  const breadth={
    pct_stocks_gt_sma20:round(eligible.filter(x=>x.bars.at(-1).close>sma(closes(x.bars),20)).length/n*100,1),
    pct_stocks_gt_sma50:round(eligible.filter(x=>x.bars.at(-1).close>sma(closes(x.bars),50)).length/n*100,1),
    pct_stocks_gt_sma200:round(eligible.filter(x=>x.bars.at(-1).close>sma(closes(x.bars),200)).length/n*100,1),
  };
  const bc=closes(benchmark),bp=bc.at(-1),b20=sma(bc,20),b50=sma(bc,50),b200=sma(bc,200);
  const indexAvailable=[bp,b20,b50,b200].every(Number.isFinite);
  const indexScore=indexAvailable?[bp>b20,bp>b50,bp>b200,b50>b200].filter(Boolean).length/4*100:null;
  const breadthScore=weightedAvailable([[breadth.pct_stocks_gt_sma20,30],[breadth.pct_stocks_gt_sma50,35],[breadth.pct_stocks_gt_sma200,35]])??50;
  const score=weightedAvailable([[indexScore,55],[breadthScore,45]])??breadthScore;
  const regime=score>=80?'STRONG BULL':score>=65?'BULL':score>=48?'NEUTRAL':score>=32?'CAUTION':'BEAR';
  const factor=({ 'STRONG BULL':1,'BULL':0.98,'NEUTRAL':0.92,'CAUTION':0.82,'BEAR':0.65})[regime];
  return {regime,score:round(score,1),factor,indexAvailable,breadth,index:{price:round(bp,2),SMA20:round(b20,2),SMA50:round(b50,2),SMA200:round(b200,2),momentum20:ret(bc,20),momentum63:ret(bc,63)}};
}

export function finalize(row,allRows,sectorScores,market,cfg=DEFAULT_CONFIG){
  const rs=applyRs(row,allRows,cfg), sector=sectorScores.get(row.sector)||null;
  const entry=entryEngine(row.bars,row.pivot,row.volume,row.trend,rs,cfg),risk=riskEngine(row.bars,row.pivot,row.vcp,entry,cfg);
  const hardReasons=[];
  if(!row.data.pass)hardReasons.push(...row.data.reasonCodes);
  if(!row.liquidity.pass)hardReasons.push(...row.liquidity.reasonCodes);
  if(!row.trend.pass)hardReasons.push('TREND_TEMPLATE_FAIL');
  if(!rs.pass)hardReasons.push(...rs.reasonCodes);
  if(row.vcp.score<cfg.gates.minVcpQualityForTop)hardReasons.push('BASE_QUALITY_LOW');
  if(['EXTENDED','FAILED BREAKOUT','AVOID'].includes(entry.raw.status))hardReasons.push(entry.raw.status.replace(/ /g,'_'));
  if(['READY NOW','BREAKOUT CONFIRMED'].includes(entry.raw.status)&&!risk.pass)hardReasons.push(...risk.reasonCodes);
  if(market.regime==='BEAR'&&['READY NOW','BREAKOUT CONFIRMED'].includes(entry.raw.status))hardReasons.push('MARKET_BEAR');
  const scores={
    trend:row.trend.score,rs:rs.score,fundamentals:row.fundamentals.score,vcp:row.vcp.score,tightness:row.tightness.score,
    volume:row.volume.score,entry:entry.score,sector:sector?.sector_RS_percentile??null,catalyst:row.catalyst.score,riskReward:risk.score,liquidity:row.liquidity.score
  };
  const weights=cfg.scoring;
  const raw=weightedAvailable([[scores.trend,weights.trend],[scores.rs,weights.rs],[scores.fundamentals,weights.fundamentals],[scores.vcp,weights.vcp],[scores.tightness,weights.tightness],[scores.volume,weights.volume],[scores.entry,weights.entry],[scores.sector,weights.sector],[scores.catalyst,weights.catalyst],[scores.riskReward,weights.riskReward],[scores.liquidity,weights.liquidity]]);
  const dataFactor=clamp(row.data.score)/100,liqFactor=row.liquidity.raw.category==='HIGH'?1:row.liquidity.raw.category==='ACCEPTABLE'?0.97:0.80;
  const finalScore=raw==null?null:raw*market.factor*dataFactor*liqFactor;
  const strength=weightedAvailable([[row.trend.score,30],[rs.score,30],[row.fundamentals.score,20],[sector?.sector_RS_percentile,10],[row.liquidity.score,10]]);
  const clarity=weightedAvailable([[row.vcp.score,42],[row.tightness.score,28],[row.volume.score,20],[row.pivot.score,10]]);
  const readiness=entry.score;
  const klass=finalScore==null?'REJECT':finalScore>=95?'ELITE':finalScore>=90?'EXCEPTIONAL':finalScore>=85?'STRONG':finalScore>=80?'GOOD WATCH':finalScore>=70?'DEVELOPING':'REJECT';
  const eligibleForTop=hardReasons.length===0&&['READY NOW','BREAKOUT CONFIRMED','NEAR PIVOT'].includes(entry.raw.status);
  const action=entry.raw.status==='EXTENDED'?'WAIT FOR NEW SETUP':entry.raw.status==='FAILED BREAKOUT'?'AVOID':market.regime==='BEAR'?'WATCH — MARKET RISK':eligibleForTop?(entry.raw.status==='BREAKOUT CONFIRMED'?'BUY ZONE':'WATCH TRIGGER'):'WATCH';
  const confidence=weightedAvailable([
    [row.data.score,35],[row.vcp.score,20],[row.pivot.score,15],
    [row.fundamentals.score ?? 35,10],[row.catalyst.score ?? 35,5],[rs.score,15]
  ])??row.data.score;
  const why=[];
  if(rs.raw.RS_PERCENTILE!=null)why.push(`RS_PERCENTILE_${round(rs.raw.RS_PERCENTILE,1)}`);
  if(row.trend.pass)why.push('MINERVINI_TREND_TEMPLATE_PASS');
  if(row.vcp.pass)why.push(`VCP_CONFIRMED_QUALITY_${round(row.vcp.score,1)}`);
  else if(row.vcp.score>=cfg.gates.minVcpQualityForTop)why.push(`BASE_QUALITY_${round(row.vcp.score,1)}`);
  if(row.volume.raw.healthy_supply_contraction)why.push(`HEALTHY_VOLUME_DRY_UP_${round(row.volume.raw.volume_dryup_ratio,2)}`);
  if(row.pivot.pass)why.push(`PIVOT_CONFIDENCE_${round(row.pivot.score,1)}`);
  if(entry.raw.distance_to_pivot_pct!=null)why.push(`DISTANCE_TO_PIVOT_${round(entry.raw.distance_to_pivot_pct,2)}pct`);
  if(sector?.sector_RS_percentile!=null)why.push(`SECTOR_RS_${round(sector.sector_RS_percentile,1)}`);
  if(risk.raw.risk_pct!=null)why.push(`INITIAL_RISK_${round(risk.raw.risk_pct,2)}pct`);
  if(risk.raw.reward_risk!=null)why.push(`REWARD_RISK_${round(risk.raw.reward_risk,2)}`);
  if(row.fundamentals.raw?.score!=null)why.push(`FUNDAMENTAL_QUALITY_${round(row.fundamentals.raw.score,1)}`);
  if(row.catalyst.raw?.catalyst && row.catalyst.raw.catalyst!=='UNKNOWN')why.push('VERIFIED_CATALYST_PRESENT');
  return {...row,rs,sector,entry,risk,market,hardReasons:[...new Set(hardReasons)],eligibleForTop,
    final_score:round(finalScore,1),raw_opportunity_score:round(raw,1),strength_score:round(strength,1),setup_clarity_score:round(clarity,1),entry_readiness_score:round(readiness,1),confidence_score:round(confidence,1),
    classification:klass,status:entry.raw.status,action,
    why_selected:why,risks:[...new Set(hardReasons)],invalidation:risk.raw.stop_loss?[`CLOSE_BELOW_${risk.raw.stop_loss}`,'FAILED_BREAKOUT','SELLING_VOLUME_EXPANSION','MARKET_REGIME_DETERIORATION']:['NO_VALID_STRUCTURAL_STOP']
  };
}
