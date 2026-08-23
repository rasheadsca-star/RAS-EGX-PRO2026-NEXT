'use strict';
(() => {
  if (window.__EGX_P2_PORTFOLIO_DEEP__) return;
  window.__EGX_P2_PORTFOLIO_DEEP__ = true;

  const MAIN_KEY = 'egx-v16-professional-portfolio';
  const ANALYZER_KEY = 'egx-main-app-stock-analyzer-portfolio-v1';
  const BASE = new URL('../../', location.href);
  const HISTORY_URL = ticker => new URL(`data/history/${encodeURIComponent(ticker)}.json`, BASE).href;
  const MARKET_URL = new URL('data/market.json', BASE).href;
  const cache = new Map();
  let marketMap = new Map();
  let renderToken = 0;
  let timer = null;

  const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pct = (cur, prev) => Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0 ? (cur / prev - 1) * 100 : null;
  const fmt = (v, d = 2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('ar-EG', { maximumFractionDigits: d }) : '—';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function parse(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function holdings() {
    const merged = new Map();
    const main = parse(MAIN_KEY, []);
    if (Array.isArray(main)) {
      main.forEach(x => {
        const ticker = String(x?.ticker || '').trim().toUpperCase();
        const quantity = num(x?.quantity);
        const averagePrice = num(x?.entry);
        if (ticker && quantity > 0 && averagePrice > 0) merged.set(ticker, { ticker, quantity, averagePrice, source: 'MAIN' });
      });
    }
    const analyzer = parse(ANALYZER_KEY, {});
    if (analyzer && typeof analyzer === 'object' && !Array.isArray(analyzer)) {
      Object.entries(analyzer).forEach(([raw, pos]) => {
        if (!pos?.owned) return;
        const ticker = String(raw || '').trim().toUpperCase();
        const quantity = num(pos?.qty);
        const averagePrice = num(pos?.avgCost);
        if (ticker && quantity > 0 && averagePrice > 0) merged.set(ticker, { ticker, quantity, averagePrice, source: 'ANALYZER' });
      });
    }
    return [...merged.values()];
  }

  async function getJson(url) {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`, { cache: 'no-store', headers: {'Cache-Control':'no-cache'} });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async function history(ticker) {
    if (!cache.has(ticker)) cache.set(ticker, getJson(HISTORY_URL(ticker)));
    return cache.get(ticker);
  }

  function cleanRows(doc) {
    const rows = Array.isArray(doc) ? doc : (doc?.sessions || doc?.rows || doc?.history || []);
    return rows.filter(r => [r.open, r.high, r.low, r.close].every(v => Number.isFinite(Number(v))))
      .map(r => ({...r, open:+r.open, high:+r.high, low:+r.low, close:+r.close, volume:num(r.volume) || 0, date:r.date || r.sessionDate || r.session || ''}))
      .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  }
  function emaSeries(v,p){const out=Array(v.length).fill(null);if(v.length<p)return out;const k=2/(p+1);let cur=mean(v.slice(0,p));out[p-1]=cur;for(let i=p;i<v.length;i++){cur=v[i]*k+cur*(1-k);out[i]=cur;}return out;}
  function ema(v,p){return [...emaSeries(v,p)].reverse().find(Number.isFinite) ?? null;}
  function sma(v,p){return v.length>=p?mean(v.slice(-p)):null;}
  function rsi(v,p=14){if(v.length<=p)return null;let g=0,l=0;for(let i=v.length-p;i<v.length;i++){const d=v[i]-v[i-1];if(d>=0)g+=d;else l-=d;}if(l===0)return 100;const rs=(g/p)/(l/p);return 100-(100/(1+rs));}
  function atr(rows,p=14){if(rows.length<=p)return null;const tr=[];for(let i=1;i<rows.length;i++){tr.push(Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-rows[i-1].close),Math.abs(rows[i].low-rows[i-1].close)));}return tr.length>=p?mean(tr.slice(-p)):null;}
  function macd(v){const a=emaSeries(v,12),b=emaSeries(v,26),line=v.map((_,i)=>Number.isFinite(a[i])&&Number.isFinite(b[i])?a[i]-b[i]:null),c=line.filter(Number.isFinite);if(c.length<9)return{line:null,signal:null,hist:null};const signal=ema(c,9),latest=[...line].reverse().find(Number.isFinite);return{line:latest,signal,hist:Number.isFinite(latest)&&Number.isFinite(signal)?latest-signal:null};}
  function volRatio(rows,p=20){if(rows.length<p+1)return null;const vs=rows.slice(-(p+1)).map(r=>r.volume).filter(Number.isFinite),latest=vs.at(-1),avg=mean(vs.slice(0,-1));return avg?latest/avg:null;}
  function fibonacci(rows){const d=rows.slice(-80);if(d.length<20)return null;let hi=-Infinity,lo=Infinity,hiI=-1,loI=-1;d.forEach((r,i)=>{if(r.high>hi){hi=r.high;hiI=i;}if(r.low<lo){lo=r.low;loI=i;}});if(!(hi>lo))return null;const up=loI<hiI,rg=hi-lo;return up?{direction:'UP',high:hi,low:lo,r236:hi-.236*rg,r382:hi-.382*rg,r500:hi-.5*rg,r618:hi-.618*rg,r786:hi-.786*rg,e1272:hi+.272*rg,e1618:hi+.618*rg}:{direction:'DOWN',high:hi,low:lo,r236:lo+.236*rg,r382:lo+.382*rg,r500:lo+.5*rg,r618:lo+.618*rg,r786:lo+.786*rg,e1272:lo-.272*rg,e1618:lo-.618*rg};}
  function swings(rows){const s=[],r=[];const d=rows.slice(-100);for(let i=2;i<d.length-2;i++){if(d[i].low<=d[i-1].low&&d[i].low<=d[i-2].low&&d[i].low<=d[i+1].low&&d[i].low<=d[i+2].low)s.push(d[i].low);if(d[i].high>=d[i-1].high&&d[i].high>=d[i-2].high&&d[i].high>=d[i+1].high&&d[i].high>=d[i+2].high)r.push(d[i].high);}return{s,r};}
  function cluster(a,t=.012){const x=[...a].sort((p,q)=>p-q),out=[];for(const v of x){const c=out.at(-1);if(!c||Math.abs(v-c.level)/Math.max(c.level,.0001)>t)out.push({level:v,touches:1});else{c.level=(c.level*c.touches+v)/(c.touches+1);c.touches++;}}return out;}
  function levels(rows,price){const x=swings(rows);return{supports:cluster(x.s).filter(v=>v.level<price).sort((a,b)=>b.level-a.level).slice(0,3),resistances:cluster(x.r).filter(v=>v.level>price).sort((a,b)=>a.level-b.level).slice(0,3)};}

  function evidence(a){const e=[];const add=(label,w,state,why)=>e.push({label,w,state:clamp(state,-1,1),why});const p=a.price;
    if(a.ema20)add('السعر / EMA20',12,p>a.ema20?1:-1,p>a.ema20?'أعلى EMA20':'أسفل EMA20');
    if(a.ema20&&a.ema50)add('EMA20 / EMA50',13,a.ema20>a.ema50?1:-1,a.ema20>a.ema50?'ترتيب صاعد':'ترتيب هابط');
    if(a.sma50)add('SMA50',7,p>a.sma50?.75:-.75,p>a.sma50?'فوق SMA50':'تحت SMA50');
    if(a.sma200)add('SMA200',6,p>a.sma200?.7:-.7,p>a.sma200?'فوق طويل الأجل':'تحت طويل الأجل');
    if(Number.isFinite(a.macd.hist))add('MACD',12,a.macd.hist>0?1:-1,a.macd.hist>0?'Histogram موجب':'Histogram سالب');
    if(Number.isFinite(a.rsi14)){let st=a.rsi14>=52&&a.rsi14<=68?.9:a.rsi14>76?-.35:a.rsi14<38?-.8:a.rsi14>=45&&a.rsi14<52?-.15:a.rsi14>68?.25:0;add('RSI14',12,st,`RSI ${fmt(a.rsi14,1)}`);}
    if(Number.isFinite(a.volumeRatio)){const dir=Math.sign(a.ret1||0);add('الحجم',8,a.volumeRatio>=1.2?dir*.8:dir*.2,`الحجم ${fmt(a.volumeRatio,2)}×`);}
    if(Number.isFinite(a.ret5))add('Momentum 5D',8,clamp(a.ret5/7,-1,1),`${fmt(a.ret5,2)}%`);
    if(Number.isFinite(a.ret20))add('Momentum 20D',8,clamp(a.ret20/14,-1,1),`${fmt(a.ret20,2)}%`);
    if(a.fib){let st=0;if(a.fib.direction==='UP')st=p>=a.fib.r500?.7:p>=a.fib.r618?.35:-.45;else st=p<=a.fib.r500?-.7:p<=a.fib.r618?-.35:.25;add('Fibonacci',7,st,`50% ${fmt(a.fib.r500,3)} · 61.8% ${fmt(a.fib.r618,3)}`);}
    const s=a.supports[0]?.level,r=a.resistances[0]?.level;if(s&&r){const down=(p/s-1)*100,up=(r/p-1)*100;add('الدعم/المقاومة',7,up/Math.max(down,.3)>1.5?.7:up/Math.max(down,.3)<.7?-.7:0,`أعلى ${fmt(up,1)}% · للدعم ${fmt(down,1)}%`);}
    let bull=23,side=28,bear=23;e.forEach(x=>{bull+=x.w*Math.max(x.state,0);bear+=x.w*Math.max(-x.state,0);side+=x.w*(1-Math.abs(x.state))*.55;});const total=bull+side+bear;bull=bull/total*100;side=side/total*100;bear=100-bull-side;return{items:e,bull,side,bear};
  }

  function stateAt(rows,end){if(end<54)return null;const d=rows.slice(0,end+1),c=d.map(r=>r.close),price=c.at(-1),e20=ema(c,20),e50=ema(c,50),rr=rsi(c),mm=macd(c),aa=atr(d),vr=volRatio(d),ret5=c.length>5?pct(price,c.at(-6)):0,ret20=c.length>20?pct(price,c.at(-21)):0;if(![price,e20,e50,rr,aa].every(Number.isFinite))return null;return{priceEma20:pct(price,e20),emaGap:pct(e20,e50),rsi:rr,macd:Number.isFinite(mm.hist)?mm.hist/price*100:0,vol:Number.isFinite(vr)?vr:1,ret5:ret5||0,ret20:ret20||0,atr:aa/price*100};}
  function dist(a,b){const parts=[[a.priceEma20,b.priceEma20,5,.19],[a.emaGap,b.emaGap,4,.18],[a.rsi,b.rsi,22,.16],[a.macd,b.macd,1.6,.14],[a.vol,b.vol,1.2,.08],[a.ret5,b.ret5,9,.1],[a.ret20,b.ret20,18,.1],[a.atr,b.atr,3,.05]];return parts.reduce((s,[x,y,scale,w])=>s+w*clamp(Math.abs(x-y)/scale,0,2.2),0);}
  function classify(ret,atrPct,h){const th=Math.max(h===1?.8:h===3?1.35:1.8,.48*atrPct*Math.sqrt(h));return ret>th?'bull':ret<-th?'bear':'side';}
  function calibrate(rows){if(rows.length<65)return{ready:false,reason:`السجل ${rows.length} جلسة فقط`};const cur=stateAt(rows,rows.length-1);if(!cur)return{ready:false,reason:'لا يمكن بناء البصمة الحالية'};const cand=[];for(let i=54;i<=rows.length-6;i++){const s=stateAt(rows,i);if(!s)continue;const d=dist(cur,s),sim=Math.exp(-1.55*d);cand.push({i,s,sim});}cand.sort((a,b)=>b.sim-a.sim);let m=cand.filter(x=>x.sim>=.18).slice(0,24);if(m.length<10)m=cand.slice(0,14);if(m.length<8)return{ready:false,reason:`الحالات المشابهة ${m.length} فقط`};const horizon=h=>{let w=0,bull=.55,side=.55,bear=.55,ret=0,arr=[];for(const x of m){if(x.i+h>=rows.length)continue;const r=pct(rows[x.i+h].close,rows[x.i].close);if(!Number.isFinite(r))continue;const ww=x.sim;({bull:()=>bull+=ww,side:()=>side+=ww,bear:()=>bear+=ww}[classify(r,x.s.atr,h)])();w+=ww;ret+=ww*r;arr.push(r);}const den=w+1.65;return{h,n:arr.length,bull:bull/den*100,side:side/den*100,bear:bear/den*100,expected:w?ret/w:null};};const hs=[horizon(1),horizon(3),horizon(5)],mix=k=>.2*hs[0][k]+.35*hs[1][k]+.45*hs[2][k],avg=mean(m.map(x=>x.sim));return{ready:true,matches:m.length,similarity:avg*100,quality:clamp(avg*clamp(m.length/18,0,1),0,1),horizons:hs,emp:{bull:mix('bull'),side:mix('side'),bear:mix('bear')}};}
  function blend(ev,cal){if(!cal.ready)return{...ev,alpha:0,confidence:'منخفض'};const alpha=clamp(.28+.42*cal.quality,.28,.68),o={};['bull','side','bear'].forEach(k=>o[k]=ev[k]*(1-alpha)+cal.emp[k]*alpha);const sum=o.bull+o.side+o.bear;['bull','side','bear'].forEach(k=>o[k]=o[k]/sum*100);const s=Object.values(o).sort((a,b)=>b-a),spread=s[0]-s[1];return{...o,alpha,confidence:spread>=15&&cal.quality>.45?'مرتفع':spread>=8?'متوسط':'منخفض'};}

  function analyze(doc,h){const rows=cleanRows(doc);if(rows.length<30)throw new Error('بيانات تاريخية غير كافية');const c=rows.map(r=>r.close),latest=c.at(-1),market=marketMap.get(h.ticker),price=num(market?.price)??latest,lv=levels(rows,price),a={ticker:h.ticker,rows,price,avg:h.averagePrice,quantity:h.quantity,ema20:ema(c,20),ema50:ema(c,50),sma50:sma(c,50),sma200:sma(c,200),rsi14:rsi(c),macd:macd(c),atr14:atr(rows),volumeRatio:volRatio(rows),fib:fibonacci(rows),supports:lv.supports,resistances:lv.resistances,ret1:pct(c.at(-1),c.at(-2)),ret5:c.length>5?pct(c.at(-1),c.at(-6)):null,ret20:c.length>20?pct(c.at(-1),c.at(-21)):null,session:rows.at(-1).date};a.value=a.price*a.quantity;a.pnl=(a.price-a.avg)*a.quantity;a.pnlPct=pct(a.price,a.avg);a.ev=evidence(a);a.cal=calibrate(rows);a.final=blend(a.ev,a.cal);return a;}

  function ensureStyle(){if(document.getElementById('p2PortfolioDeepStyle'))return;const s=document.createElement('style');s.id='p2PortfolioDeepStyle';s.textContent=`
#p2PortfolioDeep{margin-top:16px;text-align:right}.p2d-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:16px;border-bottom:1px solid #285267}.p2d-head h2{margin:0 0 5px;font-size:20px}.p2d-head p{margin:0;color:#94afbd;font-size:12px}.p2d-badge{padding:7px 10px;border-radius:999px;background:#12394a;border:1px solid #2d6478;font-weight:800;font-size:11px}.p2d-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px}.p2d-metric{background:#0b2637;border:1px solid #285064;border-radius:10px;padding:9px}.p2d-metric small{display:block;color:#8da9b8;font-size:10px}.p2d-metric b{display:block;margin-top:4px;font-size:15px}.p2d-stock{margin:0 12px 14px;border:1px solid #315a70;background:#081a28;border-radius:14px;overflow:hidden}.p2d-stock-head{display:flex;justify-content:space-between;gap:10px;padding:13px;background:#0e293a}.p2d-stock-head h3{margin:0;color:#52c7ff;font-size:19px}.p2d-sub{font-size:10px;color:#92adba;margin-top:4px}.p2d-probs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:11px}.p2d-prob{background:#091f2e;border:1px solid #25495d;border-radius:9px;padding:8px}.p2d-prob>div{display:flex;justify-content:space-between;font-size:10px}.p2d-track{height:7px;background:#173445;border-radius:99px;overflow:hidden;margin-top:6px}.p2d-track i{display:block;height:100%}.bull{background:#39c58c}.side{background:#d5aa4d}.bear{background:#e16c77}.p2d-chartwrap{overflow:auto;margin:0 11px;border:1px solid #234658;border-radius:10px;background:#06131d}.p2d-chart{display:block;width:100%;min-width:760px}.p2d-grid{stroke:#173747}.p2d-up{fill:#35b981;stroke:#35b981}.p2d-down{fill:#df6c76;stroke:#df6c76}.p2d-ema20{fill:none;stroke:#54b9e7;stroke-width:1.7}.p2d-ema50{fill:none;stroke:#d7aa4d;stroke-width:1.7}.p2d-level{stroke-dasharray:6 5;stroke-width:1.1}.p2d-fib{stroke:#9a7bdf}.p2d-support{stroke:#38b981}.p2d-res{stroke:#e2a24a}.p2d-label{fill:#cce4ef;font-size:9px}.p2d-two{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:11px}.p2d-box{background:#091f2e;border:1px solid #274a5c;border-radius:10px;padding:10px}.p2d-box h4{margin:0 0 8px}.p2d-evidence{display:grid;gap:5px}.p2d-evidence div{background:#0d293a;border-radius:7px;padding:7px;font-size:10px}.p2d-cal table,.p2d-scen table{width:100%;border-collapse:collapse;min-width:650px}.p2d-cal,.p2d-scen{overflow:auto;margin:0 11px 11px}.p2d-cal th,.p2d-cal td,.p2d-scen th,.p2d-scen td{font-size:10px;padding:7px;border-bottom:1px solid #1d3e50}.p2d-note{margin:0 12px 12px;padding:9px;border:1px solid #6b5932;background:#2b2418;color:#ffe7a0;border-radius:9px;font-size:10px;line-height:1.6}.p2d-empty{padding:28px;text-align:center;color:#9cb4c0}@media(max-width:800px){.p2d-summary{grid-template-columns:repeat(2,1fr)}.p2d-two{grid-template-columns:1fr}.p2d-stock-head{flex-direction:column}.p2d-probs{grid-template-columns:1fr}}
`;document.head.appendChild(s);}
  function metric(l,v,n=''){return `<div class="p2d-metric"><small>${esc(l)}</small><b>${esc(v)}</b>${n?`<small>${esc(n)}</small>`:''}</div>`;}
  function prob(l,v,k){return `<div class="p2d-prob"><div><span>${esc(l)}</span><b>${fmt(v,1)}%</b></div><div class="p2d-track"><i class="${k}" style="width:${clamp(v,0,100)}%"></i></div></div>`;}

  function chart(a){const rows=a.rows.slice(-80),W=1000,H=330,L=50,R=20,T=18,B=30,vals=rows.flatMap(x=>[x.low,x.high]),mn=Math.min(...vals),mx=Math.max(...vals),rg=mx-mn||1,x=i=>L+i/Math.max(1,rows.length-1)*(W-L-R),y=v=>T+(mx-v)/rg*(H-T-B),e20=emaSeries(rows.map(r=>r.close),20),e50=emaSeries(rows.map(r=>r.close),50),path=(series,cls)=>{const pts=series.map((v,i)=>Number.isFinite(v)?`${x(i)},${y(v)}`:null).filter(Boolean);return pts.length?`<polyline class="${cls}" points="${pts.join(' ')}"/>`:'';},grid=[0,.25,.5,.75,1].map(k=>`<line class="p2d-grid" x1="${L}" x2="${W-R}" y1="${T+k*(H-T-B)}" y2="${T+k*(H-T-B)}"/>`).join(''),cw=Math.max(3,Math.min(8,(W-L-R)/rows.length*.55)),cand=rows.map((r,i)=>{const up=r.close>=r.open,c=up?'p2d-up':'p2d-down',xx=x(i),yo=y(r.open),yc=y(r.close);return `<line class="${c}" x1="${xx}" x2="${xx}" y1="${y(r.high)}" y2="${y(r.low)}"/><rect class="${c}" x="${xx-cw/2}" y="${Math.min(yo,yc)}" width="${cw}" height="${Math.max(1,Math.abs(yc-yo))}"/>`;}).join(''),hl=(v,label,cls)=>Number.isFinite(v)?`<line class="p2d-level ${cls}" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="p2d-label" x="${W-R-4}" y="${y(v)-3}" text-anchor="end">${label} ${fmt(v,3)}</text>`:'';return `<div class="p2d-chartwrap"><svg class="p2d-chart" viewBox="0 0 ${W} ${H}">${grid}${cand}${path(e20,'p2d-ema20')}${path(e50,'p2d-ema50')}${hl(a.supports[0]?.level,'دعم','p2d-support')}${hl(a.resistances[0]?.level,'مقاومة','p2d-res')}${hl(a.fib?.r382,'Fib 38.2','p2d-fib')}${hl(a.fib?.r500,'Fib 50','p2d-fib')}${hl(a.fib?.r618,'Fib 61.8','p2d-fib')}</svg></div>`;}

  function card(a,weight){const f=a.final,dom=[['صاعد',f.bull],['عرضي',f.side],['هابط',f.bear]].sort((x,y)=>y[1]-x[1])[0],s1=a.supports[0]?.level??a.fib?.r618,r1=a.resistances[0]?.level??a.fib?.e1272,s2=a.supports[1]?.level??a.fib?.r786,r2=a.resistances[1]?.level??a.fib?.e1618;const ev=[...a.ev.items].sort((x,y)=>Math.abs(y.state*y.w)-Math.abs(x.state*x.w)).slice(0,8);return `<article class="p2d-stock"><div class="p2d-stock-head"><div><h3>${esc(a.ticker)}</h3><div class="p2d-sub">جلسة ${esc(a.session)} · وزن ${fmt(weight,1)}% · نتيجة المركز ${fmt(a.pnlPct,2)}%</div></div><div class="p2d-badge">السيناريو الأعلى: ${dom[0]} ${fmt(dom[1],1)}% · ثقة ${esc(f.confidence)}</div></div><div class="p2d-summary">${metric('السعر',fmt(a.price,3),`التكلفة ${fmt(a.avg,3)}`)}${metric('RSI14',fmt(a.rsi14,1))}${metric('MACD Hist',fmt(a.macd.hist,4))}${metric('Volume Ratio',`${fmt(a.volumeRatio,2)}×`)}${metric('EMA20 / EMA50',`${fmt(a.ema20,3)} / ${fmt(a.ema50,3)}`)}${metric('دعم / مقاومة',`${fmt(s1,3)} / ${fmt(r1,3)}`)}${metric('Momentum 5D',`${fmt(a.ret5,2)}%`)}${metric('Momentum 20D',`${fmt(a.ret20,2)}%`)}</div><div class="p2d-probs">${prob('صاعد معاير',f.bull,'bull')}${prob('عرضي معاير',f.side,'side')}${prob('هابط معاير',f.bear,'bear')}</div>${chart(a)}<div class="p2d-two"><section class="p2d-box"><h4>أقوى الأدلة الفنية</h4><div class="p2d-evidence">${ev.map(x=>`<div><b>${esc(x.label)}</b> — ${esc(x.why)} <strong>${x.state>0?'＋':x.state<0?'−':'='}</strong></div>`).join('')}</div></section><section class="p2d-box"><h4>Fibonacci والمستويات</h4>${metric('Fib 38.2%',fmt(a.fib?.r382,3))}${metric('Fib 50%',fmt(a.fib?.r500,3))}${metric('Fib 61.8%',fmt(a.fib?.r618,3))}${metric('Fib 78.6%',fmt(a.fib?.r786,3))}</section></div><div class="p2d-scen"><table><thead><tr><th>السيناريو</th><th>الترجيح</th><th>التفعيل</th><th>المسار</th></tr></thead><tbody><tr><td>صاعد</td><td>${fmt(f.bull,1)}%</td><td>الثبات أعلى EMA20 ثم تجاوز ${fmt(r1,3)}</td><td>${fmt(r2,3)}</td></tr><tr><td>عرضي</td><td>${fmt(f.side,1)}%</td><td>البقاء بين ${fmt(s1,3)} و${fmt(r1,3)}</td><td>تذبذب/تجميع</td></tr><tr><td>هابط</td><td>${fmt(f.bear,1)}%</td><td>إغلاق أسفل ${fmt(s1,3)}</td><td>${fmt(s2,3)}</td></tr></tbody></table></div>${a.cal.ready?`<div class="p2d-cal"><table><thead><tr><th>المعايرة التاريخية</th><th>العينة</th><th>صاعد</th><th>عرضي</th><th>هابط</th><th>متوسط العائد</th></tr></thead><tbody>${a.cal.horizons.map(h=>`<tr><td>${h.h} جلسة</td><td>${h.n}</td><td>${fmt(h.bull,1)}%</td><td>${fmt(h.side,1)}%</td><td>${fmt(h.bear,1)}%</td><td>${fmt(h.expected,2)}%</td></tr>`).join('')}</tbody></table><div class="p2d-note">${a.cal.matches} حالة تاريخية مشابهة · متوسط التشابه ${fmt(a.cal.similarity,1)}% · وزن الدليل التاريخي ${fmt(a.final.alpha*100,0)}%</div></div>`:`<div class="p2d-note">المعايرة التاريخية غير كافية: ${esc(a.cal.reason)}</div>`}</article>`;}

  function ensureHost(){const view=document.getElementById('view-portfolio');if(!view)return null;let host=document.getElementById('p2PortfolioDeep');if(host)return host;host=document.createElement('article');host.id='p2PortfolioDeep';host.className='panel';const table=[...view.querySelectorAll('.panel')].find(p=>p.querySelector('#portfolioRows'));if(table)table.insertAdjacentElement('afterend',host);else view.appendChild(host);return host;}

  async function render(){const token=++renderToken,host=ensureHost();if(!host)return;ensureStyle();const hs=holdings();host.innerHTML=`<div class="p2d-head"><div><h2>التحليل الفني العميق للمحفظة</h2><p>Chart + Fibonacci + EMA/RSI/MACD + دعم/مقاومة + Walk‑Forward Calibration</p></div><span class="p2d-badge">P2 Deep Portfolio Engine</span></div>${hs.length?'<div class="p2d-empty">جارٍ تحليل مراكز المحفظة…</div>':'<div class="p2d-empty">لا توجد مراكز محفوظة للتحليل.</div>'}`;if(!hs.length)return;try{if(!marketMap.size){const m=await getJson(MARKET_URL);const rows=m?.rows||m?.stocks||[];marketMap=new Map(rows.map(x=>[String(x.symbol||x.ticker||'').toUpperCase(),x]));}const results=[];for(const h of hs){try{results.push(analyze(await history(h.ticker),h));}catch(e){results.push({ticker:h.ticker,error:e.message});}}if(token!==renderToken)return;const ok=results.filter(x=>!x.error),total=ok.reduce((s,x)=>s+x.value,0),agg=k=>total?ok.reduce((s,x)=>s+x.final[k]*(x.value/total),0):0;host.innerHTML=`<div class="p2d-head"><div><h2>التحليل الفني العميق للمحفظة</h2><p>تحليل كل سهم ثم تجميع السيناريوهات بحسب وزن المركز.</p></div><span class="p2d-badge">${ok.length}/${hs.length} سهم محلل</span></div>${ok.length?`<div class="p2d-summary">${metric('صاعد للمحفظة',`${fmt(agg('bull'),1)}%`)}${metric('عرضي',`${fmt(agg('side'),1)}%`)}${metric('هابط',`${fmt(agg('bear'),1)}%`)}${metric('قيمة المراكز',fmt(total,0),'ج.م')}</div>`:''}<div class="p2d-note">النسب ترجيحات فنية/تاريخية مبنية على الأدلة وليست ضمانًا أو أمر تنفيذ.</div>${ok.map(a=>card(a,total?a.value/total*100:0)).join('')}${results.filter(x=>x.error).map(x=>`<div class="p2d-note">${esc(x.ticker)}: تعذر التحليل — ${esc(x.error)}</div>`).join('')}`;}catch(e){host.innerHTML+=`<div class="p2d-note">تعذر تشغيل المحرك: ${esc(e.message||e)}</div>`;}}

  function schedule(delay=250){clearTimeout(timer);timer=setTimeout(render,delay);}
  function boot(){ensureStyle();let tries=0;const mount=()=>{if(ensureHost()){schedule(50);const rows=document.getElementById('portfolioRows');if(rows&&!rows.dataset.p2DeepWatch){rows.dataset.p2DeepWatch='1';new MutationObserver(()=>schedule(300)).observe(rows,{childList:true,subtree:true});}document.querySelector('[data-view="portfolio"]')?.addEventListener('click',()=>schedule(80));document.addEventListener('click',e=>{if(e.target.closest('#addPortfolioBtn,#clearPortfolioBtn,[data-r],#saSavePosition,#saOwnedYes,#saOwnedNo'))schedule(350);});}else if(tries++<80)setTimeout(mount,200);};mount();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
