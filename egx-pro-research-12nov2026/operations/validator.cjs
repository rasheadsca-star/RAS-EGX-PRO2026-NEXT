'use strict';

/**
 * EGX PRO ingestion gates (no trading signals unless every hard gate passes).
 * This module has no network access and does not mutate the original engines.
 */
const DATE = /^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const WEIGHTS = Object.freeze([
  '50/30/20','20/40/40','30/30/40','60/20/20','50/20/30',
  '40/40/20','40/30/30','30/40/30','33/33/34'
]);
const REQUIRED = ['symbol','isin','open','high','low','close','volume','valueTraded'];
function finitePositive(x) { return typeof x === 'number' && Number.isFinite(x) && x > 0; }
function validDate(s) {
  if(typeof s !== 'string' || !DATE.test(s)) return false;
  const d=new Date(s+'T12:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().startsWith(s);
}
function validateRow(r,master) {
  const reasons=[];
  if(!r || typeof r!=='object') return ['INVALID_ROW'];
  for(const k of REQUIRED) if(r[k]===undefined || r[k]===null || r[k]==='') reasons.push('MISSING_'+k.toUpperCase());
  for(const k of ['open','high','low','close','volume','valueTraded']) if(!finitePositive(r[k])) reasons.push('INVALID_'+k.toUpperCase());
  if(['open','high','low','close'].every(k=>finitePositive(r[k]))) {
    // EGX bulletin's "Open Price" sometimes falls outside the printed intraday
    // high/low range; only reject if the CLOSE falls outside the range.
    // The reference/open field must be source-defined before using it as OHLC open.
    if(r.high<r.close) reasons.push('HIGH_VIOLATION');
    if(r.low>r.close) reasons.push('LOW_VIOLATION');
    if(r.low>r.high) reasons.push('REVERSED_RANGE');
  }
  if(typeof r.isin!=='string' || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(r.isin)) reasons.push('INVALID_ISIN');
  if(typeof r.symbol!=='string'||!/^[A-Z0-9._-]{2,20}$/.test(r.symbol)) reasons.push('INVALID_SYMBOL');
  if(master) {
    const m=master[r.isin];
    if(!m) reasons.push('UNKNOWN_ISIN');
    else if(m.symbol!==r.symbol) reasons.push('SYMBOL_ISIN_MISMATCH');
    if(m && Number.isFinite(m.tickSize) && m.tickSize>0) {
      for(const k of ['open','high','low','close']) {
        if(finitePositive(r[k])) {
          const ratio=r[k]/m.tickSize;
          if(Math.abs(ratio-Math.round(ratio))>1e-5) reasons.push('TICK_MISMATCH_'+k.toUpperCase());
        }
      }
    }else if(m) reasons.push('MISSING_TICK_SIZE');
  }else reasons.push('SECURITY_MASTER_UNAVAILABLE');
  return [...new Set(reasons)];
}
function validateSession({session,rows,sourceHash,sourcePages,master,minRows=200,previousSession=null}) {
  const errors=[];
  if(!validDate(session)) errors.push('INVALID_SESSION_DATE');
  if(previousSession && validDate(previousSession) && session<=previousSession) errors.push('NON_MONOTONIC_SESSION_DATE');
  if(!/^[a-f0-9]{64}$/i.test(sourceHash||'')) errors.push('MISSING_SOURCE_SHA256');
  if(!Number.isInteger(sourcePages)||sourcePages<15||sourcePages>120) errors.push('INVALID_PAGE_COUNT');
  if(!Array.isArray(rows)) errors.push('MISSING_ROWS');
  const accepted=[],quarantine=[],symbols=new Set(),isins=new Set();
  for(const r of Array.isArray(rows)?rows:[]) {
    const reasons=validateRow(r,master);
    if(r && (symbols.has(r.symbol)||isins.has(r.isin))) reasons.push('DUPLICATE_IDENTITY');
    if(reasons.length) quarantine.push({row:r,reasons});
    else {accepted.push(r);symbols.add(r.symbol);isins.add(r.isin);}
  }
  if(accepted.length<minRows) errors.push('INSUFFICIENT_VERIFIED_COVERAGE');
  if(quarantine.length) errors.push('UNRESOLVED_QUARANTINE');
  if(!master || !Object.keys(master).length) errors.push('NO_VERSIONED_SECURITY_MASTER');
  return {ok:errors.length===0,session,acceptedRows:accepted.length,totalRows:Array.isArray(rows)?rows.length:0,
    quarantinedRows:quarantine.length,errors:[...new Set(errors)],quarantine,
    publicationAllowed:errors.length===0,mode:'RESEARCH_NOT_CERTIFIED'};
}
function evaluatePlan(plan,bar) {
  for(const k of ['entry','stop','t1','t2']) if(!finitePositive(plan?.[k])) return {status:'INVALID_PLAN'};
  for(const k of ['high','low','close']) if(!finitePositive(bar?.[k])) return {status:'NO_BAR'};
  if(bar.high<bar.low) return {status:'INVALID_BAR'};
  const isLong=plan.entry>plan.stop;
  if(!isLong || !(plan.t1>plan.entry && plan.t2>plan.t1)) return {status:'INVALID_PLAN'};
  const entryTouched=bar.high>=plan.entry && bar.low<=plan.entry;
  if(!entryTouched) return {status:'NO_ENTRY',entryTouched:false,executed:false};
  const stopTouched=bar.low<=plan.stop;
  const t1Touched=bar.high>=plan.t1;
  const t2Touched=bar.high>=plan.t2;
  // Daily OHLC doesn't tell us whether a target or a stop came first.
  if(stopTouched && (t1Touched||t2Touched)) return {status:'ORDER_UNKNOWN',entryTouched:true,stopTouched,t1Touched,t2Touched,executed:false};
  if(stopTouched) return {status:'STOP_TOUCHED_SEQUENCE_UNCONFIRMED',entryTouched:true,stopTouched:true,executed:false};
  if(t2Touched) return {status:'T2_TOUCHED_SEQUENCE_UNCONFIRMED',entryTouched:true,executed:false};
  if(t1Touched) return {status:'T1_TOUCHED_SEQUENCE_UNCONFIRMED',entryTouched:true,executed:false};
  return {status:'OPEN_UNRESOLVED',entryTouched:true,executed:false};
}
function shouldAdvanceLatest({current,proposed,validation,artifactsPresent}) {
  return !!validation?.ok && !!artifactsPresent && validDate(proposed) && (!current||validDate(current)&&proposed>current);
}
module.exports={WEIGHTS,validateRow,validateSession,evaluatePlan,shouldAdvanceLatest,validDate};
