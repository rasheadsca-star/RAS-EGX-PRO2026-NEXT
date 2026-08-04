#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const HISTORY_DIR = path.join(ROOT, 'data/history');
const PRICE_TRUTH_FILE = path.join(ROOT, 'data/stable/v15-price-truth.json');
const OUT_FILE = path.join(ROOT, 'data/research/v16-composite-formula-audit.json');

const n = (v, f = null) => Number.isFinite(Number(v)) ? Number(v) : f;
const round = (v, d = 2) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mean = xs => { const a = xs.filter(Number.isFinite); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
const median = xs => { const a = xs.filter(Number.isFinite).sort((a,b)=>a-b); if (!a.length) return null; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
const pct = (v, b) => b > 0 ? (v / b - 1) * 100 : null;
const dateOnly = v => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
const readJson = (file, fallback={}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };

function normalize(file) {
  const doc = readJson(file, {});
  const ticker = String(doc.ticker || path.basename(file, '.json')).toUpperCase();
  const src = Array.isArray(doc.sessions) ? doc.sessions : Array.isArray(doc) ? doc : [];
  const rows = src.map(r => ({date:dateOnly(r.date||r.sessionDate),open:n(r.open),high:n(r.high),low:n(r.low),close:n(r.close),volume:n(r.volume,0)}))
    .filter(r => r.date && r.open>0 && r.high>0 && r.low>0 && r.close>0 && r.high>=Math.max(r.open,r.close) && r.low<=Math.min(r.open,r.close))
    .sort((a,b)=>a.date.localeCompare(b.date));
  return {ticker, companyNameAr:doc.companyNameAr||doc.companyNameEn||ticker, verified:doc.symbolVerified!==false, stale:doc.staleData===true, rows};
}
function sma(rows, i, len, key='close') { if (i-len+1<0) return null; return mean(rows.slice(i-len+1,i+1).map(r=>n(r[key])).filter(Number.isFinite)); }
function atr(rows, i, len=14) { if (i-len+1<1) return null; const out=[]; for(let k=i-len+1;k<=i;k++){const p=rows[k-1].close; out.push(Math.max(rows[k].high-rows[k].low,Math.abs(rows[k].high-p),Math.abs(rows[k].low-p)));} return mean(out); }
function rsi(rows, i, len=14) { if (i-len<0) return null; let g=0,l=0; for(let k=i-len+1;k<=i;k++){const c=rows[k].close-rows[k-1].close; if(c>=0)g+=c; else l-=c;} const ag=g/len, al=l/len; return al===0?100:100-100/(1+ag/al); }
function feature(h, i) {
  if (i<55) return null;
  const rows=h.rows,row=rows[i],close=row.close;
  const s10=sma(rows,i,10),s20=sma(rows,i,20),s50=sma(rows,i,50),a14=atr(rows,i),r14=rsi(rows,i);
  const av=sma(rows,i-1,20,'volume'),vr=av>0?row.volume/av:null,turnover=mean(rows.slice(i-19,i+1).map(x=>x.close*x.volume));
  const prior20=rows.slice(i-20,i),high20=Math.max(...prior20.map(x=>x.high)),low20=Math.min(...prior20.map(x=>x.low));
  const ret1=pct(close,rows[i-1]?.close),ret3=pct(close,rows[i-3]?.close),ret5=pct(close,rows[i-5]?.close),ret10=pct(close,rows[i-10]?.close),ret20=pct(close,rows[i-20]?.close);
  const atrPct=a14>0?a14/close*100:null,rangePos=high20>low20?(close-low20)/(high20-low20):.5;
  if(![s10,s20,s50,a14,r14,vr,turnover,ret1,ret3,ret5,ret10,ret20,atrPct].every(Number.isFinite))return null;
  if(atrPct<.4||atrPct>14||Math.abs(ret1)>30)return null;
  return {ticker:h.ticker,companyNameAr:h.companyNameAr,date:row.date,open:row.open,close,s10,s20,s50,a14,r14,vr,turnover,ret1,ret3,ret5,ret10,ret20,rangePos,breakoutPct:pct(close,high20),trend:close>s20&&s20>s50};
}

const MODELS = [
  ['BREAKOUT_CONTINUATION',f=>f.trend&&f.breakoutPct>=-.5&&f.vr>=1.05&&f.ret5>=1&&f.ret20>=4&&f.rs20>=1&&f.r14>=52&&f.r14<=80],
  ['MOMENTUM_ACCELERATION',f=>f.close>f.s10&&f.s10>f.s20&&f.s20>f.s50&&f.ret3>.8&&f.ret10>3&&f.ret20>5&&f.rs20>2&&f.vr>=.8&&f.r14>=50&&f.r14<=78],
  ['TREND_RESUMPTION',f=>f.trend&&f.close>f.s10&&f.ret1>0&&f.ret5>-1&&f.ret20>5&&f.rs20>1&&f.vr>=.7&&f.rangePos>=.55&&f.r14>=48&&f.r14<=72],
  ['LIQUID_LEADERS',f=>f.trend&&f.ret5>0&&f.ret20>3&&f.rs20>2&&f.vr>=.75&&f.turnover>=5e6&&f.r14>=50&&f.r14<=76],
  ['HOT_MOMENTUM',f=>f.ret5>=8&&f.ret20>=12&&f.rs20>=7&&f.vr>=.8&&f.r14>=76&&f.r14<=90&&f.turnover>=1e6],
  ['PRE_BREAKOUT_ACCUMULATION',f=>f.trend&&f.ret5>=1&&f.ret20>=0&&f.rs20>=-3&&f.vr>=1.2&&f.rangePos>=.55&&f.breakoutPct>=-7&&f.breakoutPct<=2&&f.r14>=50&&f.r14<=74],
  ['REVERSAL_CONFIRMATION',f=>!f.trend&&f.ret1>=1.5&&f.ret3>0&&f.ret5<=8&&f.r14>=28&&f.r14<=58&&f.vr>=1.2&&f.close>f.open&&f.close>f.s10],
];

function normLiquidity(turnover){ return clamp(Math.log10(Math.max(turnover,1e6)/1e6)/2); }
function normBreakout(b){ return clamp(1-Math.abs(clamp(b,-12,8))/10); }
function normRsiQuality(r,center=60,width=25){ return clamp(1-Math.abs(r-center)/width); }
function formula(f){
  const matches=MODELS.filter(([,fn])=>fn(f)).map(([id])=>id);
  const executableCount=matches.filter(id=>id!=='HOT_MOMENTUM').length;
  const C=clamp(executableCount/3);
  const V=clamp((Math.log10(Math.max(f.vr,.1))+1)/1.6);
  const T=f.trend?1:0;
  const B=normBreakout(f.breakoutPct);
  const RS=clamp((f.rs20+5)/30);
  const M=mean([clamp((f.ret3+2)/12),clamp((f.ret5+2)/18)]);
  const trendScore=30*C+20*V+15*T+15*B+10*RS+10*M;

  const Vs=clamp(Math.log10(Math.max(f.vr,1))/Math.log10(5));
  const R3=clamp((f.ret3+2)/12);
  const L=normLiquidity(f.turnover);
  const Q=normRsiQuality(f.r14,58,24);
  const volumeScore=40*Vs+20*R3+15*B+15*L+10*Q;

  const RV=clamp(Math.log10(Math.max(f.vr,1))/Math.log10(4));
  const O=normRsiQuality(f.r14,45,18);
  const RR3=clamp((f.ret3+1)/9);
  const RB=clamp((f.breakoutPct+12)/14);
  const reversalScore=30*RV+25*O+20*RR3+15*RB+10*L;

  let penalty=0; const penalties=[];
  if(f.r14>82){penalty+=20;penalties.push('RSI_ABOVE_82');}
  if(f.ret20>80){penalty+=15;penalties.push('RETURN20_ABOVE_80');}
  if(f.vr<.7){penalty+=10;penalties.push('VOLUME_BELOW_0_7');}
  if(f.ret1>5){penalty+=15;penalties.push('PRIOR_DAY_MOVE_ABOVE_5');}
  const raw=Math.max(trendScore,volumeScore,reversalScore);
  const dominant=raw===trendScore?'TREND':raw===volumeScore?'VOLUME_SHOCK':'REVERSAL';
  return {score:round(Math.max(0,raw-penalty),2),rawScore:round(raw,2),penalty,dominantPath:dominant,trendScore:round(trendScore,2),volumeScore:round(volumeScore,2),reversalScore:round(reversalScore,2),matchedModels:matches,executableModelCount:executableCount,penalties};
}

function main(){
  const truth=readJson(PRICE_TRUTH_FILE,{});
  if(truth.ready!==true||truth.executionGrade!==true)throw new Error('Price truth is not execution-grade');
  const currentSession=truth.expectedSession;
  const histories=fs.readdirSync(HISTORY_DIR).filter(x=>x.endsWith('.json')).map(x=>normalize(path.join(HISTORY_DIR,x))).filter(h=>h.verified&&!h.stale&&h.rows.length>=56);
  const priorDates=[]; for(const h of histories){const i=h.rows.findIndex(r=>r.date===currentSession);if(i>0)priorDates.push(h.rows[i-1].date);} const priorSession=priorDates.sort().at(-1);
  const prior=[]; for(const h of histories){const i=h.rows.findIndex(r=>r.date===priorSession);const f=i>=55?feature(h,i):null;if(f)prior.push(f);} const marketRet20=median(prior.map(f=>f.ret20)); prior.forEach(f=>f.rs20=f.ret20-marketRet20);
  const byTicker=new Map(prior.map(f=>[f.ticker,f]));
  const ranked=prior.map(f=>({...f,...formula(f)})).sort((a,b)=>b.score-a.score);
  const actual=[]; for(const h of histories){const ci=h.rows.findIndex(r=>r.date===currentSession),pi=h.rows.findIndex(r=>r.date===priorSession);if(ci<0||pi<0)continue;const ret=pct(h.rows[ci].close,h.rows[pi].close);if(Number.isFinite(ret)&&byTicker.has(h.ticker))actual.push({ticker:h.ticker,companyNameAr:h.companyNameAr,dailyReturnPct:round(ret,2),formula:formula(byTicker.get(h.ticker))});}
  actual.sort((a,b)=>b.dailyReturnPct-a.dailyReturnPct);
  const actualTop10=actual.slice(0,10).map((x,i)=>({rank:i+1,...x}));
  const formulaTop10=ranked.slice(0,10).map((x,i)=>({rank:i+1,ticker:x.ticker,companyNameAr:x.companyNameAr,score:x.score,dominantPath:x.dominantPath,matchedModels:x.matchedModels}));
  const actualSet=new Set(actualTop10.map(x=>x.ticker));
  const overlap=formulaTop10.filter(x=>actualSet.has(x.ticker));
  const thresholds=[55,65,75].map(threshold=>{const selected=ranked.filter(x=>x.score>=threshold);const captured=actualTop10.filter(x=>byTicker.has(x.ticker)&&formula(byTicker.get(x.ticker)).score>=threshold);return{threshold,selectedUniverseCount:selected.length,capturedTop10Count:captured.length,capturedTop10Tickers:captured.map(x=>x.ticker),capturePct:captured.length*10};});
  const out={schemaVersion:'16.3.7',generatedAt:new Date().toISOString(),currentSession,priorSession,methodology:{formula:'MAX(TREND,VOLUME_SHOCK,REVERSAL)-RISK_PENALTIES',rankingMetric:'score descending',top10Metric:'close-to-close daily return',noLookahead:true,executionGrade:true},summary:{eligibleUniverseCount:ranked.length,precisionAt10Count:overlap.length,precisionAt10Pct:overlap.length*10,precisionAt10Tickers:overlap.map(x=>x.ticker)},thresholds,formulaTop10,actualTop10};
  writeJson(OUT_FILE,out); console.log(out);
}
main();
