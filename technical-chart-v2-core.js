(function(global){
'use strict';

const DATE_RE=/^\d{4}-\d{2}-\d{2}/;
const DEFAULTS={period:100,sma20:true,sma50:true,channel:true,fibonacci:true,volume:true,rsi:true,plans:true};
const chartState=new Map();

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function average(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function stddev(a){const m=average(a);if(m==null)return null;return Math.sqrt(average(a.map(v=>(v-m)**2))||0)}
function fmt(v,d=2){return Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'—'}
function pctFmt(v){return Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${fmt(v,2)}%`:'—'}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function normalizeBars(rows){
  return (Array.isArray(rows)?rows:[]).map((r,i)=>{
    const close=finite(r.close??r.price??r.last);let open=finite(r.open),high=finite(r.high),low=finite(r.low);
    if(close==null||close<=0)return null;
    if(open==null||open<=0)open=close;
    if(high==null||high<=0)high=Math.max(open,close);
    if(low==null||low<=0)low=Math.min(open,close);
    high=Math.max(high,open,close,low);low=Math.min(low,open,close,high);
    return {index:i,session:String(r.session??r.date??r.marketSessionDate??r.sourceSessionDate??''),open,high,low,close,volume:Math.max(0,finite(r.volume)??0),raw:r};
  }).filter(Boolean);
}

function sma(values,period){
  const out=Array(values.length).fill(null);let sum=0,valid=0;
  for(let i=0;i<values.length;i++){
    const v=finite(values[i]);if(v!=null){sum+=v;valid++}
    if(i>=period){const old=finite(values[i-period]);if(old!=null){sum-=old;valid--}}
    if(i>=period-1&&valid===period)out[i]=sum/period;
  }
  return out;
}

function rsi(values,period=14){
  const out=Array(values.length).fill(null);if(values.length<=period)return out;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}
  gain/=period;loss/=period;out[period]=loss===0?100:100-(100/(1+gain/loss));
  for(let i=period+1;i<values.length;i++){
    const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;out[i]=loss===0?100:100-(100/(1+gain/loss));
  }
  return out;
}

function regressionChannel(values,lookback=60,mult=2){
  const n=Math.min(lookback,values.length);if(n<10)return null;const y=values.slice(-n).map(Number);if(y.some(v=>!Number.isFinite(v)))return null;
  const xm=(n-1)/2,ym=average(y);let num=0,den=0;for(let i=0;i<n;i++){num+=(i-xm)*(y[i]-ym);den+=(i-xm)**2}
  const slope=den?num/den:0,intercept=ym-slope*xm,fit=y.map((_,i)=>intercept+slope*i),sd=stddev(y.map((v,i)=>v-fit[i]))||0;
  return {lookback:n,slope,intercept,sd,center:fit,upper:fit.map(v=>v+mult*sd),lower:fit.map(v=>v-mult*sd),startIndex:values.length-n};
}

function fibonacci(bars,lookback=60){
  const x=bars.slice(-Math.min(lookback,bars.length));if(!x.length)return null;const hi=Math.max(...x.map(b=>b.high)),lo=Math.min(...x.map(b=>b.low));if(!(hi>lo))return null;
  const range=hi-lo;const ratios=[0,0.236,0.382,0.5,0.618,0.786,1];return {high:hi,low:lo,levels:ratios.map(r=>({ratio:r,value:hi-range*r}))};
}

function pivotLevels(bars,wing=2){
  if(!bars.length)return {supports:[],resistances:[]};const close=bars.at(-1).close,lows=[],highs=[];
  for(let i=wing;i<bars.length-wing;i++){
    const b=bars[i];let isLow=true,isHigh=true;
    for(let j=i-wing;j<=i+wing;j++){if(j===i)continue;if(b.low>bars[j].low)isLow=false;if(b.high<bars[j].high)isHigh=false}
    if(isLow)lows.push(b.low);if(isHigh)highs.push(b.high);
  }
  const uniq=(arr)=>{const out=[];for(const v of arr){if(!out.some(x=>Math.abs(x-v)/Math.max(1,Math.abs(v))<0.003))out.push(v)}return out};
  let supports=uniq(lows.filter(v=>v<close).sort((a,b)=>b-a)).slice(0,3),resistances=uniq(highs.filter(v=>v>close).sort((a,b)=>a-b)).slice(0,3);
  if(supports.length<2){supports=uniq([...supports,...bars.slice(-20).map(b=>b.low).filter(v=>v<close).sort((a,b)=>b-a)]).slice(0,3)}
  if(resistances.length<2){resistances=uniq([...resistances,...bars.slice(-20).map(b=>b.high).filter(v=>v>close).sort((a,b)=>a-b)]).slice(0,3)}
  return {supports,resistances};
}

function technicalSummary(bars,metrics={},plan=null){
  if(!bars.length)return {trend:'غير متاح',tone:'warn',headline:'لا توجد بيانات تاريخية كافية للتحليل الفني.',items:[]};
  const closes=bars.map(b=>b.close),last=bars.at(-1),s20=sma(closes,20).at(-1),s50=sma(closes,50).at(-1),r=rsi(closes,14).at(-1)??finite(metrics.rsi14),m20=finite(metrics.momentum20Pct)??(closes.length>20?(last.close/closes.at(-21)-1)*100:null),rvol=finite(metrics.relativeVolume20),levels=pivotLevels(bars),ch=regressionChannel(closes,Math.min(60,bars.length));
  let trend='عرضي / مختلط',tone='warn';
  if(s20!=null&&s50!=null&&last.close>s20&&s20>s50){trend='صاعد';tone='good'}else if(s20!=null&&s50!=null&&last.close<s20&&s20<s50){trend='هابط';tone='bad'}else if(s20!=null&&last.close>s20){trend='إيجابي قصير الأجل';tone='good'}else if(s20!=null&&last.close<s20){trend='ضغط قصير الأجل';tone='bad'}
  const rsiText=r==null?'RSI غير متاح':r>=70?`RSI ${fmt(r,1)} — تشبع شرائي نسبي`:r<=30?`RSI ${fmt(r,1)} — تشبع بيعي نسبي`:`RSI ${fmt(r,1)} — منطقة متوازنة`;
  const volText=rvol==null?'الحجم النسبي غير متاح':rvol>=1.5?`حجم نسبي قوي ${fmt(rvol,2)}x`:rvol<0.8?`الحجم النسبي ضعيف ${fmt(rvol,2)}x`:`الحجم النسبي طبيعي ${fmt(rvol,2)}x`;
  const slopePct=ch&&last.close?ch.slope/last.close*100:null;
  const support=levels.supports[0]??null,resistance=levels.resistances[0]??null;
  const items=[
    `الاتجاه: ${trend}${s20!=null?` · SMA20 ${fmt(s20,2)}`:''}${s50!=null?` · SMA50 ${fmt(s50,2)}`:''}`,
    rsiText,
    `Momentum 20: ${pctFmt(m20)} · ${volText}`,
    `أقرب دعم: ${fmt(support,4)} · أقرب مقاومة: ${fmt(resistance,4)}`,
    ch?`ميل قناة الانحدار: ${pctFmt(slopePct)} لكل جلسة · عرض 2σ ${fmt(ch.sd*2,4)}`:'قناة الانحدار غير متاحة'
  ];
  if(plan)items.push(`الخطة المنشورة كما هي: دخول ${fmt(plan.entryLow,4)}–${fmt(plan.entryHigh,4)} · وقف ${fmt(plan.stop,4)} · T1 ${fmt(plan.target1,4)} · T2 ${fmt(plan.target2,4)}`);
  const headline=`الصورة الفنية ${trend} عند إغلاق ${fmt(last.close,4)}. ${rsiText}. ${support!=null&&resistance!=null?`النطاق الأقرب بين ${fmt(support,4)} و${fmt(resistance,4)}.`:''}`;
  return {trend,tone,headline,items,sma20:s20,sma50:s50,rsi:r,momentum20:m20,rvol,levels,channel:ch};
}

function injectStyles(){if(document.getElementById('egxTechV2Styles'))return;const s=document.createElement('style');s.id='egxTechV2Styles';s.textContent=`
.techv2{margin-top:12px}.techv2-toolbar{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:9px 0}.techv2-toolbar button,.techv2-toolbar label{border:1px solid var(--line);background:#071522;color:var(--tx);border-radius:9px;padding:7px 9px;font-size:9px;font-weight:800;cursor:pointer}.techv2-toolbar button.active{background:#19375d;border-color:#62a9ff99}.techv2-toolbar label{display:flex;gap:5px;align-items:center}.techv2-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(320px,.5fr);gap:10px}.techv2-chart{height:430px;position:relative;background:#071522;border:1px solid var(--line);border-radius:13px;padding:8px}.techv2-rsi{height:135px;margin-top:8px;background:#071522;border:1px solid var(--line);border-radius:13px;padding:8px}.techv2-chart canvas,.techv2-rsi canvas{width:100%;height:100%}.techv2-tip{position:absolute;display:none;pointer-events:none;background:#06101eee;border:1px solid var(--line);border-radius:9px;padding:7px 9px;font-size:9px;z-index:4;direction:ltr;white-space:nowrap}.techv2-analysis{display:grid;gap:8px}.techv2-analysis .notice{font-size:11px}.techv2-list{margin:0;padding:0 17px 0 0;color:var(--m);font-size:10px;line-height:1.9}.techv2-levels{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}.techv2-legend{display:flex;gap:8px;flex-wrap:wrap;font-size:8px;color:var(--m);margin:6px 2px}.techv2-legend span:before{content:'●';margin-left:4px}.techv2-authority{border-color:#b99cff66;color:#d8caff}.techv2-empty{padding:35px;text-align:center;color:var(--m)}
@media(max-width:1000px){.techv2-grid{grid-template-columns:1fr}.techv2-chart{height:380px}}@media(max-width:620px){.techv2-chart{height:330px}.techv2-rsi{height:115px}.techv2-levels{grid-template-columns:1fr 1fr}}
`;document.head.appendChild(s)}

function cssVar(name,fallback){const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();return v||fallback}
function makeScale(min,max,a,b){const span=max-min||1;return v=>a+(v-min)/span*(b-a)}
function line(ctx,pts,color,width=1,dash=[]){if(!pts.length)return;ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();let moved=false;for(const p of pts){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;if(!moved){ctx.moveTo(p.x,p.y);moved=true}else ctx.lineTo(p.x,p.y)}ctx.stroke();ctx.restore()}
function hline(ctx,y,x1,x2,color,label,dash=[]){ctx.save();ctx.strokeStyle=color;ctx.setLineDash(dash);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=color;ctx.font='9px system-ui';ctx.fillText(label,x1+4,Math.max(10,y-3));ctx.restore()}

function drawPriceChart(canvas,bars,options,plan,hoverIndex=null){
  if(!canvas||!bars.length)return;const ctx=canvas.getContext('2d'),dpr=global.devicePixelRatio||1,w=Math.max(320,canvas.clientWidth),h=Math.max(220,canvas.clientHeight);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const m={l:56,r:16,t:16,b:options.volume?88:30},plotW=w-m.l-m.r,plotH=h-m.t-m.b,closes=bars.map(b=>b.close),s20=sma(closes,20),s50=sma(closes,50),ch=options.channel?regressionChannel(closes,Math.min(60,bars.length)):null,fib=options.fibonacci?fibonacci(bars,Math.min(60,bars.length)):null;
  const extra=[];if(plan&&options.plans)extra.push(plan.entryLow,plan.entryHigh,plan.stop,plan.target1,plan.target2);if(ch)extra.push(...ch.upper,...ch.lower);if(fib)extra.push(...fib.levels.map(x=>x.value));const min=Math.min(...bars.map(b=>b.low),...extra.filter(Number.isFinite)),max=Math.max(...bars.map(b=>b.high),...extra.filter(Number.isFinite)),pad=(max-min)*.05||1,lo=min-pad,hi=max+pad,y=makeScale(lo,hi,m.t+plotH,m.t),step=plotW/bars.length,candleW=clamp(step*.62,2,11);
  const lineCol=cssVar('--line','#243b5b'),muted=cssVar('--m','#91a7c2'),green=cssVar('--g','#47d59a'),red=cssVar('--r','#ff6d79'),blue=cssVar('--a','#62a9ff'),violet=cssVar('--v','#b99cff'),warn=cssVar('--w','#ffd166');
  ctx.save();ctx.strokeStyle=lineCol;ctx.lineWidth=.7;ctx.font='9px system-ui';ctx.fillStyle=muted;for(let i=0;i<=5;i++){const yy=m.t+plotH*i/5,val=hi-(hi-lo)*i/5;ctx.beginPath();ctx.moveTo(m.l,yy);ctx.lineTo(w-m.r,yy);ctx.stroke();ctx.fillText(fmt(val,2),4,yy+3)}ctx.restore();
  if(fib){for(const lv of fib.levels){const yy=y(lv.value);hline(ctx,yy,m.l,w-m.r,'#6b7890',`F${Math.round(lv.ratio*100)} ${fmt(lv.value,2)}`,[3,4])}}
  if(ch){const offset=bars.length-ch.lookback,toPts=arr=>arr.map((v,i)=>({x:m.l+(offset+i+.5)*step,y:y(v)}));line(ctx,toPts(ch.upper),violet,1,[5,4]);line(ctx,toPts(ch.center),violet,1.2);line(ctx,toPts(ch.lower),violet,1,[5,4])}
  if(options.sma20)line(ctx,s20.map((v,i)=>v==null?null:{x:m.l+(i+.5)*step,y:y(v)}),blue,1.5);
  if(options.sma50)line(ctx,s50.map((v,i)=>v==null?null:{x:m.l+(i+.5)*step,y:y(v)}),warn,1.5);
  for(let i=0;i<bars.length;i++){const b=bars[i],x=m.l+(i+.5)*step,up=b.close>=b.open,c=up?green:red;ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y(b.high));ctx.lineTo(x,y(b.low));ctx.stroke();const top=y(Math.max(b.open,b.close)),bottom=y(Math.min(b.open,b.close)),bh=Math.max(1,bottom-top);ctx.fillRect(x-candleW/2,top,candleW,bh)}
  if(plan&&options.plans){const eMid=(Number(plan.entryLow)+Number(plan.entryHigh))/2;hline(ctx,y(eMid),m.l,w-m.r,blue,`ENTRY ${fmt(plan.entryLow,2)}–${fmt(plan.entryHigh,2)}`,[5,3]);hline(ctx,y(plan.stop),m.l,w-m.r,red,`STOP ${fmt(plan.stop,2)}`,[7,3]);hline(ctx,y(plan.target1),m.l,w-m.r,green,`T1 ${fmt(plan.target1,2)}`,[7,3]);hline(ctx,y(plan.target2),m.l,w-m.r,green,`T2 ${fmt(plan.target2,2)}`,[2,3])}
  if(options.volume){const volTop=h-67,volH=48,vmax=Math.max(1,...bars.map(b=>b.volume));ctx.save();ctx.globalAlpha=.45;for(let i=0;i<bars.length;i++){const b=bars[i],x=m.l+(i+.5)*step,c=b.close>=b.open?green:red,bh=b.volume/vmax*volH;ctx.fillStyle=c;ctx.fillRect(x-candleW/2,volTop+volH-bh,candleW,bh)}ctx.restore();ctx.fillStyle=muted;ctx.font='8px system-ui';ctx.fillText('VOLUME',m.l,volTop-4)}
  const labelEvery=Math.max(1,Math.ceil(bars.length/6));ctx.fillStyle=muted;ctx.font='8px system-ui';ctx.textAlign='center';for(let i=0;i<bars.length;i+=labelEvery){const s=bars[i].session;ctx.fillText(DATE_RE.test(s)?s.slice(5,10):s,m.l+(i+.5)*step,h-8)}ctx.textAlign='start';
  if(Number.isInteger(hoverIndex)&&bars[hoverIndex]){const x=m.l+(hoverIndex+.5)*step;ctx.save();ctx.strokeStyle='#ffffff55';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,m.t);ctx.lineTo(x,m.t+plotH);ctx.stroke();ctx.restore()}
  canvas.__egxMeta={m,step,bars,lo,hi};
}

function drawRsiChart(canvas,bars){
  if(!canvas||!bars.length)return;const ctx=canvas.getContext('2d'),dpr=global.devicePixelRatio||1,w=Math.max(320,canvas.clientWidth),h=Math.max(90,canvas.clientHeight);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);const m={l:44,r:15,t:8,b:16},plotW=w-m.l-m.r,plotH=h-m.t-m.b,vals=rsi(bars.map(b=>b.close),14),step=plotW/bars.length,y=v=>m.t+(100-v)/100*plotH,lineCol=cssVar('--line','#243b5b'),muted=cssVar('--m','#91a7c2'),blue=cssVar('--a','#62a9ff');ctx.strokeStyle=lineCol;ctx.fillStyle=muted;ctx.font='8px system-ui';for(const lv of [70,50,30]){ctx.setLineDash(lv===50?[2,4]:[5,4]);ctx.beginPath();ctx.moveTo(m.l,y(lv));ctx.lineTo(w-m.r,y(lv));ctx.stroke();ctx.fillText(String(lv),8,y(lv)+3)}ctx.setLineDash([]);line(ctx,vals.map((v,i)=>v==null?null:{x:m.l+(i+.5)*step,y:y(v)}),blue,1.6);ctx.fillText('RSI 14',m.l,10)}

function authorityNote(){return `<div class="notice techv2-authority"><b>TECHNICAL VISUALIZATION V2</b> — قراءة وصفية فقط. لا تغيّر ranking أو recommendation أو Entry/Stop/Targets، ولا تمنح أي صلاحية تنفيذ.</div>`}

async function renderSymbolV2(query){
  injectStyles();const q=String(query||$('symbolSearch').value).trim(),up=q.toUpperCase();let s=symbol(up);if(!s)s=(UI?.symbols||[]).find(x=>(x.companyNameAr||'').includes(q)||(x.companyNameEn||'').toUpperCase().includes(up));if(!s){$('symbolArea').className='empty badtxt';$('symbolArea').textContent='السهم غير موجود في Research Universe الحالي.';return}
  let h=await load(`data/research/history/${s.ticker}.json`,true),all=normalizeBars((h?.sessions||[]).filter(x=>x.researchState==='READY_RESEARCH'||!x.researchState));if(!all.length){$('symbolArea').className='empty badtxt';$('symbolArea').textContent='لا توجد جلسات تاريخية صالحة للرسم والتحليل.';return}
  const st=chartState.get(s.ticker)||{...DEFAULTS};chartState.set(s.ticker,st);const bars=all.slice(-Math.min(st.period,all.length)),m=s.metrics||{},p=currentPlan(s.ticker),summary=technicalSummary(bars,m,p),levels=summary.levels;
  $('symbolArea').className='';$('symbolArea').innerHTML=`<div class="symbolhead"><div><div class="ticker">${esc(s.ticker)}</div><div class="name">${esc(s.displayName||s.companyNameEn||'')}</div></div><div><span class="badge ${s.featureReady?'good':'warn'}">${esc(s.state)}</span>${p?` <span class="badge ${p.decision==='BUY_CANDIDATE'?'good':'warn'}">${esc(p.decision)}</span>`:''}</div></div>${confidenceUI(s.ticker)}
  <div class="metrics section"><div class="mini"><span>CLOSE</span><b>${fmt(m.close,4)}</b></div><div class="mini"><span>MOMENTUM 20</span><b>${pctFmt(m.momentum20Pct)}</b></div><div class="mini"><span>RSI 14</span><b>${fmt(summary.rsi,1)}</b></div><div class="mini"><span>ATR %</span><b>${fmt(m.atrPct,2)}%</b></div><div class="mini"><span>RELATIVE VOLUME</span><b>${fmt(m.relativeVolume20,2)}x</b></div><div class="mini"><span>TREND</span><b class="${summary.tone==='good'?'goodtxt':summary.tone==='bad'?'badtxt':'warntxt'}">${esc(summary.trend)}</b></div></div>
  ${authorityNote()}<div class="techv2"><div class="techv2-toolbar"><span class="small">الفترة:</span>${[20,50,100,150].map(n=>`<button class="${st.period===n?'active':''}" onclick="EGXOneTechnicalV2.setPeriod('${esc(s.ticker)}',${n})">${n}</button>`).join('')}${[['sma20','SMA20'],['sma50','SMA50'],['channel','Price Channel'],['fibonacci','Fibonacci'],['volume','Volume'],['rsi','RSI'],['plans','الخطة']].map(([k,l])=>`<label><input type="checkbox" ${st[k]?'checked':''} onchange="EGXOneTechnicalV2.toggle('${esc(s.ticker)}','${k}',this.checked)">${l}</label>`).join('')}</div>
  <div class="techv2-grid"><div><div class="techv2-chart"><canvas id="techPriceCanvas"></canvas><div id="techTip" class="techv2-tip"></div></div>${st.rsi?'<div class="techv2-rsi"><canvas id="techRsiCanvas"></canvas></div>':''}<div class="techv2-legend"><span>شموع OHLC</span><span>SMA20</span><span>SMA50</span><span>Regression ±2σ</span><span>Fibonacci</span><span>Plan levels</span></div></div>
  <div class="techv2-analysis"><div class="notice ${summary.tone==='good'?'goodline':summary.tone==='bad'?'badline':''}"><b>القراءة الفنية:</b> ${esc(summary.headline)}</div><div class="panel"><div class="title"><h3>تحليل فني مختصر</h3><span>Research descriptive</span></div><ul class="techv2-list">${summary.items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div><div class="panel"><div class="title"><h3>مستويات فنية</h3><span>pivot-based</span></div><div class="techv2-levels"><div class="mini"><span>SUPPORT 1</span><b class="goodtxt">${fmt(levels.supports[0],4)}</b></div><div class="mini"><span>RESISTANCE 1</span><b class="warntxt">${fmt(levels.resistances[0],4)}</b></div><div class="mini"><span>SUPPORT 2</span><b class="goodtxt">${fmt(levels.supports[1],4)}</b></div><div class="mini"><span>RESISTANCE 2</span><b class="warntxt">${fmt(levels.resistances[1],4)}</b></div></div></div>${p?`<div class="notice">الخطة المنشورة: Entry ${fmt(p.entryLow,4)}–${fmt(p.entryHigh,4)} · Stop ${fmt(p.stop,4)} · T1 ${fmt(p.target1,4)} · T2 ${fmt(p.target2,4)} · Net RR ${fmt(p.netRiskReward,2)}</div>`:''}</div></div></div>`;
  const priceCanvas=$('techPriceCanvas'),rsiCanvas=$('techRsiCanvas');const redraw=(hover=null)=>{drawPriceChart(priceCanvas,bars,st,p,hover);if(st.rsi&&rsiCanvas)drawRsiChart(rsiCanvas,bars)};requestAnimationFrame(()=>redraw());
  priceCanvas.addEventListener('mousemove',ev=>{const meta=priceCanvas.__egxMeta;if(!meta)return;const rect=priceCanvas.getBoundingClientRect(),x=ev.clientX-rect.left,idx=clamp(Math.floor((x-meta.m.l)/meta.step),0,bars.length-1),b=bars[idx],tip=$('techTip');redraw(idx);tip.style.display='block';tip.style.left=`${clamp(x+10,8,rect.width-165)}px`;tip.style.top='10px';tip.innerHTML=`${esc(b.session||'#'+(idx+1))}<br>O ${fmt(b.open,4)} · H ${fmt(b.high,4)}<br>L ${fmt(b.low,4)} · C ${fmt(b.close,4)}<br>V ${fmt(b.volume,0)}`});priceCanvas.addEventListener('mouseleave',()=>{const tip=$('techTip');if(tip)tip.style.display='none';redraw()});
  global.__egxTechV2Last={ticker:s.ticker,redraw};
}

function rerender(ticker){const input=global.document&&document.getElementById('symbolSearch');if(input)input.value=ticker;return renderSymbolV2(ticker)}
function setPeriod(ticker,period){const st=chartState.get(ticker)||{...DEFAULTS};st.period=Number(period)||100;chartState.set(ticker,st);return rerender(ticker)}
function toggle(ticker,key,value){const st=chartState.get(ticker)||{...DEFAULTS};if(Object.hasOwn(DEFAULTS,key))st[key]=!!value;chartState.set(ticker,st);return rerender(ticker)}

const API={normalizeBars,sma,rsi,regressionChannel,fibonacci,pivotLevels,technicalSummary,drawPriceChart,drawRsiChart,renderSymbolV2,setPeriod,toggle,DEFAULTS};global.EGXOneTechnicalV2=API;
if(typeof document!=='undefined'){
  injectStyles();
  try{global.renderSymbol=renderSymbolV2}catch{}
  global.addEventListener('resize',()=>{if(global.__egxTechV2Last)global.__egxTechV2Last.redraw()});
}
})(typeof window!=='undefined'?window:globalThis);
