import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const auditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const historyDir = path.join(repoRoot, 'data/history');
const outPath = path.join(repoRoot, 'tfe-v20/reports/meta-entry-quality-audit.json');

const HOLD = 3;
const COST_PCT = 0.60;
const MIN_PRIOR_FEATURES = 30;
const HEAT_PERCENTILE_CUTOFF = 0.80;

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function round(v, d = 3) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function pct(a, b) { return b ? (a / b - 1) * 100 : 0; }

function rawBars(doc) {
  return (doc?.sessions || []).map(x => ({
    date: x.date, open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close), volume: Number(x.volume || 0)
  })).filter(x => x.date && x.open > 0 && x.high > 0 && x.low > 0 && x.close > 0).sort((a,b)=>a.date.localeCompare(b.date));
}
function adjustedBars(doc) {
  return (doc?.sessions || []).map(x => {
    const close = Number(x.close), adj = Number(x.adjustedClose ?? x.close), f = close ? adj / close : 1;
    return { date:x.date, open:Number(x.open)*f, high:Number(x.high)*f, low:Number(x.low)*f, close:adj, volume:Number(x.volume||0) };
  }).filter(x => x.date && x.open > 0 && x.high > 0 && x.low > 0 && x.close > 0).sort((a,b)=>a.date.localeCompare(b.date));
}
function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = mean(values.slice(0, period));
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
function rsi14(bars) {
  const p = 14;
  if (bars.length < p + 1) return null;
  const deltas = [];
  for (let i = 1; i < bars.length; i++) deltas.push(bars[i].close - bars[i-1].close);
  let gain = mean(deltas.slice(0,p).map(x=>Math.max(0,x)));
  let loss = mean(deltas.slice(0,p).map(x=>Math.max(0,-x)));
  for (let i=p;i<deltas.length;i++) {
    gain = (gain * (p - 1) + Math.max(0,deltas[i])) / p;
    loss = (loss * (p - 1) + Math.max(0,-deltas[i])) / p;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}
function atr14(bars) {
  const p=14;
  if (bars.length < p + 1) return null;
  const trs=[];
  for(let i=1;i<bars.length;i++) {
    const b=bars[i], prev=bars[i-1].close;
    trs.push(Math.max(b.high-b.low, Math.abs(b.high-prev), Math.abs(b.low-prev)));
  }
  let a=mean(trs.slice(0,p));
  for(let i=p;i<trs.length;i++) a=(a*(p-1)+trs[i])/p;
  return a;
}
function entryFeatures(adj, signalDate) {
  const bs = adj.filter(x => x.date <= signalDate);
  if (bs.length < 25 || bs.at(-1)?.date !== signalDate) return null;
  const rsi = rsi14(bs), atr = atr14(bs), e20 = ema(bs.map(x=>x.close),20), close=bs.at(-1).close;
  if (![rsi,atr,e20,close].every(Number.isFinite) || atr <= 0) return null;
  return { rsi14:rsi, ema20:e20, atr14:atr, extensionAtr:(close-e20)/atr, featureDate:bs.at(-1).date };
}
function empiricalPercentile(prior, value) {
  if (!prior.length || !Number.isFinite(value)) return null;
  return prior.filter(x => x <= value).length / prior.length;
}
function future(raw, date, n=HOLD) { return raw.filter(x=>x.date>date).slice(0,n); }
function evaluate(member, raw, signalDate) {
  const win=future(raw,signalDate,HOLD);
  if(win.length<HOLD) return {status:'INSUFFICIENT_FUTURE',filled:false,netReturnPct:null};
  const l={entryLow:Number(member.entryLow),entryHigh:Number(member.entryHigh),stopLoss:Number(member.stopLoss),target1:Number(member.target1)};
  if(!Object.values(l).every(x=>Number.isFinite(x)&&x>0)) return {status:'BAD_LEVELS',filled:false,netReturnPct:null};
  let entered=false,entry=null,status='UNFILLED',exit=null,entryDate=null,exitDate=null;
  for(const b of win){
    if(!entered){
      if(b.open>=l.entryLow&&b.open<=l.entryHigh){entry=b.open;entered=true;entryDate=b.date;}
      else if(b.low<=l.entryHigh&&b.high>=l.entryLow){entry=b.open>l.entryHigh?l.entryHigh:b.open<l.entryLow?l.entryLow:l.entryHigh;entered=true;entryDate=b.date;}
      else continue;
    }
    const stop=b.low<=l.stopLoss,target=b.high>=l.target1;
    if(stop&&target){exit=l.stopLoss;status='STOP_SAME_BAR';exitDate=b.date;break;}
    if(stop){exit=l.stopLoss;status='STOP_HIT';exitDate=b.date;break;}
    if(target){exit=l.target1;status='TARGET_HIT';exitDate=b.date;break;}
  }
  if(!entered)return{status:'UNFILLED',filled:false,netReturnPct:0,window:win.map(x=>x.date)};
  if(exit==null){exit=win.at(-1).close;status='TIME_EXIT';exitDate=win.at(-1).date;}
  return{status,filled:true,entryPrice:entry,entryDate,exitPrice:exit,exitDate,netReturnPct:pct(exit,entry)-COST_PCT,window:win.map(x=>x.date)};
}
function maxDrawdown(sessionReturns){let eq=1,peak=1,mdd=0;for(const r of sessionReturns){eq*=1+r/100;peak=Math.max(peak,eq);mdd=Math.min(mdd,(eq/peak-1)*100);}return mdd;}
function summarize(rows, allDates) {
  const valid=rows.filter(x=>!['INSUFFICIENT_FUTURE','BAD_LEVELS'].includes(x.status));
  const filled=valid.filter(x=>x.filled), nets=filled.map(x=>x.netReturnPct), pos=nets.filter(x=>x>0), neg=nets.filter(x=>x<0);
  const byDate=new Map(allDates.map(d=>[d,[]]));
  for(const r of valid){if(!byDate.has(r.signalDate))byDate.set(r.signalDate,[]);byDate.get(r.signalDate).push(r.netReturnPct||0);}
  const sessionReturns=[...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([,v])=>v.length?mean(v):0);
  let eq=1; for(const r of sessionReturns)eq*=1+r/100;
  return{
    signals:valid.length,filled:filled.length,fillRatePct:round(valid.length?filled.length/valid.length*100:0,1),
    targetHitPct:round(filled.length?filled.filter(x=>x.status==='TARGET_HIT').length/filled.length*100:0,1),
    stopHitPct:round(filled.length?filled.filter(x=>x.status.startsWith('STOP')).length/filled.length*100:0,1),
    timeExitPct:round(filled.length?filled.filter(x=>x.status==='TIME_EXIT').length/filled.length*100:0,1),
    positiveTradeRatePct:round(filled.length?pos.length/filled.length*100:0,1),averageNetPct:round(mean(nets)),medianNetPct:round(median(nets)),
    profitFactor:round(neg.length?pos.reduce((a,b)=>a+b,0)/Math.abs(neg.reduce((a,b)=>a+b,0)):pos.length?999:0,2),
    sessions:sessionReturns.length,avgBasketNetPct:round(mean(sessionReturns)),compoundedBasketPct:round((eq-1)*100),maxDrawdownPct:round(maxDrawdown(sessionReturns))
  };
}
function delta(a,b){return{averageNetPct:round(a.averageNetPct-b.averageNetPct),targetHitPct:round(a.targetHitPct-b.targetHitPct,1),stopHitPct:round(a.stopHitPct-b.stopHitPct,1),positiveTradeRatePct:round(a.positiveTradeRatePct-b.positiveTradeRatePct,1),profitFactor:round(a.profitFactor-b.profitFactor,2),avgBasketNetPct:round(a.avgBasketNetPct-b.avgBasketNetPct),maxDrawdownPct:round(a.maxDrawdownPct-b.maxDrawdownPct)};}

const audit=readJson(auditPath);
const docs=new Map();
for(const file of fs.readdirSync(historyDir).filter(x=>x.endsWith('.json'))){const d=readJson(path.join(historyDir,file));const ticker=String(d.ticker||file.replace(/\.json$/i,'')).toUpperCase();docs.set(ticker,{raw:rawBars(d),adj:adjustedBars(d)});}

const sessions=(audit.sessions||[]).slice().sort((a,b)=>a.signalDate.localeCompare(b.signalDate));
const priorRsi=[],priorExt=[]; const rows=[]; const evaluationDates=[]; let missingFeatures=0;
for(const session of sessions){
  const currentFeatures=[];
  let dateEligible=false;
  for(const member of session.members||[]){
    const ticker=String(member.ticker).toUpperCase(),doc=docs.get(ticker); if(!doc)continue;
    const f=entryFeatures(doc.adj,session.signalDate); const outcome=evaluate(member,doc.raw,session.signalDate);
    if(!f){missingFeatures++;rows.push({...outcome,signalDate:session.signalDate,ticker,featureAvailable:false,heatEligible:false,overheated:false,kept:true});continue;}
    if(f.featureDate!==session.signalDate) throw new Error(`LOOKAHEAD_OR_STALE_FEATURE:${ticker}:${session.signalDate}:${f.featureDate}`);
    currentFeatures.push(f);
    const enough=priorRsi.length>=MIN_PRIOR_FEATURES&&priorExt.length>=MIN_PRIOR_FEATURES;
    const rsiPct=enough?empiricalPercentile(priorRsi,f.rsi14):null,extPct=enough?empiricalPercentile(priorExt,f.extensionAtr):null;
    const heatPct=enough?(rsiPct+extPct)/2:null;
    const overheated=enough&&heatPct>=HEAT_PERCENTILE_CUTOFF;
    if(enough)dateEligible=true;
    rows.push({...outcome,signalDate:session.signalDate,ticker,featureAvailable:true,rsi14:round(f.rsi14,2),extensionAtr:round(f.extensionAtr,3),rsiPercentile:round(rsiPct,3),extensionPercentile:round(extPct,3),heatPercentile:round(heatPct,3),heatEligible:enough,overheated,kept:!overheated});
  }
  if(dateEligible)evaluationDates.push(session.signalDate);
  for(const f of currentFeatures){priorRsi.push(f.rsi14);priorExt.push(f.extensionAtr);}
}

const evalSet=new Set(evaluationDates), evalRows=rows.filter(x=>evalSet.has(x.signalDate)&&x.heatEligible);
const kept=evalRows.filter(x=>x.kept), skipped=evalRows.filter(x=>!x.kept);
const baseline=summarize(evalRows,evaluationDates), filtered=summarize(kept,evaluationDates), skippedSummary=summarize(skipped,evaluationDates), uplift=delta(filtered,baseline);
const folds=[];
for(let i=0;i<3;i++){
  const start=Math.floor(i*evaluationDates.length/3),end=Math.floor((i+1)*evaluationDates.length/3),dates=evaluationDates.slice(start,end),set=new Set(dates),rr=evalRows.filter(x=>set.has(x.signalDate)),kk=rr.filter(x=>x.kept),bb=summarize(rr,dates),ff=summarize(kk,dates),dd=delta(ff,bb);
  folds.push({fold:i+1,from:dates[0]||null,to:dates.at(-1)||null,baseline:bb,filtered:ff,deltaFilteredMinusBaseline:dd,positiveDirection:dd.averageNetPct>0&&dd.stopHitPct<=0&&dd.avgBasketNetPct>=0});
}
const checks={
  evaluatedFilledAtLeast60:baseline.filled>=60,
  skippedFilledAtLeast12:skippedSummary.filled>=12,
  averageNetImprovesByAtLeast025pp:uplift.averageNetPct>=0.25,
  stopRateImprovesByAtLeast5pp:uplift.stopHitPct<=-5,
  profitFactorNotWorse:filtered.profitFactor>=baseline.profitFactor,
  maxDrawdownNotWorse:filtered.maxDrawdownPct>=baseline.maxDrawdownPct,
  positiveDirectionAtLeast2Of3Folds:folds.filter(x=>x.positiveDirection).length>=2
};
const supportsRiskGate=Object.values(checks).every(Boolean);
const report={
  schemaVersion:'meta-entry-quality-audit-v1',generatedAt:new Date().toISOString(),evidenceClass:'OUTCOME_BLIND_EXPANDING_PERCENTILE_RETROSPECTIVE_REPLAY',
  policy:{primaryAlpha:'V16.9 exact blocked walk-forward selections',holdingSessions:HOLD,roundTripCostPct:COST_PCT,sameBarTargetStop:'STOP_FIRST',entry:'NEXT_SESSION_ZONE_TOUCH',featureInputs:'signal-date adjusted OHLC only',featureRule:'heat = mean(expanding historical percentile of RSI14, expanding historical percentile of EMA20 extension in ATR14)',minimumPriorFeatureObservations:MIN_PRIOR_FEATURES,overheatedIfHeatPercentileAtLeast:HEAT_PERCENTILE_CUTOFF,thresholdUsesOutcomes:false,missingFeatureTreatment:'KEEP_NEUTRAL_NOT_BEARISH'},
  coverage:{sourceSessions:sessions.length,evaluationSessions:evaluationDates.length,evaluationFrom:evaluationDates[0]||null,evaluationTo:evaluationDates.at(-1)||null,evaluationRows:evalRows.length,missingFeatures},
  baseline,filtered,skipped:skippedSummary,deltaFilteredMinusBaseline:uplift,folds,preregisteredChecks:checks,supportsRiskGate,
  promotion:{eligible:false,reason:supportsRiskGate?'Entry-heat abstention survives this outcome-blind historical replay, but remains retrospective and must pass fresh forward evidence before production promotion.':'Entry-heat abstention does not robustly improve V16 under preregistered checks; reject this rule and do not tune the cutoff on these outcomes.'}
};
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
