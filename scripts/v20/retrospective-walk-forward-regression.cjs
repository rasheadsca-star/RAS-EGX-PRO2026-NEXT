#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const file=path.join(root,'data/v20/retrospective-walk-forward-target-stop.json');
const x=JSON.parse(fs.readFileSync(file,'utf8'));
const checks={};
const check=(cond,code)=>{checks[code]=Boolean(cond);if(!cond)throw new Error(code)};
const finite=v=>Number.isFinite(Number(v));
check(x.schemaVersion==='20.0.0-retrospective-point-in-time-target-stop-1','SCHEMA');
check(x.engineId==='V20_FULL_MARKET_NATIVE_SELECTION_V1','ENGINE');
check(x.rankingContract==='V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2','RANKING_CONTRACT');
check(x.evidenceClass==='RETROSPECTIVE_POINT_IN_TIME_RECONSTRUCTION','EVIDENCE_CLASS');
check(x.retrospective===true&&x.freshIndependentForward===false,'NOT_FRESH_FORWARD');
check(x.changesRanking===false&&x.changesExecutionPermission===false&&x.changesProductionAllocation===false&&x.changesProfessionalReadiness===false,'NO_PRODUCTION_MUTATION');
check(x.usedForCalibrationClaim===false&&x.productionPromotionEligible===false,'NO_CALIBRATION_OR_PROMOTION');
check(x.fidelity?.historicalDataCutAtSignalDate===true&&Number(x.fidelity?.futureFeatureRowsUsed)===0,'NO_LOOKAHEAD_CONTRACT');
check(x.fidelity?.frozenV20WeightsUsed===true&&x.fidelity?.frozenV20RankingContractUsed===true,'FROZEN_METHOD');
check(Number(x.auditWindow?.requestedSessions)>=15,'WINDOW_TOO_SMALL');
check(Number(x.auditWindow?.completedSessions)>=10,'COMPLETED_SESSIONS_TOO_SMALL');
const s=x.summary||{},sel=Number(s.selectionCount||0),exe=Number(s.executableByOpenRuleCount||0),noe=Number(s.notExecutableByOpenRuleCount||0),tar=Number(s.conservativeTargetHitCount||0),raw=Number(s.rawTargetTouchCount||0),stp=Number(s.stopTouchedCount||0),amb=Number(s.ambiguousTargetAndStopSameDayCount||0);
check(sel>0&&exe>0,'EMPTY_SAMPLE');
check(exe+noe===sel,'EXECUTABLE_ACCOUNTING');
check(tar<=raw&&raw<=exe&&stp<=exe&&amb<=raw&&amb<=stp,'OUTCOME_ACCOUNTING');
for(const k of ['notExecutableByOpenRulePct','rawTargetTouchRateOfExecutablePct','conservativeTargetHitRateOfExecutablePct','stopTouchRateOfExecutablePct']){const v=s[k];check(v===null||(finite(v)&&Number(v)>=0&&Number(v)<=100),`RATE_${k}`)}
for(const session of x.sessions||[]){
  check(/^\d{4}-\d{2}-\d{2}$/.test(session.signalDate||'')&&/^\d{4}-\d{2}-\d{2}$/.test(session.outcomeDate||'')&&session.outcomeDate>session.signalDate,`DATE_${session.signalDate}`);
  check(Number(session.selectionCount||0)<=3,`TOP3_${session.signalDate}`);
  for(const m of session.members||[]){
    check(m.signalDate===session.signalDate&&m.outcomeDate===session.outcomeDate,`MEMBER_DATE_${session.signalDate}_${m.ticker}`);
    check(Number(m.reconstruction?.futureFeatureRowsUsed||0)===0,`MEMBER_NO_FUTURE_${session.signalDate}_${m.ticker}`);
    check(!m.reconstruction?.latestFeatureDate||m.reconstruction.latestFeatureDate<=session.signalDate,`MEMBER_FEATURE_CUTOFF_${session.signalDate}_${m.ticker}`);
    check(m.tradePlan?.entryHigh>0&&m.tradePlan?.stop>0&&m.tradePlan?.target1>m.tradePlan?.entryHigh,`PLAN_${session.signalDate}_${m.ticker}`);
  }
}
console.log(JSON.stringify({pass:true,checks,summary:s,fidelity:x.fidelity},null,2));
