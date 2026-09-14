import fs from 'node:fs';
import path from 'node:path';
import { buildRawPullbackSnapshot } from '../src/rawPullbackExpert.js';

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === 'tfe-v20' ? path.resolve(cwd, '..') : cwd;
const historyDir = path.join(repoRoot, 'data/history');
const v16AuditPath = path.join(repoRoot, 'data/research/v16-v169-target-hit-audit.json');
const outPath = path.join(repoRoot, 'tfe-v20/reports/raw-pullback-expert-audit.json');

const HOLD = 3;
const COST_PCT = 0.60;
const CONFIRM_SCORE = 70;

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function round(v, d = 3) { return Number.isFinite(v) ? Number(v.toFixed(d)) : null; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function median(xs) { if (!xs.length) return 0; const s=[...xs].sort((a,b)=>a-b); const i=Math.floor(s.length/2); return s.length%2?s[i]:(s[i-1]+s[i])/2; }
function pct(a,b) { return b ? (a/b-1)*100 : 0; }

function rawBars(document) {
  return (document?.sessions || []).map(row => ({
    date: String(row.date || '').slice(0,10),
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0)
  })).filter(x => x.date && x.open>0 && x.high>0 && x.low>0 && x.close>0).sort((a,b)=>a.date.localeCompare(b.date));
}

function future(raw, date, count = HOLD) { return raw.filter(x => x.date > date).slice(0, count); }

function evaluateStandalone(raw, signalDate) {
  const win = future(raw, signalDate, HOLD);
  if (win.length < HOLD) return { status:'INSUFFICIENT_FUTURE', filled:false, netReturnPct:null };
  const entry = win[0].open;
  const exit = win.at(-1).close;
  return { status:'TIME_EXIT', filled:true, entryDate:win[0].date, exitDate:win.at(-1).date, netReturnPct:pct(exit,entry)-COST_PCT };
}

function evaluateV16(member, raw, signalDate) {
  const win = future(raw, signalDate, HOLD);
  if (win.length < HOLD) return { status:'INSUFFICIENT_FUTURE', filled:false, netReturnPct:null };
  const levels = { entryLow:Number(member.entryLow), entryHigh:Number(member.entryHigh), stopLoss:Number(member.stopLoss), target1:Number(member.target1) };
  if (!Object.values(levels).every(x => Number.isFinite(x) && x > 0)) return { status:'BAD_LEVELS', filled:false, netReturnPct:null };
  let entered=false, entry=null, exit=null, status='UNFILLED';
  for (const bar of win) {
    if (!entered) {
      if (bar.open >= levels.entryLow && bar.open <= levels.entryHigh) { entry=bar.open; entered=true; }
      else if (bar.low <= levels.entryHigh && bar.high >= levels.entryLow) {
        entry = bar.open > levels.entryHigh ? levels.entryHigh : bar.open < levels.entryLow ? levels.entryLow : levels.entryHigh;
        entered=true;
      } else continue;
    }
    const stop = bar.low <= levels.stopLoss;
    const target = bar.high >= levels.target1;
    if (stop && target) { exit=levels.stopLoss; status='STOP_SAME_BAR'; break; }
    if (stop) { exit=levels.stopLoss; status='STOP_HIT'; break; }
    if (target) { exit=levels.target1; status='TARGET_HIT'; break; }
  }
  if (!entered) return { status:'UNFILLED', filled:false, netReturnPct:0 };
  if (exit == null) { exit=win.at(-1).close; status='TIME_EXIT'; }
  return { status, filled:true, netReturnPct:pct(exit,entry)-COST_PCT };
}

function maxDrawdown(sessionReturns) {
  let eq=1, peak=1, mdd=0;
  for (const r of sessionReturns) { eq*=1+r/100; peak=Math.max(peak,eq); mdd=Math.min(mdd,(eq/peak-1)*100); }
  return mdd;
}

