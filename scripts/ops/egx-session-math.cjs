'use strict';
const fs = require('node:fs');
const path = require('node:path');
function confirmedClosures(root = process.cwd()) {
  const data = JSON.parse(fs.readFileSync(path.join(root,'data/egx-exchange-closures.json'),'utf8'));
  return new Set((data.closures || []).filter(x=>x.status==='confirmed_exchange_closure' && x.source).map(x=>x.date));
}
function shiftDay(date, n) { const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function isTradingSession(date, closed = new Set()) { const dow=new Date(date+'T12:00:00Z').getUTCDay(); return dow!==5 && dow!==6 && !closed.has(date); }
function sessionsBetween(start, end, closed = new Set()) { if(end<start) throw new Error('end before start'); let count=0; for(let date=shiftDay(start,1);date<=end;date=shiftDay(date,1)) if(isTradingSession(date,closed)) count++; return count; }
module.exports={confirmedClosures,shiftDay,isTradingSession,sessionsBetween};
