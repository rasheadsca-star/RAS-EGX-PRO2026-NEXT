'use strict';
// Trading-session indicators ignore zero-volume reference-only candles.
// The reference bars remain intact in the canonical historical universe.
function executable(bar){return !!bar&&bar.executable!==false&&Number.isFinite(Number(bar.volume))&&Number(bar.volume)>0}
function tradingWindow(rows,i,count=55){
 if(!Array.isArray(rows)||!Number.isInteger(i)||i<0||i>=rows.length||!executable(rows[i])||!Number.isInteger(count)||count<1)return null;
 const w=[];for(let j=i;j>=0&&w.length<count;j--)if(executable(rows[j]))w.push(rows[j]);
 return w.length===count?w.reverse():null;
}
function tradeForwardWindow(rows,entryIndex,count){
 if(!Array.isArray(rows)||!Number.isInteger(entryIndex)||!Number.isInteger(count)||count<1)return [];
 const w=[];for(let j=entryIndex;j<rows.length&&w.length<count;j++)if(executable(rows[j]))w.push(rows[j]);
 return w;
}
module.exports={executable,tradingWindow,tradeForwardWindow};