function summarize(rows, dates, key='netReturnPct') {
  const valid=rows.filter(x => !['INSUFFICIENT_FUTURE','BAD_LEVELS'].includes(x.status));
  const filled=valid.filter(x=>x.filled);
  const nets=filled.map(x=>Number(x[key])).filter(Number.isFinite);
  const pos=nets.filter(x=>x>0), neg=nets.filter(x=>x<0);
  const byDate=new Map(dates.map(d=>[d,[]]));
  for (const row of valid) {
    if (!byDate.has(row.signalDate)) byDate.set(row.signalDate,[]);
    byDate.get(row.signalDate).push(Number.isFinite(Number(row[key])) ? Number(row[key]) : 0);
  }
  const sessionReturns=[...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([,xs])=>xs.length?mean(xs):0);
  let eq=1; for(const r of sessionReturns) eq*=1+r/100;
  return {
    signals:valid.length, filled:filled.length,
    targetHitPct:round(filled.length ? filled.filter(x=>x.status==='TARGET_HIT').length/filled.length*100 : 0,1),
    stopHitPct:round(filled.length ? filled.filter(x=>x.status.startsWith('STOP')).length/filled.length*100 : 0,1),
    positiveTradeRatePct:round(filled.length ? pos.length/filled.length*100 : 0,1),
    averageNetPct:round(mean(nets)), medianNetPct:round(median(nets)),
    profitFactor:round(neg.length ? pos.reduce((a,b)=>a+b,0)/Math.abs(neg.reduce((a,b)=>a+b,0)) : pos.length ? 999 : 0,2),
    sessions:sessionReturns.length, avgBasketNetPct:round(mean(sessionReturns)), compoundedBasketPct:round((eq-1)*100), maxDrawdownPct:round(maxDrawdown(sessionReturns))
  };
}

function delta(a,b) {
  return {
    averageNetPct:round(a.averageNetPct-b.averageNetPct),
    targetHitPct:round(a.targetHitPct-b.targetHitPct,1),
    stopHitPct:round(a.stopHitPct-b.stopHitPct,1),
    positiveTradeRatePct:round(a.positiveTradeRatePct-b.positiveTradeRatePct,1),
    profitFactor:round(a.profitFactor-b.profitFactor,2),
    avgBasketNetPct:round(a.avgBasketNetPct-b.avgBasketNetPct),
    maxDrawdownPct:round(a.maxDrawdownPct-b.maxDrawdownPct)
  };
}

const files=fs.readdirSync(historyDir).filter(x=>x.endsWith('.json')).sort();
const documents=files.map(file=>readJson(path.join(historyDir,file))).map((doc,i)=>({ ...doc, ticker:String(doc.ticker || files[i].replace(/\.json$/i,'')).toUpperCase() }));
const rawByTicker=new Map(documents.map(doc=>[String(doc.ticker).toUpperCase(),rawBars(doc)]));
const v16=readJson(v16AuditPath);
const sessions=(v16.sessions || []).slice().sort((a,b)=>a.signalDate.localeCompare(b.signalDate));
const allDates=sessions.map(x=>x.signalDate);
const split=Math.floor(allDates.length*2/3);
const developmentDates=allDates.slice(0,split);
const diagnosticDates=allDates.slice(split);
const standaloneRows=[];
const joinedRows=[];
const coverageRows=[];

for (const session of sessions) {
  const snapshot=buildRawPullbackSnapshot(documents,session.signalDate);
  const scoreByTicker=new Map(snapshot.ranked.map(x=>[x.ticker,x]));
  coverageRows.push({ signalDate:session.signalDate, featureReady:snapshot.universe.featureReady, eligible:snapshot.universe.eligible, top3:snapshot.top3.length });

  for (const pick of snapshot.top3) {
    const raw=rawByTicker.get(pick.ticker) || [];
    standaloneRows.push({ signalDate:session.signalDate,ticker:pick.ticker,rawScore:pick.signalScore,...evaluateStandalone(raw,session.signalDate) });
  }

  for (const member of session.members || []) {
    const ticker=String(member.ticker).toUpperCase();
    const expert=scoreByTicker.get(ticker) || null;
    const raw=rawByTicker.get(ticker) || [];
    joinedRows.push({
      signalDate:session.signalDate,ticker,
      expertAvailable:Boolean(expert),rawScore:expert?.signalScore ?? null,
      rawConfirmed:Boolean(expert && expert.signalScore >= CONFIRM_SCORE),
      ...evaluateV16(member,raw,session.signalDate)
    });
  }
}

function subset(rows, dates){const set=new Set(dates);return rows.filter(x=>set.has(x.signalDate));}
function confirmationReport(dates) {
  const rows=subset(joinedRows,dates);
  const available=rows.filter(x=>x.expertAvailable);
  const confirmed=available.filter(x=>x.rawConfirmed);
  const rejected=available.filter(x=>!x.rawConfirmed);
  const baseline=summarize(available,dates), filtered=summarize(confirmed,dates), rejectedSummary=summarize(rejected,dates);
  return { coverage:{rows:rows.length,expertAvailable:available.length,confirmed:confirmed.length,rejected:rejected.length,unavailable:rows.length-available.length}, baseline, filtered, rejected:rejectedSummary, deltaFilteredMinusBaseline:delta(filtered,baseline) };
}

const development=confirmationReport(developmentDates);
const diagnostic=confirmationReport(diagnosticDates);
const standaloneDevelopment=summarize(subset(standaloneRows,developmentDates),developmentDates);
const standaloneDiagnostic=summarize(subset(standaloneRows,diagnosticDates),diagnosticDates);

