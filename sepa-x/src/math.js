export const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
export const clamp = (x, lo=0, hi=100) => Math.max(lo, Math.min(hi, Number(x) || 0));
export const round = (x, d=2) => (x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x))) ? Number(Number(x).toFixed(d)) : null;
export const mean = (xs) => {
  const a = xs.map(n).filter(Number.isFinite);
  return a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
};
export const median = (xs) => {
  const a = xs.map(n).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!a.length) return null;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
};
export const std = (xs) => {
  const a=xs.map(n).filter(Number.isFinite); if(a.length<2)return null;
  const m=mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2)));
};
export const sma = (xs, p, end=xs.length) => {
  if (!Array.isArray(xs) || end < p) return null;
  return mean(xs.slice(end-p,end));
};
export const pct = (a,b) => (Number.isFinite(Number(a)) && Number(b)) ? (Number(a)/Number(b)-1)*100 : null;
export const ret = (closes, sessions) => closes.length > sessions && closes.at(-1-sessions) ? pct(closes.at(-1), closes.at(-1-sessions)) : null;
export const percentileRank = (value, universe) => {
  const a=universe.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!Number.isFinite(value)||!a.length)return null;
  const below=a.filter(x=>x<value).length, equal=a.filter(x=>x===value).length;
  return ((below + 0.5*equal)/a.length)*100;
};
export const slopePct = (xs, lookback) => {
  if(xs.length<=lookback || !xs.at(-1-lookback))return null;
  return pct(xs.at(-1), xs.at(-1-lookback));
};
export const trueRanges = (bars) => bars.map((b,i)=>{
  if(i===0)return b.high-b.low;
  const pc=bars[i-1].close;
  return Math.max(b.high-b.low, Math.abs(b.high-pc), Math.abs(b.low-pc));
});
export const atr = (bars,p=14) => sma(trueRanges(bars),p);
export const maxDrawdown = (xs) => {
  let peak=-Infinity, mdd=0;
  for(const x of xs){ if(x>peak)peak=x; if(peak>0)mdd=Math.max(mdd,(peak-x)/peak*100); }
  return mdd;
};
export const weightedAvailable = (parts) => {
  let num=0, den=0;
  for(const [value,weight] of parts){
    const v=n(value),w=n(weight);
    if(Number.isFinite(v)&&Number.isFinite(w)&&w>0){num+=v*w;den+=w;}
  }
  return den ? num/den : null;
};
export const daysBetween = (a,b) => {
  const x=Date.parse(a),y=Date.parse(b); return Number.isFinite(x)&&Number.isFinite(y)?Math.round((y-x)/86400000):null;
};
