'use strict';
// Session-window utility: the input is an observed market-session calendar,
// NOT a wall-clock 20-day span. Missing sessions fail closed.
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function sessionWindow(calendar,endSession,count){
 if(!Number.isSafeInteger(count)||count<1||!iso(endSession))throw Error('INVALID_SESSION_WINDOW_INPUT');
 if(!Array.isArray(calendar)||calendar.some(x=>!iso(x)))throw Error('INVALID_MARKET_CALENDAR');
 const sorted=[...calendar].sort();
 if(new Set(sorted).size!==sorted.length)throw Error('DUPLICATE_MARKET_CALENDAR_SESSION');
 const end=sorted.indexOf(endSession);
 if(end<0)return {ready:false,reason:'END_SESSION_NOT_OBSERVED',sessions:[]};
 if(end+1<count)return {ready:false,reason:'INSUFFICIENT_OBSERVED_SESSIONS',sessions:[]};
 return {ready:true,reason:null,sessions:sorted.slice(end+1-count,end+1)};
}
function validateWindow(calendar,endSession,count,observations){
 const w=sessionWindow(calendar,endSession,count);if(!w.ready)return w;
 if(!Array.isArray(observations))return {ready:false,reason:'MISSING_OBSERVATIONS',sessions:w.sessions};
 const dates=observations.map(x=>typeof x==='string'?x:x?.date||x?.sessionDate);
 if(dates.some(x=>!iso(x)))return {ready:false,reason:'INVALID_OBSERVATION_SESSION',sessions:w.sessions};
 if(new Set(dates).size!==dates.length)return {ready:false,reason:'DUPLICATE_OBSERVATION_SESSION',sessions:w.sessions};
 const present=new Set(dates);
 if(w.sessions.some(d=>!present.has(d)))return {ready:false,reason:'MARKET_SESSION_GAP',sessions:w.sessions};
 return w;
}
module.exports={sessionWindow,validateWindow};