const folds=[];
for(let i=0;i<3;i++){
  const start=Math.floor(i*allDates.length/3),end=i===2?allDates.length:Math.floor((i+1)*allDates.length/3),dates=allDates.slice(start,end),r=confirmationReport(dates),d=r.deltaFilteredMinusBaseline;
  folds.push({ fold:i+1,from:dates[0]||null,to:dates.at(-1)||null,...r,positiveDirection:r.filtered.filled>=8&&d.averageNetPct>0&&d.stopHitPct<=0&&d.avgBasketNetPct>=0 });
}

const d=diagnostic.deltaFilteredMinusBaseline;
const checks={
  diagnosticSessionsAtLeast12:diagnosticDates.length>=12,
  standaloneDiagnosticFilledAtLeast24:standaloneDiagnostic.filled>=24,
  standaloneDiagnosticPositiveAverage:standaloneDiagnostic.avgBasketNetPct>0,
  standaloneDiagnosticProfitFactorAtLeast110:standaloneDiagnostic.profitFactor>=1.10,
  standaloneDiagnosticDrawdownAboveMinus15:standaloneDiagnostic.maxDrawdownPct>=-15,
  confirmedDiagnosticFilledAtLeast12:diagnostic.filtered.filled>=12,
  confirmationAverageNetImprovesAtLeast025pp:d.averageNetPct>=0.25,
  confirmationStopNotWorse:d.stopHitPct<=0,
  confirmationProfitFactorNotWorse:diagnostic.filtered.profitFactor>=diagnostic.baseline.profitFactor,
  confirmationDrawdownNotWorse:diagnostic.filtered.maxDrawdownPct>=diagnostic.baseline.maxDrawdownPct,
  positiveDirectionAtLeast2Of3Folds:folds.filter(x=>x.positiveDirection).length>=2
};
const passesInternalResearchGate=Object.values(checks).every(Boolean);

const report={
  schemaVersion:'raw-trend-pullback-recovery-v1-audit',generatedAt:new Date().toISOString(),
  evidenceClass:'POSTHOC_RESEARCH_PROGRAM_RETROSPECTIVE_POINT_IN_TIME',
  lineage:{independentGeneration:true,readsLegacySelectionsForGeneration:false,readsLegacyScoresForGeneration:false,sourceInputs:'data/history adjusted OHLCV through signal date only'},
  governance:{
    policyFrozenBeforeThisExpertsFirstOutcomeRun:true,
    historicalWindowAlreadyObservedByResearchProgram:true,
    finalHoldoutStatus:'NOT_UNTOUCHED_DO_NOT_PROMOTE_FROM_THIS_AUDIT',
    allowedDecision:'REJECT_OR_FORWARD_SHADOW_CANDIDATE_ONLY'
  },
  frozenPolicy:{
    minimumHistory:90,trend:'EMA20>EMA50 AND EMA50 rising over 10 sessions',pullback:'2% to 12% below adjusted 20-session high',
    recovery:'signal close > prior close AND close location within signal bar >=60%',liquidity:'>=15 nonzero-volume days of 20',
    score:'equal-weight cross-sectional percentile of EMA50 trend slope, recovery from 5-session low, close location, liquidity',confirmationScoreAtLeast:CONFIRM_SCORE,
    standaloneSelection:'top3',standaloneExecution:'next-session open to third-session close',metaComparisonExecution:'exact V16 entry zone/stop/target; next-session zone touch; three sessions; STOP_FIRST',roundTripCostPct:COST_PCT,
    policyTunedOnOutcomes:false
  },
  split:{method:'oldest two-thirds development, newest one-third diagnostic only; newest third is NOT an untouched holdout because the research program has already observed this period',developmentFrom:developmentDates[0]||null,developmentTo:developmentDates.at(-1)||null,diagnosticFrom:diagnosticDates[0]||null,diagnosticTo:diagnosticDates.at(-1)||null},
  universe:{documents:documents.length},coverage:coverageRows,
  standalone:{development:standaloneDevelopment,diagnostic:standaloneDiagnostic},
  confirmation:{development,diagnostic,folds},
  internalResearchChecks:checks,passesInternalResearchGate,
  disposition:passesInternalResearchGate?'CANDIDATE_FOR_FRESH_FORWARD_SHADOW_ONLY':'REJECT_ALPHA_WEIGHT_ZERO',
  promotion:{eligible:false,reason:passesInternalResearchGate?'Internal retrospective stability gate passed, but this period is already observed; only fresh forward shadow may validate it.':'Fixed-policy retrospective stability gate failed; reject V1 and do not tune thresholds on these outcomes.'}
};
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));