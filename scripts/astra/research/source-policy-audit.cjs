'use strict';
// Evidence gate for the pinned one-session source policy. Daily OHLC is not
// sufficient to confirm its 10–15-minute liquidity condition or an executable fill.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const POLICY=Object.freeze({id:'V169_SOURCE_ONE_SESSION_EVIDENCE_1',
  sourceCommit:'2351b2ec2bbcf3e36e992021e26b36845e879ab0',holdingSessions:1,
  cancelAboveEntryHigh:true,cancelBelowStop:true,requiresMorningLiquidityEvidence:true,
  certifiedUnfilledWeightPolicy:'KEEP_CASH',assumedRoundTripCostPct:0.6});
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
function assess(signal,rows,calendar){
 const out=(state,reason,session=null)=>({ticker:signal.ticker,signalDate:signal.signalDate,
   recordedHoldingSessions:signal.holdingSessions,state,reason,session,realizedNetPct:null,
   executionConfirmed:false,policyId:POLICY.id});
 if(signal.holdingSessions!==1)return out('POLICY_VERSION_MISMATCH','Saved recommendation is not the pinned one-session policy');
 const plan=[signal.entryLow,signal.entryHigh,signal.stopLoss,signal.target1];
 if(!datePattern.test(signal.signalDate)||!plan.every(x=>Number.isFinite(x)&&x>0)||
    signal.entryLow>signal.entryHigh||signal.stopLoss>=signal.entryLow||signal.target1<=signal.entryHigh)
   return out('INVALID_PLAN','Invalid dates or price levels');
 const sessions=[...new Set(calendar.filter(x=>datePattern.test(x)))].sort();
 const session=sessions.find(d=>d>signal.signalDate);
 if(!session)return out('WAITING_FOR_SESSION','No next session in supplied calendar');
 // Do not assume the next available bar for an illiquid ticker is the next market session.
 const matches=rows.filter(r=>String(r.date||r.sessionDate).slice(0,10)===session);
 if(matches.length!==1)return out('SESSION_DATA_UNVERIFIED','Next market session missing or duplicated',session);
 const bar=matches[0],values=[bar.open,bar.high,bar.low,bar.close];
 if(!values.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||
    bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high))
   return out('SESSION_DATA_UNVERIFIED','Invalid OHLC',session);
 const warnings=[...(bar.warnings||[]),bar.validationStatus||''].join(' ');
 if(/invalid|conflict|failed|unresolved|quarantined|corporate.?action|split|reconstruct|synthetic/i.test(warnings))
   return out('SESSION_DATA_UNVERIFIED','Unresolved or reconstructed session evidence',session);
 const publication=Date.parse(signal.publishedAt);
 if(!Number.isFinite(publication))return out('PUBLICATION_TIME_UNVERIFIED','Missing valid publication timestamp',session);
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(publication));
 const fields=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 const publishedDate=fields.year+'-'+fields.month+'-'+fields.day;
 if(publishedDate>=session)return out('PUBLICATION_TIME_UNVERIFIED','Same-day publication requires exact ordering against session events',session);
 if(bar.open>signal.entryHigh)return out('CANCELLED_AT_OPEN','Opening price above allowed entry range',session);
 if(bar.open<signal.stopLoss)return out('CANCELLED_AT_OPEN','Opening price below stop',session);
 if(bar.high<signal.entryLow)return out('NO_ENTRY_TOUCH','Entry range never reached in first session',session);
 return out('INTRADAY_EVIDENCE_REQUIRED','Daily bars cannot prove morning liquidity, fill time and one-session exit',session);
}
function audit(root){
 const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
 const sourcePath='data/stable/v16-v169-live-evaluation.json';
 const source=read(sourcePath),calendar=read('data/session-calendar.json').sessions;
 const sessions=source.sessions.filter(s=>s.status==='RESOLVED');
 const episodes=sessions.flatMap(s=>s.members.map(m=>assess({...m,signalDate:s.signalDate,publishedAt:s.publishedAt},
   read('data/history/'+m.ticker+'.json').sessions,calendar)));
 const counts={};for(const e of episodes)counts[e.state]=(counts[e.state]||0)+1;
 return {schemaVersion:'source-policy-evidence-audit-1',policy:POLICY,
   inputSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,sourcePath))).digest('hex'),
   calendarSha256:crypto.createHash('sha256').update(JSON.stringify(calendar)).digest('hex'),
   issued:episodes.length,counts,executionConfirmed:0,certifiedAverageNetPct:null,
   limitations:['Input calendar is the stored market calendar; it is not newly exchange-certified',
     'One-session policy is screened separately from historical five-session recommendations',
     'Cancellation states describe the rule applied to recorded data, not broker orders',
     'No price return or intraday liquidity is inferred from daily range touches',
     'No independent holdout has been certified; all inspected dates are diagnostic data'],episodes};
}
if(require.main===module){
 const root=path.resolve(__dirname,'../../..'),report=audit(root);
 fs.writeFileSync(path.join(root,'docs/astra/SOURCE_POLICY_AUDIT_2026-09-29.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({issued:report.issued,counts:report.counts,executionConfirmed:0,certifiedAverageNetPct:null},null,2));
}
module.exports={POLICY,assess,audit};
