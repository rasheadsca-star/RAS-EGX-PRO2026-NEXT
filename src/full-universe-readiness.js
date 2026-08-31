import { buildUniverseRegistry } from './universe.js';
import { evaluatePhase3Gate } from './phase3-gate.js';
import { sha256 } from './hash.js';
import { validateExchangeCalendar } from './session-authority.js';

export function runFullUniverseReadiness({universe,sessionAuthority,exchangeCalendar,barsByTicker={},flagsByTicker={},acquisitionPlans=[],minHistory=100,minMedianTurnover=0}={}){
  const structural=[];
  if(!universe||universe.state!=='READY') structural.push(`UNIVERSE:${universe?.state??'MISSING'}`);
  if(!sessionAuthority||sessionAuthority.state!=='READY'||!sessionAuthority.currentSession) structural.push(`SESSION_AUTHORITY:${sessionAuthority?.state??'MISSING'}`);
  try{validateExchangeCalendar(exchangeCalendar)}catch(e){structural.push(`EXCHANGE_CALENDAR:${e.message}`)}
  if(exchangeCalendar?.version&&sessionAuthority?.calendarVersion!==exchangeCalendar.version) structural.push(`CALENDAR_VERSION_MISMATCH:${sessionAuthority?.calendarVersion??'MISSING'}:${exchangeCalendar.version}`);
  if(exchangeCalendar?.sessions&&!exchangeCalendar.sessions.some(x=>x.session===sessionAuthority?.currentSession)) structural.push(`CURRENT_SESSION_NOT_IN_CALENDAR:${sessionAuthority?.currentSession??'MISSING'}`);
  const universeTickers=new Set((universe?.rows??[]).map(x=>x.ticker));
  const dataTickers=Object.keys(barsByTicker??{});
  const extras=dataTickers.filter(t=>!universeTickers.has(t)).sort();
  if(extras.length) structural.push(`DATA_OUTSIDE_UNIVERSE:${extras.join(',')}`);

  if(structural.length){
    const phase3=evaluatePhase3Gate({universe,registry:null,sessionAuthority,acquisitionPlans});
    return freeze({state:'FAIL',structuralBlockers:structural.sort(),registry:null,phase3,coverage:null,reportHash:null});
  }

  const allowedSessions=new Set(exchangeCalendar.sessions.filter(x=>x.session<=sessionAuthority.currentSession).map(x=>x.session));
  const symbols=universe.rows.map(member=>{
    const flags=flagsByTicker[member.ticker]??{};
    return {ticker:member.ticker,companyName:member.companyName??null,bars:barsByTicker[member.ticker]??[],sourceStatus:flags.sourceStatus??'UNKNOWN',conflict:flags.conflict===true,suspended:flags.suspended===true,corporateActionReview:flags.corporateActionReview===true};
  });
  const registry=buildUniverseRegistry(symbols,{latestSession:sessionAuthority.currentSession,minHistory,minMedianTurnover,allowedSessions});
  const phase3=evaluatePhase3Gate({universe,registry,sessionAuthority,acquisitionPlans});
  const covered=registry.rows.filter(r=>r.readiness!=='SOURCE_UNAVAILABLE').length;
  const coverage={universeTotal:universe.total,registryTotal:registry.total,withAnyBars:covered,missingBars:registry.total-covered,ready:registry.counts.READY??0,readinessCounts:registry.counts};
  const report={state:phase3.verdict==='PASS'?'PASS':'FAIL',session:sessionAuthority.currentSession,calendarVersion:exchangeCalendar.version,universeVersion:universe.version??null,registryVersion:registry.version,structuralBlockers:[],registry,phase3,coverage};
  report.reportHash=sha256({session:report.session,calendarVersion:report.calendarVersion,universeVersion:report.universeVersion,registryVersion:report.registryVersion,phase3:report.phase3,coverage});
  return freeze(report);
}
function freeze(v){return Object.freeze(v)}
