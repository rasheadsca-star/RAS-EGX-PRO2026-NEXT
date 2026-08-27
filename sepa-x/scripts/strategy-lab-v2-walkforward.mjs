import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const src=path.join(root,'data','research','strategy-lab-v2-historical.json');
const out=path.join(root,'data','research','strategy-lab-v2-walkforward.json');
const data=JSON.parse(fs.readFileSync(src,'utf8'));
if(!String(data.schemaVersion||'').endsWith('.2'))throw new Error('ENRICHED_STRATEGY_LAB_V2_EVIDENCE_REQUIRED');
const finite=v=>Number.isFinite(Number(v));
const round=(v,d=3)=>finite(v)?Number(Number(v).toFixed(d)):null;
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const wilson=(k,n,z=1.96)=>{if(!n)return null;const p=k/n,z2=z*z,den=1+z2/n;return Math.max(0,(p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/den)*100;};
function deoverlap(rows){const x=[...rows].sort((a,b)=>String(a.signalDate).localeCompare(String(b.signalDate))||String(a.symbol).localeCompare(String(b.symbol))),active=new Map(),out=[];for(const t of x){const u=active.get(t.symbol);if(u&&String(t.signalDate)<=String(u))continue;out.push(t);active.set(t.symbol,t.exitDate||t.signalDate);}return out;}
function summary(rows){const e=deoverlap(rows.filter(x=>x.entered===true)),hits=e.filter(x=>x.targetHit),stops=e.filter(x=>x.stopHit&&!x.targetHit),wins=e.filter(x=>Number(x.netPct)>0),loss=e.filter(x=>Number(x.netPct)<0),gp=wins.reduce((s,x)=>s+Number(x.netPct),0),gl=Math.abs(loss.reduce((s,x)=>s+Number(x.netPct),0));return {entered:e.length,uniqueSymbols:new Set(e.map(x=>x.symbol)).size,hitPct:e.length?round(hits.length/e.length*100,1):null,wilson95LowerHitPct:e.length?round(wilson(hits.length,e.length),1):null,stopBeforeTargetPct:e.length?round(stops.length/e.length*100,1):null,positivePct:e.length?round(wins.length/e.length*100,1):null,expectancyR:round(avg(e.map(x=>Number(x.netR)).filter(Number.isFinite)),3),profitFactor:gl?round(gp/gl,3):(gp>0?'INF':null)};}
const num=(x,k)=>Number(x?.[k]);
const rules=[
  {id:'BASE',description:'all RETEST_RECLAIM_V2 trades',test:x=>true},
  {id:'BREAKOUT_VOLUME_1_5',description:'breakout volume ratio >= 1.50',test:x=>num(x,'breakoutVolumeRatio')>=1.5},
  {id:'DRY_RETEST_070',description:'retest volume <= 70% of breakout volume',test:x=>num(x,'retestVolumeVsBreakout')<=.70},
  {id:'SHALLOW_RETEST_045',description:'retest depth <= 0.45 ATR',test:x=>num(x,'retestDepthAtr')<=.45},
  {id:'RECLAIM_VOLUME_100',description:'reclaim volume ratio >= 1.00',test:x=>num(x,'reclaimVolumeRatio')>=1.0},
  {id:'MULTI_TOUCH_3',description:'resistance had at least 3 touches',test:x=>num(x,'touches')>=3},
  {id:'RISK_3_TO_7',description:'planned risk between 3% and 7%',test:x=>num(x,'riskPct')>=3&&num(x,'riskPct')<=7},
  {id:'CLEAN_RETEST',description:'breakout>=1.40x, retest volume<=0.75x breakout, depth<=0.45 ATR',test:x=>num(x,'breakoutVolumeRatio')>=1.4&&num(x,'retestVolumeVsBreakout')<=.75&&num(x,'retestDepthAtr')<=.45},
  {id:'CLEAN_RECLAIM',description:'CLEAN_RETEST plus reclaim volume>=0.95x',test:x=>num(x,'breakoutVolumeRatio')>=1.4&&num(x,'retestVolumeVsBreakout')<=.75&&num(x,'retestDepthAtr')<=.45&&num(x,'reclaimVolumeRatio')>=.95},
  {id:'FULL_STRUCTURE',description:'CLEAN_RECLAIM + touches>=3 + risk 3%-7%',test:x=>num(x,'breakoutVolumeRatio')>=1.4&&num(x,'retestVolumeVsBreakout')<=.75&&num(x,'retestDepthAtr')<=.45&&num(x,'reclaimVolumeRatio')>=.95&&num(x,'touches')>=3&&num(x,'riskPct')>=3&&num(x,'riskPct')<=7},
  {id:'BULL_MARKET',description:'benchmark regime BULL at signal time',test:x=>x.marketRegime==='BULL'},
  {id:'FULL_STRUCTURE_BULL',description:'FULL_STRUCTURE plus benchmark regime BULL',test:x=>x.marketRegime==='BULL'&&num(x,'breakoutVolumeRatio')>=1.4&&num(x,'retestVolumeVsBreakout')<=.75&&num(x,'retestDepthAtr')<=.45&&num(x,'reclaimVolumeRatio')>=.95&&num(x,'touches')>=3&&num(x,'riskPct')>=3&&num(x,'riskPct')<=7},
];
const all=(data.trades?.retestReclaimV2||[]).filter(x=>x.entered===true);
const periods={discovery:x=>x.signalDate<='2022-12-31',validation:x=>x.signalDate>='2023-01-01'&&x.signalDate<='2024-12-31',holdout:x=>x.signalDate>='2025-01-01'};
const reports={};
for(const r of rules){const rows=all.filter(r.test),p={};for(const [name,fn] of Object.entries(periods))p[name]=summary(rows.filter(fn));p.overall=summary(rows);reports[r.id]={description:r.description,...p};}
const discoveryCandidates=rules.map(r=>({id:r.id,s:reports[r.id].discovery})).filter(x=>x.s.entered>=20&&finite(x.s.hitPct)&&finite(x.s.expectancyR));
const objective=s=>Number(s.hitPct)+Number(s.wilson95LowerHitPct)*.25+Math.max(-1,Math.min(1,Number(s.expectancyR)))*10-Number(s.stopBeforeTargetPct)*.15;
discoveryCandidates.sort((a,b)=>objective(b.s)-objective(a.s)||b.s.entered-a.s.entered||a.id.localeCompare(b.id));
const leaderId=discoveryCandidates[0]?.id??'BASE',leader=reports[leaderId];
const criteria={minimumDiscoveryTrades:20,minimumDiscoveryHitPct:65,minimumDiscoveryExpectancyR:.10,minimumValidationTrades:15,minimumValidationHitPct:60,minimumValidationExpectancyR:0,minimumHoldoutTrades:20,minimumHoldoutHitPct:60,minimumHoldoutExpectancyR:0,minimumOverallTrades:50,minimumOverallHitPct:65,minimumOverallWilson95LowerHitPct:55,minimumOverallProfitFactor:1.5};
const pfOk=v=>v==='INF'||finite(v)&&Number(v)>=criteria.minimumOverallProfitFactor;
const checks={discoverySize:leader.discovery.entered>=criteria.minimumDiscoveryTrades,discoveryHit:finite(leader.discovery.hitPct)&&leader.discovery.hitPct>=criteria.minimumDiscoveryHitPct,discoveryExpectancy:finite(leader.discovery.expectancyR)&&leader.discovery.expectancyR>=criteria.minimumDiscoveryExpectancyR,validationSize:leader.validation.entered>=criteria.minimumValidationTrades,validationHit:finite(leader.validation.hitPct)&&leader.validation.hitPct>=criteria.minimumValidationHitPct,validationExpectancy:finite(leader.validation.expectancyR)&&leader.validation.expectancyR>=criteria.minimumValidationExpectancyR,holdoutSize:leader.holdout.entered>=criteria.minimumHoldoutTrades,holdoutHit:finite(leader.holdout.hitPct)&&leader.holdout.hitPct>=criteria.minimumHoldoutHitPct,holdoutExpectancy:finite(leader.holdout.expectancyR)&&leader.holdout.expectancyR>=criteria.minimumHoldoutExpectancyR,overallSize:leader.overall.entered>=criteria.minimumOverallTrades,overallHit:finite(leader.overall.hitPct)&&leader.overall.hitPct>=criteria.minimumOverallHitPct,overallWilson:finite(leader.overall.wilson95LowerHitPct)&&leader.overall.wilson95LowerHitPct>=criteria.minimumOverallWilson95LowerHitPct,overallProfitFactor:pfOk(leader.overall.profitFactor)};
const allPass=Object.values(checks).every(Boolean);
const report={schemaVersion:'sepa-x-strategy-lab-v2-walkforward.1',generatedAt:new Date().toISOString(),researchOnly:true,promotionAllowed:false,automaticEligibilityImpact:'NONE',preregistration:{ruleFamilyFixedBeforeEnrichedMechanicalFeatureRun:true,periods:{discovery:'2018-2022',validation:'2023-2024',holdout:'2025-2026'},leaderSelection:'choose highest predefined discovery objective among rules with >=20 discovery trades; do not use validation or holdout to choose leader',objective:'hitPct + 0.25*WilsonLower + 10*clampedExpectancyR - 0.15*stopPct'},sourceEvidence:{schemaVersion:data.schemaVersion,generatedAt:data.generatedAt}},rules:reports,discoveryLeader:{id:leaderId,metrics:leader},promotionGate:{criteria,checks,state:allPass?'READY_FOR_MANUAL_PROMOTION_REVIEW':'CHALLENGER_REJECTED_OR_INSUFFICIENT',manualPromotionRequired:true}};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({leader:report.discoveryLeader,promotionGate:report.promotionGate},null,2));
