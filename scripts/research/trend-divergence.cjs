'use strict';
// Close-based pivots avoid treating reconstructed intraday highs/lows as real bars.
const POLICY = Object.freeze({rsiPeriod:14, pivotRadius:2, lookback:60, maxLowAge:20, minRsiRise:2, breakoutBuffer:0.001, minBars:80});
function rsi(values, period=14) {
  const result=values.map(()=>null); let up=0,down=0;
  for(let i=1;i<values.length;i++) {
    const d=values[i]-values[i-1],u=Math.max(d,0),v=Math.max(-d,0);
    if(i<=period){up+=u;down+=v;if(i<period)continue;up/=period;down/=period;}
    else {up=(up*(period-1)+u)/period;down=(down*(period-1)+v)/period;}
    result[i]=down===0?(up===0?50:100):100-100/(1+up/down);
  }
  return result;
}
function pivots(values, radius, lastKnown, low) {
  const out=[];
  for(let i=radius;i+radius<=lastKnown;i++) {
    let ok=true;
    for(let j=i-radius;j<=i+radius;j++) if(j!==i && (low?values[j]<=values[i]:values[j]>=values[i]))ok=false;
    if(ok)out.push(i);
  }
  return out;
}
function detect(doc, session) {
  const base={symbol:doc.ticker,name:doc.companyNameAr||doc.ticker,session,executionAllowed:false};
  const blocked=reason=>({...base,status:'BLOCKED',reason});
  const bars=(doc.sessions||[]).filter(x=>x.date<=session);
  if(!session||bars.length<POLICY.minBars)return blocked('INSUFFICIENT_HISTORY');
  if(doc.symbolVerified!==true||doc.staleData||doc.updateFailed)return blocked('UNVERIFIED_OR_STALE');
  const n=bars.length-1, closes=bars.map(x=>Number(x.close));
  if(bars[n].date!==session)return blocked('SESSION_MISMATCH');
  if(closes.some(x=>!Number.isFinite(x)||x<=0)||bars.some((x,i)=>i&&x.date<=bars[i-1].date))return blocked('INVALID_HISTORY');
  // Split/price-basis uncertainty must not manufacture a reversal.
  if(closes.some((x,i)=>i>n-POLICY.lookback&&i>0&&Math.abs(x/closes[i-1]-1)>0.3))return blocked('PRICE_DISCONTINUITY');
  if((bars[n].warnings||[]).some(x=>/conflict|quarantine|unverified/i.test(x)))return blocked('LATEST_PRICE_QUALITY');
  const osc=rsi(closes),from=Math.max(14,n-POLICY.lookback);
  // All anchors were confirmed before today's breakout bar, preventing look-ahead.
  const highs=pivots(closes,2,n-1,false).filter(i=>i>=from);
  const lows=pivots(closes,2,n-1,true).filter(i=>i>=from);
  const [a,b]=highs.slice(-2),[l1,l2]=lows.slice(-2);
  const divergence=l1!==undefined&&l2-l1>=5&&n-l2<=POLICY.maxLowAge&&closes[l2]<closes[l1]&&osc[l2]>=osc[l1]+POLICY.minRsiRise;
  let line=null,breakout=false,trend=false;
  if(a!==undefined&&b-a>=5&&closes[b]<closes[a]) {
    const slope=(closes[b]-closes[a])/(b-a),at=i=>closes[a]+slope*(i-a);
    line=at(n);
    trend=line>0 && closes.slice(a+1,n).every((c,j)=>c<=at(a+1+j)*(1+POLICY.breakoutBuffer));
    breakout=trend&&closes[n-1]<=at(n-1)*(1+POLICY.breakoutBuffer)&&closes[n]>line*(1+POLICY.breakoutBuffer);
  }
  const signal=breakout&&divergence&&l2>b;
  return {...base,status:signal?'SIGNAL':divergence&&trend?'WATCH':'NO_SIGNAL',
    reason:signal?'BREAKOUT_WITH_BULLISH_RSI_DIVERGENCE':divergence&&trend?'WAITING_FOR_CLOSE_BREAKOUT':'CONDITIONS_NOT_MET',
    close:closes[n],rsi:osc[n],trendLine:line,breakout,divergence,
    anchors:{highs:[a,b].filter(i=>i!==undefined).map(i=>({date:bars[i].date,close:closes[i]})),
      lows:[l1,l2].filter(i=>i!==undefined).map(i=>({date:bars[i].date,close:closes[i],rsi:osc[i]}))}};
}
module.exports={POLICY,rsi,pivots,detect};
