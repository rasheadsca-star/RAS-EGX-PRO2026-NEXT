'use strict';
(function(){
  if(window.__ASTRA_PRO_ANALYTICS_BOOT__)return;
  window.__ASTRA_PRO_ANALYTICS_BOOT__=true;

  const $=s=>document.querySelector(s);
  const $$=s=>Array.from(document.querySelectorAll(s));
  const A=v=>Array.isArray(v)?v:[];
  const E=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const F=(v,d=2)=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v).toLocaleString('ar-EG',{maximumFractionDigits:d}):'—';
  const P=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?F(v,1)+'%':'—';
  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,Number(v)||0));
  const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  const S={history:new Map(),range:100,universe:null,ledger:null,summary:null,tickerPerf:null,app:null,loadToken:0,chartContext:null,universalInstalled:false};

  async function load(p){
    const r=await fetch(p+(p.includes('?')?'&':'?')+'pro='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw Error(p+' HTTP '+r.status);
    return r.json();
  }
  async function waitReady(){
    for(let i=0;i<150;i++){
      if(window.__ASTRA_G22_READY__&&window.__ASTRA_PERF_HISTORY__==='READY')return;
      await new Promise(r=>setTimeout(r,100));
    }
    throw Error('Astra base/performance UI not ready');
  }
  function addStyle(){
    if($('#astraProStyle'))return;
    const s=document.createElement('style');s.id='astraProStyle';
    s.textContent=
    '.pro-home{border-color:#3f7fa3;background:radial-gradient(circle at 85% 10%,#164765 0,#0b263b 28%,#081c2c 65%);position:relative;overflow:hidden}.pro-home:before{content:"PRO";position:absolute;left:16px;top:10px;font-size:64px;font-weight:900;color:#ffffff08;letter-spacing:4px}.pro-home-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap}.pro-home h2{font-size:22px;margin:0}.pro-home-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:14px 0}.pro-home-features{display:flex;gap:7px;flex-wrap:wrap}.pro-feature{padding:7px 9px;border:1px solid #3d708b;background:#0a2031;border-radius:999px;font-size:10px;color:#d9f1fb}.pro-cta{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.pro-live{border-color:#29966c!important;color:#bff8df!important}.pro-build{font-family:Consolas,monospace;font-size:9px;color:#8db2c5}.pro-command{border-color:#356e8c;background:linear-gradient(145deg,#0b2135,#0d2940)}'+
    '.pro-command-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.pro-command-head h2{margin:0 0 5px;font-size:19px}.pro-sub{color:#8faebe;font-size:11px;line-height:1.6}'+
    '.pro-balance{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin-top:13px}.pro-side{background:#081b2b;border:1px solid #285069;border-radius:12px;padding:11px}.pro-side b{display:block;font-size:24px;margin-top:5px}.pro-vs{font-weight:900;color:#8da9b8}.pro-track{height:9px;border-radius:99px;background:#163348;overflow:hidden;margin-top:8px}.pro-track i{display:block;height:100%}.pro-target i{background:#36d995}.pro-stop i{background:#ff6d7d}'+
    '.pro-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:10px}.pro-kpi{padding:10px;border-radius:11px;background:#091c2c;border:1px solid #29516a}.pro-kpi small{display:block;color:#8faebe;font-size:9px}.pro-kpi b{display:block;margin-top:5px;font-size:16px}.pro-kpi em{display:block;margin-top:4px;color:#6f91a4;font-style:normal;font-size:9px}'+
    '.pro-controls{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.pro-select{min-width:230px;background:#081b2b;border:1px solid #356982;color:#eef9ff;border-radius:9px;padding:9px 10px}.pro-btn{border:1px solid #315f79;background:#0d2a3e;color:#dff4ff;padding:8px 10px;border-radius:9px;cursor:pointer}.pro-btn.active{background:#15516f;border-color:#53b5de}.pro-btn.layer-on{box-shadow:inset 0 0 0 1px #7cc7e8}'+
    '.pro-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:10px}.pro-box{padding:10px;border-radius:11px;background:#091d2e;border:1px solid #28516a}.pro-box small{display:block;color:#8faebe;font-size:9px}.pro-box b{display:block;font-size:16px;margin-top:4px}.pro-box span{display:block;color:#708fa1;font-size:9px;margin-top:4px}'+
    '.sig-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;margin-top:10px}.sig-card{padding:10px;border:1px solid #2c5870;background:#081c2c;border-radius:11px}.sig-card small{color:#89a9ba;display:block;font-size:9px}.sig-card b{display:block;font-size:17px;margin-top:5px}.sig-meter{height:6px;background:#17364a;border-radius:99px;overflow:hidden;margin-top:7px}.sig-meter i{display:block;height:100%;background:linear-gradient(90deg,#ff6d7d,#ffc857,#36d995)}'+
    '.pro-chart-wrap{position:relative;overflow:auto;border:1px solid #264e65;border-radius:12px;background:#05131d;margin-top:10px}.pro-chart-svg{display:block;width:100%;min-width:1050px;height:auto}.pro-gridline{stroke:#173847;stroke-width:1}.pro-axis{fill:#7192a4;font-size:10px}.pro-up{fill:#35c58a;stroke:#35c58a}.pro-down{fill:#ea6c78;stroke:#ea6c78}.pro-wick{stroke-width:1}.pro-ema20{fill:none;stroke:#43b7f2;stroke-width:2}.pro-ema50{fill:none;stroke:#ffc857;stroke-width:2}.pro-sma200{fill:none;stroke:#b28cff;stroke-width:2}.pro-channel-fill{fill:#38bdf8;opacity:.08}.pro-channel-line{fill:none;stroke:#62c7f0;stroke-width:1.5;stroke-dasharray:7 5}.pro-channel-mid{fill:none;stroke:#62c7f0;stroke-width:1;opacity:.7}.pro-sup{stroke:#32cf9a;stroke-width:1.2;stroke-dasharray:4 4}.pro-res{stroke:#ffab57;stroke-width:1.2;stroke-dasharray:4 4}.pro-fib{stroke:#d58cff;stroke-width:1;stroke-dasharray:3 5;opacity:.75}.pro-entry{fill:#38bdf8;opacity:.10}.pro-stop{stroke:#ff6d7d;stroke-width:1.5;stroke-dasharray:8 5}.pro-target{stroke:#36d995;stroke-width:1.5;stroke-dasharray:2 4}.pro-vol-up{fill:#216a50}.pro-vol-down{fill:#713945}.pro-rsi{fill:none;stroke:#d18ef2;stroke-width:2}.pro-macd{fill:none;stroke:#48b9ef;stroke-width:1.7}.pro-signal{fill:none;stroke:#ffc857;stroke-width:1.7}.pro-macd-pos{fill:#2e8463}.pro-macd-neg{fill:#86414d}.pro-pane-title{fill:#a5c2d0;font-size:10px;font-weight:700}.pro-cross{stroke:#9bb7c5;stroke-width:1;stroke-dasharray:3 3;pointer-events:none}.pro-tooltip{position:absolute;display:none;z-index:6;pointer-events:none;background:#06131eee;border:1px solid #3d6d84;border-radius:9px;padding:8px 10px;color:#ecf8ff;font-size:10px;direction:ltr;box-shadow:0 8px 28px #0008;white-space:nowrap}'+
    '.pro-legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;color:#8faebe;font-size:10px}.pro-dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-left:4px}'+
    '.rr-wrap{position:relative;height:82px;margin-top:12px;background:#071a29;border:1px solid #294e64;border-radius:12px;padding:16px 18px}.rr-line{position:absolute;left:5%;right:5%;top:40px;height:6px;background:#1b4056;border-radius:99px}.rr-seg-risk{position:absolute;top:40px;height:6px;background:#ff6d7d}.rr-seg-reward{position:absolute;top:40px;height:6px;background:#36d995}.rr-mark{position:absolute;top:28px;width:2px;height:30px;background:#dff6ff}.rr-label{position:absolute;top:8px;transform:translateX(-50%);font-size:9px;white-space:nowrap}.rr-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:9px}'+
    '.pro-note{margin-top:9px;padding:9px 10px;border:1px solid #5d5131;background:#292318;border-radius:9px;color:#f3dfaa;font-size:10px;line-height:1.7}'+
    '@media(max-width:1100px){.pro-kpis,.pro-summary,.sig-grid{grid-template-columns:repeat(3,1fr)}.pro-home-kpis{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.pro-balance{grid-template-columns:1fr}.pro-vs{text-align:center}.pro-kpis,.pro-summary,.sig-grid,.pro-home-kpis{grid-template-columns:1fr 1fr}.rr-metrics{grid-template-columns:1fr 1fr}.pro-select{min-width:100%;width:100%}}@media(max-width:440px){.pro-kpis,.pro-summary,.sig-grid,.rr-metrics,.pro-home-kpis{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  function currentRecommendations(){
    const ds=S.app?.sourceDecision;
    return A(S.ledger?.records).filter(r=>ds&&r.decisionSnapshotId===ds.decisionSnapshotId&&r.semanticDecisionHash===ds.semanticDecisionHash&&r.sessionDate===ds.session);
  }
  function rateBlock(m){
    const pct=m&&m.pct!==null&&m.pct!==undefined&&m.pct!==''&&Number(m.denominator)>0&&Number.isFinite(Number(m.pct))?Number(m.pct):null;
    return {pct,n:m?.numerator??0,d:m?.denominator??0,label:m?.denominatorLabel||'—'};
  }
  function renderHomeUpgrade(){
    const host=$('#view-home');if(!host||$('#astraProHome'))return;
    const m=S.summary.metrics||{},t=rateBlock(m.target1HitRate),st=rateBlock(m.stopLossRate),ft=rateBlock(m.finalTargetRate);
    const recs=currentRecommendations().slice().sort((a,b)=>Number(a.rank)-Number(b.rank));
    const panel=document.createElement('div');panel.id='astraProHome';panel.className='panel pro-home';
    panel.innerHTML=
      '<div class="pro-home-head"><div><h2>Astra Professional Analytics</h2><div class="pro-sub">لوحة التحليل الاحترافي الجديدة أصبحت جزءًا من الواجهة الرئيسية · Candles · Channels · Signature · KPIs · Risk/Reward</div></div><div><span class="tag good pro-live">● LIVE</span> <span class="tag">PRO ANALYTICS v3</span><div class="pro-build">PRO-ANALYTICS-PRODUCTION</div></div></div>'+
      '<div class="pro-home-kpis">'+
        '<div class="pro-kpi"><small>T1 Hit Rate</small><b class="good">'+P(t.pct)+'</b><em>'+F(t.n,0)+' / '+F(t.d,0)+' '+E(t.label)+'</em></div>'+
        '<div class="pro-kpi"><small>Stop Loss Rate</small><b class="bad">'+P(st.pct)+'</b><em>'+F(st.n,0)+' / '+F(st.d,0)+' '+E(st.label)+'</em></div>'+
        '<div class="pro-kpi"><small>Final Target Rate</small><b>'+P(ft.pct)+'</b><em>'+F(ft.n,0)+' / '+F(ft.d,0)+' '+E(ft.label)+'</em></div>'+
        '<div class="pro-kpi"><small>Expectancy</small><b>'+P(m.expectancyPct)+'</b><em>resolved trades only</em></div>'+
      '</div>'+
      '<div class="pro-home-features">'+
        '<span class="pro-feature">🕯 Multi-Pane Candlesticks</span><span class="pro-feature">↗ Auto Price Channel</span><span class="pro-feature">✦ Technical Signature</span><span class="pro-feature">S/R + Fibonacci</span><span class="pro-feature">RSI + MACD + Volume</span><span class="pro-feature">Risk / Reward Visualizer</span>'+
      '</div>'+
      '<div class="pro-cta"><button class="btn good" id="proHomeTechnical">فتح Technical Lab</button><button class="btn" id="proHomePerformance">فتح Performance Command Center</button>'+
      recs.slice(0,3).map(r=>'<button class="btn" data-pro-home-ticker="'+E(r.ticker)+'">حلّل '+E(r.ticker)+'</button>').join('')+'</div>'+
      (t.d===0?'<div class="pro-note">مهم: توصيات اللقطة الحالية لم تدخل Entry بعد، لذلك نسب Target/Stop غير متاحة إحصائيًا حاليًا بدل إظهار 0% مضلل.</div>':'');
    host.prepend(panel);
    $('#proHomeTechnical').onclick=()=>document.querySelector('[data-view="technical"]')?.click();
    $('#proHomePerformance').onclick=()=>document.querySelector('[data-view="performance"]')?.click();
    $$('[data-pro-home-ticker]').forEach(b=>b.onclick=()=>{
      document.querySelector('[data-view="technical"]')?.click();
      const sel=$('#proTicker');if(sel){sel.value=b.dataset.proHomeTicker;sel.dispatchEvent(new Event('change'))}
    });
    const badges=document.querySelector('.badges');
    if(badges&&!$('#proBuildBadge'))badges.insertAdjacentHTML('afterbegin','<span class="badge good" id="proBuildBadge">PRO v3</span>');
    const nav=document.querySelector('[data-view="technical"]');
    if(nav){nav.textContent='Technical Lab · NEW';nav.style.fontWeight='900'}
  }

  function renderCommand(){
    const host=$('#view-performance');if(!host||$('#astraKpiCommand'))return;
    const m=S.summary.metrics||{},t=rateBlock(m.target1HitRate),st=rateBlock(m.stopLossRate);
    const activated=Number(m.activatedRecommendations)||0,t2Rate=activated?Number(m.target2Hit||0)/activated*100:null,finalRate=m.finalTargetRate?.pct??null;
    const balance=t.pct!==null&&st.pct!==null?t.pct-st.pct:null;
    const sample=t.d;
    const panel=document.createElement('div');panel.id='astraKpiCommand';panel.className='panel pro-command';
    panel.innerHTML=
      '<div class="pro-command-head"><div><h2>Performance Command Center</h2><div class="pro-sub">Astra-only outcomes · نفس المقامات الموثقة · لا يتم تحويل العينة غير المتاحة إلى 0%</div></div><span class="tag good">RECONCILED '+E(S.summary.reconciliation?.pass)+'</span></div>'+
      '<div class="pro-balance">'+
        '<div class="pro-side pro-target"><small>T1 Target Hit Rate</small><b class="good">'+P(t.pct)+'</b><span class="muted">'+F(t.n,0)+' / '+F(t.d,0)+' · '+E(t.label)+'</span><div class="pro-track"><i style="width:'+(t.pct===null?0:clamp(t.pct))+'%"></i></div></div>'+
        '<div class="pro-vs">TARGETS ↔ STOPS</div>'+
        '<div class="pro-side pro-stop"><small>Stop Loss Rate</small><b class="bad">'+P(st.pct)+'</b><span class="muted">'+F(st.n,0)+' / '+F(st.d,0)+' · '+E(st.label)+'</span><div class="pro-track"><i style="width:'+(st.pct===null?0:clamp(st.pct))+'%"></i></div></div>'+
      '</div>'+
      '<div class="pro-kpis">'+
        kpi('Target 2 Rate',t2Rate,activated?F(m.target2Hit,0)+' / '+F(activated,0)+' Activated':'requires activated sample',true)+
        kpi('Final Target Rate',finalRate,m.finalTargetRate?.denominator?F(m.finalTargetRate.numerator,0)+' / '+F(m.finalTargetRate.denominator,0)+' '+E(m.finalTargetRate.denominatorLabel):'requires activated sample',true)+
        kpi('Profit Factor',m.profitFactor,'closed trades')+
        kpi('Expectancy',m.expectancyPct,'per resolved trade',true)+
        kpi('Avg Winner',m.averageWinnerPct,'resolved winners',true)+
        kpi('Avg Loser',m.averageLoserPct,'resolved losers',true)+
        kpi('Avg Time → T1',m.averageTimeToT1,'sessions')+
        kpi('Avg Holding',m.averageHoldingSessions,'sessions')+
        kpi('Avg MFE',m.averageMfePct,m.mfeMeasuredCount?F(m.mfeMeasuredCount,0)+' daily-candle envelopes':'requires exact entry price',true)+
        kpi('Avg MAE',m.averageMaePct,m.maeMeasuredCount?F(m.maeMeasuredCount,0)+' daily-candle envelopes':'requires exact entry price',true)+
        kpi('Closed Trades',m.closedTrades,'resolved/closed')+
        kpi('Waiting Entry',m.waitingForEntry,'not failures')+
        kpi('Ambiguous',m.ambiguous,'excluded from W/L')+
        kpi('Target-Stop Edge',balance,balance===null?'requires activated sample':'percentage points',true)+
      '</div>'+
      '<div class="pro-note">'+(sample===0?'العينة الحالية لم تُفعّل أي توصية بعد؛ لذلك Target/Stop/Win/Loss تبقى غير متاحة إحصائيًا بدل إظهار صفر مضلل.':'مقارنة Target مقابل Stop تستخدم نفس Activated denominator، لذلك الفارق قابل للمقارنة مباشرة.')+'</div>'+
      '<div style="margin-top:12px"><div class="pro-command-head"><div><h3 style="margin:0">Performance by Ticker</h3><div class="pro-sub">كل سهم يفتح نفس Technical Chart الاحترافي مع الحفاظ على سياق صفحة الأداء</div></div><span class="tag">'+F(A(S.tickerPerf?.groups).length,0)+' tickers</span></div>'+
      '<div class="table" style="margin-top:8px;max-height:360px;overflow:auto"><table><thead><tr><th>Ticker</th><th>Issued</th><th>Activated</th><th>T1 Rate</th><th>Stop Rate</th><th>Expectancy</th></tr></thead><tbody id="astraTickerPerfRows">'+
      A(S.tickerPerf?.groups).map(g=>'<tr><td><b class="ticker">'+E(g.key)+'</b></td><td>'+F(g.metrics?.totalRecommendations,0)+'</td><td>'+F(g.metrics?.activatedRecommendations,0)+'</td><td>'+P(g.metrics?.target1HitRate?.pct)+'</td><td>'+P(g.metrics?.stopLossRate?.pct)+'</td><td>'+P(g.metrics?.expectancyPct)+'</td></tr>').join('')+
      '</tbody></table></div></div>';
    host.prepend(panel);
  }
  function kpi(label,value,note,isPct){
    let v='—';
    if(value!==null&&value!==undefined&&Number.isFinite(Number(value)))v=isPct?P(value):F(value,2);
    return '<div class="pro-kpi"><small>'+E(label)+'</small><b>'+E(v)+'</b><em>'+E(note)+'</em></div>';
  }

  function clean(doc){
    const cutoff=S.app?.sourceDecision?.session,seen=new Set();
    const rows=A(doc?.sessions||doc?.rows||doc).filter(x=>!cutoff||(x.date||x.sessionDate)<=cutoff).map(x=>({
      date:x.date||x.sessionDate,
      open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume)||0
    }));
    for(const r of rows){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||![r.open,r.high,r.low,r.close].every(v=>Number.isFinite(v)&&v>0)||r.high<Math.max(r.open,r.close,r.low)||r.low>Math.min(r.open,r.close,r.high)||seen.has(r.date))throw Error('Invalid or duplicate OHLC: '+r.date);
      seen.add(r.date);
    }
    return rows.sort((a,b)=>a.date.localeCompare(b.date));
  }
  function ema(vals,p){
    const out=Array(vals.length).fill(null);if(vals.length<p)return out;
    const k=2/(p+1);let cur=mean(vals.slice(0,p));out[p-1]=cur;
    for(let i=p;i<vals.length;i++){cur=vals[i]*k+cur*(1-k);out[i]=cur}
    return out;
  }
  function emaNullable(vals,p){
    const out=Array(vals.length).fill(null),pts=[];
    vals.forEach((v,i)=>{if(Number.isFinite(v))pts.push({i,v})});
    if(pts.length<p)return out;
    const k=2/(p+1);let cur=mean(pts.slice(0,p).map(x=>x.v));out[pts[p-1].i]=cur;
    for(let j=p;j<pts.length;j++){cur=pts[j].v*k+cur*(1-k);out[pts[j].i]=cur}
    return out;
  }
  function sma(vals,p){
    const out=Array(vals.length).fill(null);let sum=0;
    for(let i=0;i<vals.length;i++){sum+=vals[i];if(i>=p)sum-=vals[i-p];if(i>=p-1)out[i]=sum/p}
    return out;
  }
  function rsi(vals,p=14){
    const out=Array(vals.length).fill(null);if(vals.length<=p)return out;
    for(let i=p;i<vals.length;i++){
      let g=0,l=0;
      for(let j=i-p+1;j<=i;j++){const d=vals[j]-vals[j-1];if(d>=0)g+=d;else l-=d}
      const ag=g/p,al=l/p;out[i]=al===0?100:100-(100/(1+ag/al));
    }
    return out;
  }
  function macd(vals){
    const e12=ema(vals,12),e26=ema(vals,26),line=vals.map((_,i)=>Number.isFinite(e12[i])&&Number.isFinite(e26[i])?e12[i]-e26[i]:null);
    const signal=emaNullable(line,9),hist=line.map((v,i)=>Number.isFinite(v)&&Number.isFinite(signal[i])?v-signal[i]:null);
    return {line,signal,hist};
  }
  function atr(rows,p=14){
    if(rows.length<=p)return null;const tr=[];
    for(let i=1;i<rows.length;i++)tr.push(Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-rows[i-1].close),Math.abs(rows[i].low-rows[i-1].close)));
    return mean(tr.slice(-p));
  }
  function swings(rows){
    const sup=[],res=[];
    for(let i=2;i<rows.length-2;i++){
      const r=rows[i];
      if(r.low<=rows[i-1].low&&r.low<=rows[i-2].low&&r.low<=rows[i+1].low&&r.low<=rows[i+2].low)sup.push(r.low);
      if(r.high>=rows[i-1].high&&r.high>=rows[i-2].high&&r.high>=rows[i+1].high&&r.high>=rows[i+2].high)res.push(r.high);
    }
    return {sup,res};
  }
  function cluster(a,t=.012){
    const sorted=a.filter(Number.isFinite).sort((x,y)=>x-y),out=[];
    for(const x of sorted){
      const c=out[out.length-1];
      if(!c||Math.abs(x-c.m)/Math.max(c.m,.0001)>t)out.push({m:x,v:[x]});
      else{c.v.push(x);c.m=mean(c.v)}
    }
    return out.map(x=>x.m);
  }
  function levels(rows,price){
    const s=swings(rows.slice(-120));
    return {
      supports:cluster(s.sup).filter(x=>x<price).sort((a,b)=>b-a).slice(0,3),
      resistances:cluster(s.res).filter(x=>x>price).sort((a,b)=>a-b).slice(0,3)
    };
  }
  function fibonacci(rows){
    const d=rows.slice(-80);if(d.length<20)return null;
    let hi=-Infinity,lo=Infinity,hiI=-1,loI=-1;
    d.forEach((r,i)=>{if(r.high>hi){hi=r.high;hiI=i}if(r.low<lo){lo=r.low;loI=i}});
    if(!(hi>lo))return null;const rg=hi-lo,up=loI<hiI;
    return up?{direction:'UP',high:hi,low:lo,r382:hi-.382*rg,r500:hi-.5*rg,r618:hi-.618*rg,r786:hi-.786*rg,e1272:hi+.272*rg,e1618:hi+.618*rg}:{direction:'DOWN',high:hi,low:lo,r382:lo+.382*rg,r500:lo+.5*rg,r618:lo+.618*rg,r786:lo+.786*rg,e1272:lo-.272*rg,e1618:lo-.618*rg};
  }
  function channel(rows){
    const d=rows;if(d.length<20)return null;const n=d.length,xm=(n-1)/2,ym=mean(d.map(r=>r.close));
    let cov=0,vr=0;for(let i=0;i<n;i++){cov+=(i-xm)*(d[i].close-ym);vr+=(i-xm)*(i-xm)}
    const slope=vr?cov/vr:0,intercept=ym-slope*xm,pred=d.map((_,i)=>intercept+slope*i),res=d.map((r,i)=>r.close-pred[i]),sd=Math.sqrt(mean(res.map(x=>x*x))||0);
    const upper=pred.map(x=>x+2*sd),lower=pred.map(x=>x-2*sd),ssRes=res.reduce((s,x)=>s+x*x,0),ssTot=d.reduce((s,r)=>s+(r.close-ym)*(r.close-ym),0);
    const r2=ssTot?Math.max(0,1-ssRes/ssTot):0,last=d[n-1].close,width=upper[n-1]-lower[n-1],pos=width?((last-lower[n-1])/width)*100:50,slopePct=last?slope/last*100:0;
    return {pred,upper,lower,slope,slopePct,r2,position:pos,widthPct:last?width/last*100:null,direction:slopePct>.08?'RISING':slopePct<-.08?'FALLING':'SIDEWAYS',quality:r2>=.65?'STRONG':r2>=.4?'MEDIUM':'WEAK'};
  }
  function volumeRatio(rows,p=20){
    if(rows.length<p+1)return null;const latest=rows.at(-1).volume,avg=mean(rows.slice(-(p+1),-1).map(r=>r.volume));
    return avg?latest/avg:null;
  }
  function volumePercentile(v){
    const a=A(S.universe.records).filter(x=>x.active!==false&&Number.isFinite(Number(x.volume))).map(x=>Number(x.volume)).sort((x,y)=>x-y);
    if(!a.length||!Number.isFinite(v))return null;
    let lo=0;while(lo<a.length&&a[lo]<=v)lo++;return lo/a.length*100;
  }
  function signature(rows,ind,market){
    const last=rows.at(-1),close=last.close,prev=rows.at(-2)?.close||close;
    const signs=[];
    if(Number.isFinite(ind.ema20))signs.push(close>ind.ema20?1:-1);
    if(Number.isFinite(ind.ema50))signs.push(close>ind.ema50?1:-1);
    if(Number.isFinite(ind.ema20)&&Number.isFinite(ind.ema50))signs.push(ind.ema20>ind.ema50?1:-1);
    if(Number.isFinite(ind.sma200))signs.push(close>ind.sma200?1:-1);
    const trend=clamp(50+(signs.length?mean(signs):0)*45);
    const rsiAdj=Number.isFinite(ind.rsi)?(ind.rsi-50)*1.25:0,macdAdj=Number.isFinite(ind.macdHist)?(ind.macdHist>0?12:-12):0;
    const ret5=rows.length>5?(close/rows.at(-6).close-1)*100:0,ret20=rows.length>20?(close/rows.at(-21).close-1)*100:0;
    const momentum=clamp(50+rsiAdj+macdAdj+clamp(ret5*1.5,-10,10)+clamp(ret20*.6,-10,10));
    const structure=clamp(50+clamp((ind.channel?.slopePct||0)*90,-18,18)+(ind.channel?.position>50?8:-8)+(ind.channel?.position>100?8:0)+(ind.channel?.position<0?-8:0));
    const volume=clamp(50+(Number.isFinite(ind.relVol)?(ind.relVol-1)*28:0)+(close>=last.open?8:-8));
    const atrPct=Number.isFinite(ind.atr)?ind.atr/close*100:null;
    const volatility=atrPct===null?null:atrPct<=1?70:atrPct<=4?90:atrPct<=7?60:35;
    const liquidity=volumePercentile(Number(market?.volume));
    const dims=[
      ['Trend',trend],['Momentum',momentum],['Structure',structure],['Volume',volume],['Volatility Control',volatility],['Liquidity Proxy',liquidity]
    ];
    const available=dims.filter(x=>Number.isFinite(x[1])),score=available.length?mean(available.map(x=>x[1])):null;
    const label=score===null?'UNAVAILABLE':score>=75?'STRONG':score>=60?'CONSTRUCTIVE':score>=45?'MIXED':'WEAK';
    return {dims,score,label,ret5,ret20,atrPct};
  }
  function path(vals,x,y){
    let d='';vals.forEach((v,i)=>{if(!Number.isFinite(v))return;d+=(d?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1)+' '});return d.trim();
  }

  function renderLabShell(){
    const host=$('#view-technical');if(!host)return;
    const active=A(S.universe.records).filter(x=>x.active!==false);
    const recSet=new Set(currentRecommendations().map(x=>x.ticker));
    const sorted=active.slice().sort((a,b)=>(recSet.has(b.ticker)-recSet.has(a.ticker))||a.ticker.localeCompare(b.ticker));
    const preferred=sorted.find(x=>recSet.has(x.ticker)&&x.historyAvailable===true)||sorted.find(x=>x.historyAvailable===true)||sorted[0];
    host.innerHTML=
      '<div class="panel"><div class="pro-command-head"><div><h2>Technical Lab — Professional Analytics</h2><div class="pro-sub">Daily OHLC فقط · كل المؤشرات تفسيرية Display-only · لا تغيّر DecisionSnapshot أو Rank Astra</div></div><span class="tag good">ASTRA-NATIVE</span></div>'+
      '<div class="pro-controls" style="margin-top:12px"><select id="proTicker" class="pro-select">'+sorted.map(x=>'<option value="'+E(x.ticker)+'" '+(x.ticker===preferred?.ticker?'selected':'')+'>'+E(x.ticker)+' — '+E(x.companyNameAr||x.companyNameEn||'')+(recSet.has(x.ticker)?' ★ Astra':'')+'</option>').join('')+'</select>'+
      [30,60,100,200].map(n=>'<button class="pro-btn '+(n===100?'active':'')+'" data-pro-range="'+n+'">'+n+' جلسة</button>').join('')+
      '<button class="pro-btn" data-pro-range="9999">MAX</button></div></div>'+
      '<div id="proLabBody"></div>';
    $('#proTicker').onchange=()=>loadTicker($('#proTicker').value);
    $$('[data-pro-range]').forEach(b=>b.onclick=()=>{$$('[data-pro-range]').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.range=Number(b.dataset.proRange);loadTicker($('#proTicker').value)});
    if(preferred)loadTicker(preferred.ticker);
  }

  function renderTechnicalFallback(ticker,market,rec,reason){
    const out=$('#proLabBody');if(!out)return;
    const session=S.app?.sourceDecision?.session||market?.priceSession||'—';
    const regime=S.app?.decisionSnapshot?.regime;
    const stop=rec&&Number.isFinite(Number(rec.stopLoss))?F(rec.stopLoss,3):'—';
    const t1=rec&&Number.isFinite(Number(rec.targets?.[0]))?F(rec.targets[0],3):'—';
    out.innerHTML=
      '<div class="panel"><div class="pro-command-head"><div><h2>'+E(ticker)+' — Technical Lab</h2><div class="pro-sub">جلسة '+E(session)+' · بيانات السوق الحالية موثقة، لكن عمق Daily OHLC غير كافٍ لبناء الرسم الفني متعدد الجلسات.</div></div><span class="tag">NO SYNTHETIC CHART</span></div>'+
      '<div class="pro-summary">'+
        box('Validated Market Price',F(market?.price,3),E(market?.priceSession||session))+
        box('Decision Session',E(session),'certified snapshot')+
        box('Market Regime',E(regime?.regime||'—'),'regime score '+E(regime?.score??'—'))+
        box('Astra Status',rec?'RECOMMENDED TODAY':'NOT RECOMMENDED TODAY',rec?'Rank #'+E(rec.rank):'market universe')+
        box('Recommendation Entry',rec?(F(rec.entryPlan?.low,3)+' – '+F(rec.entryPlan?.high,3)):'—','distinct from current market price')+
        box('Astra Stop',stop,'immutable recommendation plan')+
        box('Astra T1',t1,'immutable recommendation plan')+
      '</div>'+
      '<div class="pro-note">'+E(reason)+' لا يتم اختلاق شموع أو مؤشرات فنية. '+(rec?('Astra Stop '+stop+' · Astra T1 '+t1):'')+'</div></div>';
  }

  async function loadTicker(ticker){
    const token=++S.loadToken,out=$('#proLabBody');if(!out)return;
    const market=A(S.universe.records).find(x=>x.ticker===ticker),rec=currentRecommendations().find(x=>x.ticker===ticker);
    if(!market){out.innerHTML='<div class="panel"><div class="notice bad">السهم غير موجود في الـAstra universe.</div></div>';return}
    if(market.historyAvailable!==true||Number(market.historySessions||0)<=0){
      renderTechnicalFallback(ticker,market,rec,'لا توجد Daily OHLC موثقة كافية لهذا السهم؛ لذلك Channel/Signature/MACD/RSI/Fibonacci غير متاحة حاليًا.');
      return;
    }
    out.innerHTML='<div class="panel"><div class="empty">جارٍ بناء التحليل الفني متعدد الطبقات…</div></div>';
    try{
      let doc=S.history.get(ticker);
      if(!doc){doc=await load('../../data/history/'+encodeURIComponent(ticker)+'.json');S.history.set(ticker,doc)}
      if(token!==S.loadToken)return;
      const rows=clean(doc);
      if(rows.length<30){renderTechnicalFallback(ticker,market,rec,'عدد جلسات Daily OHLC الموثقة أقل من 30 جلسة؛ لا يتم بناء تحليل فني ناقص.');return}
      renderTicker(ticker,market,rec,rows);
    }catch(e){
      if(token!==S.loadToken)return;
      renderTechnicalFallback(ticker,market,rec,'تعذر تحميل التاريخ الموثق: '+String(e?.message||e||'unknown'));
    }
  }

  function renderTicker(ticker,market,rec,allRows){
    const out=$('#proLabBody');if(!out)return;
    const closes=allRows.map(r=>r.close),e20=ema(closes,20),e50=ema(closes,50),s200=sma(closes,200),rs=rsi(closes),mc=macd(closes);
    const n=Math.min(allRows.length,S.range),start=allRows.length-n,rows=allRows.slice(start),last=rows.at(-1),lv=levels(allRows,last.close),fib=fibonacci(allRows),ch=channel(rows),a14=atr(allRows),rv=volumeRatio(allRows);
    const ind={ema20:e20.at(-1),ema50:e50.at(-1),sma200:s200.at(-1),rsi:rs.at(-1),macdLine:mc.line.at(-1),macdSignal:mc.signal.at(-1),macdHist:mc.hist.at(-1),atr:a14,relVol:rv,channel:ch};
    const sig=signature(allRows,ind,market);
    const name=market.companyNameAr||market.companyNameEn||'';
    out.innerHTML=
      '<div class="panel"><div class="pro-command-head"><div><h2>'+E(ticker)+' — '+E(name)+'</h2><div class="pro-sub">جلسة '+E(last.date)+' · '+F(rows.length,0)+' جلسة بالرسم · المصدر '+E(market.primarySource)+' · '+(rec?'ضمن توصيات Astra الحالية':'خارج قائمة Astra الحالية')+'</div></div><span class="tag '+(rec?'good':'')+'">'+(rec?'ASTRA CURRENT':'MARKET UNIVERSE')+'</span></div>'+
      '<div class="pro-summary">'+
        box('Validated Market Price',F(market?.price,3),E(market?.priceSession||S.app?.sourceDecision?.session||last.date))+
        box('Chart Latest Close',F(last.close,3),'Daily OHLC · '+E(last.date))+
        box('Decision Session',E(S.app?.sourceDecision?.session||'—'),'certified snapshot')+
        box('Market Regime',E(S.app?.decisionSnapshot?.regime?.regime||'—'),'regime score '+E(S.app?.decisionSnapshot?.regime?.score??'—'))+
        box('Astra Status',rec?'RECOMMENDED TODAY':'NOT RECOMMENDED TODAY',rec?'Rank #'+E(rec.rank):'market universe')+
        box('Recommendation Entry',rec?(F(rec.entryPlan?.low,3)+' – '+F(rec.entryPlan?.high,3)):'—','distinct from current market price')+
        box('Last Update',E(S.app?.generatedAt||S.app?.sourceDecision?.refreshedAt||'—'),'decision artifact')+
        box('Confidence',E(rec?.confidenceLabel||rec?.confidence||'Not calibrated'),'never presented as probability')+
        box('EMA20 / EMA50',F(ind.ema20,3)+' / '+F(ind.ema50,3),'trend')+
        box('RSI14',F(ind.rsi,1),ind.rsi>=70?'overbought zone':ind.rsi<=30?'oversold zone':'normal zone')+
        box('MACD Hist',F(ind.macdHist,4),ind.macdHist>0?'positive':'negative')+
        box('ATR14',F(ind.atr,3),P(sig.atrPct)+' of price')+
        box('Relative Volume',Number.isFinite(rv)?F(rv,2)+'×':'—','vs 20-session avg')+
        box('Channel',E(ch?.direction||'—'),ch?F(ch.slopePct,3)+'% / session':'—')+
        box('Channel Quality',E(ch?.quality||'—'),ch?'R² '+F(ch.r2,2):'—')+
        box('Channel Position',ch?P(ch.position):'—',ch?P(ch.widthPct)+' width':'—')+
        box('Support S1',F(lv.supports[0],3),'swing-cluster')+
        box('Resistance R1',F(lv.resistances[0],3),'swing-cluster')+
        box('Technical Signature',sig.score===null?'—':F(sig.score,0)+'/100',E(sig.label))+
      '</div>'+
      signatureHtml(sig)+
      '<div class="pro-controls" style="margin-top:12px"><span class="muted">Layers:</span>'+
        layerBtn('ema','EMA20/50')+layerBtn('sma','SMA200')+layerBtn('channel','Price Channel')+layerBtn('sr','S/R')+layerBtn('fib','Fibonacci')+layerBtn('astra','Astra Plan')+
      '</div>'+
      chartHtml(rows,{e20:e20.slice(start),e50:e50.slice(start),s200:s200.slice(start),rsi:rs.slice(start),macd:{line:mc.line.slice(start),signal:mc.signal.slice(start),hist:mc.hist.slice(start)},ch,lv,fib,rec})+
      riskReward(rec,last.close)+
      '<div class="pro-note">Technical Signature / Channel / EMA / RSI / MACD / ATR / Fibonacci هي طبقة تفسير فني مستقلة. لا تستخدم كـfallback ولا تعيد ترتيب توصيات Astra الحالية. القناة Regression Channel على الإغلاقات اليومية وليست ضمانًا لمسار السعر.</div></div>';
    bindLayers();
    bindChart(rows);
  }
  function box(l,v,n){return '<div class="pro-box"><small>'+E(l)+'</small><b>'+E(v)+'</b><span>'+E(n)+'</span></div>'}
  function signatureHtml(sig){
    return '<div class="sig-grid">'+sig.dims.map(d=>'<div class="sig-card"><small>'+E(d[0])+'</small><b>'+ (Number.isFinite(d[1])?F(d[1],0):'—') +'</b><div class="sig-meter"><i style="width:'+(Number.isFinite(d[1])?clamp(d[1]):0)+'%"></i></div></div>').join('')+'</div>';
  }
  function layerBtn(id,label){return '<button class="pro-btn layer-on" data-pa-layer="'+id+'">'+E(label)+'</button>'}

  function chartHtml(rows,o){
    const W=1180,H=830,L=72,R=62,PT=35,PB=430,VT=470,VB=555,RT=600,RB=675,MT=720,MB=795,plot=W-L-R,n=rows.length;
    const x=i=>L+(i+.5)*plot/n,cw=Math.max(2,Math.min(10,plot/n*.62));
    const vals=rows.flatMap(r=>[r.low,r.high]);
    if(o.ch){vals.push(...o.ch.upper,...o.ch.lower)}
    A(o.lv.supports).forEach(v=>vals.push(v));A(o.lv.resistances).forEach(v=>vals.push(v));
    if(o.fib)for(const k of ['r382','r500','r618','r786','e1272','e1618'])if(Number.isFinite(o.fib[k]))vals.push(o.fib[k]);
    if(o.rec){vals.push(o.rec.entryPlan?.low,o.rec.entryPlan?.high,o.rec.stopLoss,...A(o.rec.targets))}
    let min=Math.min(...vals.filter(Number.isFinite)),max=Math.max(...vals.filter(Number.isFinite)),pad=(max-min)*.06||rows.at(-1).close*.02;min-=pad;max+=pad;
    const y=v=>PT+(max-v)/(max-min)*(PB-PT),vm=Math.max(...rows.map(r=>r.volume),1),vy=v=>VB-(v/vm)*(VB-VT),ry=v=>RB-(v/100)*(RB-RT);
    const macVals=[...o.macd.line,...o.macd.signal,...o.macd.hist].filter(Number.isFinite),ma=Math.max(...macVals.map(Math.abs),.0001),my=v=>(RT?((MT+MB)/2-(v/ma)*(MB-MT)*.45):0);
    let grid='';
    for(let i=0;i<=5;i++){const yy=PT+i*(PB-PT)/5,val=max-i*(max-min)/5;grid+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'" class="pro-gridline"/><text x="'+(L-8)+'" y="'+(yy+4)+'" text-anchor="end" class="pro-axis">'+F(val,2)+'</text>'}
    let candles='',vol='',macBars='';
    rows.forEach((r,i)=>{
      const xx=x(i),up=r.close>=r.open,yo=y(r.open),yc=y(r.close),hh=Math.max(1,Math.abs(yo-yc));
      candles+='<g><line x1="'+xx+'" x2="'+xx+'" y1="'+y(r.high)+'" y2="'+y(r.low)+'" class="pro-wick '+(up?'pro-up':'pro-down')+'"/><rect x="'+(xx-cw/2)+'" y="'+Math.min(yo,yc)+'" width="'+cw+'" height="'+hh+'" rx="1" class="'+(up?'pro-up':'pro-down')+'"/></g>';
      vol+='<rect x="'+(xx-cw/2)+'" y="'+vy(r.volume)+'" width="'+cw+'" height="'+Math.max(1,VB-vy(r.volume))+'" class="'+(up?'pro-vol-up':'pro-vol-down')+'"/>';
      if(Number.isFinite(o.macd.hist[i])){const zero=(MT+MB)/2,yy=my(o.macd.hist[i]);macBars+='<rect x="'+(xx-cw/2)+'" y="'+Math.min(zero,yy)+'" width="'+cw+'" height="'+Math.max(1,Math.abs(zero-yy))+'" class="'+(o.macd.hist[i]>=0?'pro-macd-pos':'pro-macd-neg')+'"/>'}
    });
    let channelSvg='';
    if(o.ch){
      const up=o.ch.upper.map((v,i)=>x(i)+','+y(v)).join(' '),low=o.ch.lower.map((v,i)=>x(i)+','+y(v)).reverse().join(' ');
      channelSvg='<g class="pa-layer pa-channel"><polygon points="'+up+' '+low+'" class="pro-channel-fill"/><path d="'+path(o.ch.upper,x,y)+'" class="pro-channel-line"/><path d="'+path(o.ch.pred,x,y)+'" class="pro-channel-mid"/><path d="'+path(o.ch.lower,x,y)+'" class="pro-channel-line"/></g>';
    }
    const horiz=(v,label,cls,group)=>Number.isFinite(v)?'<g class="pa-layer '+group+'"><line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v)+'" y2="'+y(v)+'" class="'+cls+'"/><text x="'+(W-R-4)+'" y="'+(y(v)-4)+'" text-anchor="end" class="pro-axis">'+E(label)+' '+F(v,3)+'</text></g>':'';
    let sr='';A(o.lv.supports).forEach((v,i)=>sr+=horiz(v,'S'+(i+1),'pro-sup','pa-sr'));A(o.lv.resistances).forEach((v,i)=>sr+=horiz(v,'R'+(i+1),'pro-res','pa-sr'));
    let fib='';if(o.fib)[['38.2%',o.fib.r382],['50%',o.fib.r500],['61.8%',o.fib.r618],['78.6%',o.fib.r786],['127.2%',o.fib.e1272],['161.8%',o.fib.e1618]].forEach(a=>{if(a[1]>=min&&a[1]<=max)fib+=horiz(a[1],'Fib '+a[0],'pro-fib','pa-fib')});
    let astra='';
    if(o.rec){
      const el=Number(o.rec.entryPlan?.low),eh=Number(o.rec.entryPlan?.high);
      if(Number.isFinite(el)&&Number.isFinite(eh))astra+='<g class="pa-layer pa-astra"><rect x="'+L+'" y="'+y(Math.max(el,eh))+'" width="'+plot+'" height="'+Math.max(2,Math.abs(y(el)-y(eh)))+'" class="pro-entry"/></g>';
      astra+=horiz(Number(o.rec.stopLoss),'Astra Stop','pro-stop','pa-astra');
      A(o.rec.targets).forEach((v,i)=>astra+=horiz(Number(v),'Astra T'+(i+1),'pro-target','pa-astra'));
    }
    return '<div class="pro-chart-wrap"><div class="pro-tooltip" id="proTip"></div><svg id="proSvg" class="pro-chart-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Astra professional multi-pane technical chart">'+
      '<rect width="'+W+'" height="'+H+'" fill="#05131d"/>'+grid+
      '<text x="'+L+'" y="22" class="pro-pane-title">PRICE · Candlesticks / Trend / Channel / Levels</text>'+
      '<g>'+candles+'</g>'+channelSvg+
      '<g class="pa-layer pa-ema"><path d="'+path(o.e20,x,y)+'" class="pro-ema20"/><path d="'+path(o.e50,x,y)+'" class="pro-ema50"/></g>'+
      '<g class="pa-layer pa-sma"><path d="'+path(o.s200,x,y)+'" class="pro-sma200"/></g>'+sr+fib+astra+
      '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+(VT-12)+'" y2="'+(VT-12)+'" class="pro-gridline"/><text x="'+L+'" y="'+(VT-18)+'" class="pro-pane-title">VOLUME</text><g>'+vol+'</g>'+
      '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+(RT-12)+'" y2="'+(RT-12)+'" class="pro-gridline"/><text x="'+L+'" y="'+(RT-18)+'" class="pro-pane-title">RSI (14)</text><rect x="'+L+'" y="'+ry(70)+'" width="'+plot+'" height="'+(ry(30)-ry(70))+'" fill="#d18ef2" opacity=".05"/><line x1="'+L+'" x2="'+(W-R)+'" y1="'+ry(70)+'" y2="'+ry(70)+'" class="pro-gridline"/><line x1="'+L+'" x2="'+(W-R)+'" y1="'+ry(30)+'" y2="'+ry(30)+'" class="pro-gridline"/><path d="'+path(o.rsi,x,ry)+'" class="pro-rsi"/>'+
      '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+(MT-12)+'" y2="'+(MT-12)+'" class="pro-gridline"/><text x="'+L+'" y="'+(MT-18)+'" class="pro-pane-title">MACD (12,26,9)</text><line x1="'+L+'" x2="'+(W-R)+'" y1="'+((MT+MB)/2)+'" y2="'+((MT+MB)/2)+'" class="pro-gridline"/><g>'+macBars+'</g><path d="'+path(o.macd.line,x,my)+'" class="pro-macd"/><path d="'+path(o.macd.signal,x,my)+'" class="pro-signal"/>'+
      '<line id="proCross" x1="0" x2="0" y1="'+PT+'" y2="'+MB+'" class="pro-cross" style="display:none"/></svg></div>'+
      '<div class="pro-legend"><span><i class="pro-dot" style="background:#35c58a"></i>شموع صاعدة</span><span><i class="pro-dot" style="background:#ea6c78"></i>شموع هابطة</span><span><i class="pro-dot" style="background:#43b7f2"></i>EMA20</span><span><i class="pro-dot" style="background:#ffc857"></i>EMA50</span><span><i class="pro-dot" style="background:#b28cff"></i>SMA200</span><span><i class="pro-dot" style="background:#62c7f0"></i>Regression Channel</span><span><i class="pro-dot" style="background:#d18ef2"></i>RSI</span></div>';
  }

  function bindLayers(){
    $$('[data-pa-layer]').forEach(b=>b.onclick=()=>{
      const id=b.dataset.paLayer,on=b.classList.toggle('layer-on');
      $$('.pa-'+id).forEach(el=>el.style.display=on?'':'none');
    });
  }
  function bindChart(rows){
    const svg=$('#proSvg'),tip=$('#proTip'),cross=$('#proCross');if(!svg||!tip||!cross)return;
    svg.onmousemove=e=>{
      const rect=svg.getBoundingClientRect(),ratio=(e.clientX-rect.left)/rect.width,plotStart=72/1180,plotEnd=(1180-62)/1180;
      const p=(ratio-plotStart)/(plotEnd-plotStart);if(p<0||p>1)return;
      const i=Math.max(0,Math.min(rows.length-1,Math.floor(p*rows.length))),r=rows[i],xx=72+(i+.5)*(1180-72-62)/rows.length;
      cross.style.display='';cross.setAttribute('x1',xx);cross.setAttribute('x2',xx);
      tip.style.display='block';tip.style.left=Math.min(rect.width-210,Math.max(8,e.clientX-rect.left+12))+'px';tip.style.top='35px';
      tip.innerHTML=E(r.date)+'<br>O '+F(r.open,3)+' · H '+F(r.high,3)+' · L '+F(r.low,3)+' · C '+F(r.close,3)+'<br>Vol '+F(r.volume,0);
    };
    svg.onmouseleave=()=>{tip.style.display='none';cross.style.display='none'};
  }
  function riskReward(rec,price){
    if(!rec)return '<div class="panel" style="margin-top:12px"><div class="section-title"><div><h2>Risk / Reward Visualizer</h2><p>لا توجد خطة Astra حالية لهذا السهم.</p></div></div><div class="notice">التحليل الفني لا ينشئ Entry/Stop/Targets بديلة عن DecisionSnapshot.</div></div>';
    const entry=(Number(rec.entryPlan?.low)+Number(rec.entryPlan?.high))/2,stop=Number(rec.stopLoss),targets=A(rec.targets).map(Number).filter(Number.isFinite);
    if(!Number.isFinite(entry)||!Number.isFinite(stop)||!targets.length)return '';
    const vals=[stop,entry,...targets,price].filter(Number.isFinite),mn=Math.min(...vals),mx=Math.max(...vals),pad=(mx-mn)*.12||entry*.02,lo=mn-pad,hi=mx+pad,pos=v=>5+(v-lo)/(hi-lo)*90,risk=Math.abs(entry-stop),t1=targets[0],rr=risk?Math.abs(t1-entry)/risk:null;
    const mark=(v,l)=>'<div class="rr-mark" style="left:'+pos(v)+'%"></div><span class="rr-label" style="left:'+pos(v)+'%">'+E(l)+'</span>';
    return '<div class="panel" style="margin-top:12px"><div class="section-title"><div><h2>Risk / Reward Visualizer</h2><p>الخطة المعروضة من Astra Recommendation Record نفسه</p></div><span class="tag good">IMMUTABLE PLAN</span></div>'+
      '<div class="rr-wrap"><div class="rr-line"></div><div class="rr-seg-risk" style="left:'+Math.min(pos(stop),pos(entry))+'%;width:'+Math.abs(pos(entry)-pos(stop))+'%"></div><div class="rr-seg-reward" style="left:'+Math.min(pos(entry),pos(t1))+'%;width:'+Math.abs(pos(t1)-pos(entry))+'%"></div>'+
      mark(stop,'STOP '+F(stop,3))+mark(entry,'ENTRY '+F(entry,3))+targets.map((t,i)=>mark(t,'T'+(i+1)+' '+F(t,3))).join('')+'</div>'+
      '<div class="rr-metrics">'+box('Risk to Stop',P((entry-stop)/entry*100),'from entry mid')+box('Reward to T1',P((t1-entry)/entry*100),'from entry mid')+box('R:R to T1',Number.isFinite(rr)?'1 : '+F(rr,2):'—','reward / risk')+box('Current vs Entry',P((price-entry)/entry*100),'Daily close')+'</div></div>';
  }


  function activeViewName(){
    const v=document.querySelector('.view.active');
    return v?.id?.replace(/^view-/,'')||'home';
  }
  function tickerFromElement(el){
    // Prefer the explicit host identity. Falling back to textContent can fail
    // when a recommendation row starts with rank/Arabic/company text instead
    // of the ticker, which breaks keyboard and delegated click chart routing.
    const raw=String(
      el?.dataset?.chartTickerHost||
      el?.dataset?.chartTicker||
      el?.dataset?.ticker||
      el?.querySelector?.('.ticker')?.dataset?.chartTicker||
      el?.querySelector?.('.ticker')?.textContent||
      el?.textContent||
      ''
    ).trim().toUpperCase();
    const token=raw.match(/[A-Z0-9_.-]+/)?.[0]||'';
    return A(S.universe?.records).some(x=>String(x.ticker).toUpperCase()===token)?token:'';
  }
  function decorateTickers(root=document){
    const nodes=[];
    if(root?.matches?.('.ticker'))nodes.push(root);
    root?.querySelectorAll?.('.ticker').forEach(x=>nodes.push(x));
    for(const el of nodes){
      const ticker=tickerFromElement(el);
      if(!ticker)continue;
      el.dataset.chartTicker=ticker;
      el.title='Open '+ticker+' Technical Chart';
      const host=el.parentElement;
      if(host){
        host.dataset.chartTickerHost=ticker;
        host.setAttribute('role','button');
        host.setAttribute('tabindex','0');
        host.setAttribute('aria-label','Open '+ticker+' professional technical chart');
        host.title='Open '+ticker+' Technical Chart';
      }else{
        el.setAttribute('role','button');
        el.setAttribute('tabindex','0');
        el.setAttribute('aria-label','Open '+ticker+' professional technical chart');
      }
    }
  }
  function ensureUniversalStyle(){
    if($('#astraUniversalChartStyle'))return;
    const style=document.createElement('style');style.id='astraUniversalChartStyle';
    style.textContent='[data-chart-ticker-host],.ticker[data-chart-ticker]{cursor:pointer}.ticker[data-chart-ticker]{text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}[data-chart-ticker-host]:focus,.ticker[data-chart-ticker]:focus{outline:2px solid #62c7f0;outline-offset:3px;border-radius:4px}.pro-return-context{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px;padding:9px 11px;border:1px solid #315f79;border-radius:10px;background:#081b2b}.pro-return-context small{color:#8faebe}';
    document.head.appendChild(style);
  }
  function renderReturnContext(){
    const host=$('#view-technical'),body=$('#proLabBody');if(!host||!body)return;
    $('#proReturnContext')?.remove();
    const c=S.chartContext;if(!c||!c.view||c.view==='technical')return;
    const labels={home:'الرئيسية',recommendations:'التوصيات',search:'بحث السوق',portfolio:'المحفظة',history:'السجل',performance:'الأداء',health:'صحة النظام'};
    const bar=document.createElement('div');bar.id='proReturnContext';bar.className='pro-return-context';
    bar.innerHTML='<small>تم فتح الرسم من: <b>'+E(labels[c.view]||c.view)+'</b> · سيتم الحفاظ على موضعك السابق.</small><button class="pro-btn" id="proReturnContextBtn">← عودة</button>';
    body.before(bar);
    $('#proReturnContextBtn').onclick=()=>{
      const ctx=S.chartContext;S.chartContext=null;
      document.querySelector('[data-view="'+CSS.escape(ctx.view)+'"]')?.click();
      requestAnimationFrame(()=>window.scrollTo({top:Number(ctx.scrollY)||0,behavior:'instant'}));
    };
  }
  async function openStockChart(ticker){
    const symbol=String(ticker||'').trim().toUpperCase();
    const market=A(S.universe?.records).find(x=>String(x.ticker).toUpperCase()===symbol);
    if(!market)return false;
    const from=activeViewName();
    if(from!=='technical')S.chartContext={view:from,scrollY:window.scrollY,ticker:symbol};
    document.querySelector('[data-view="technical"]')?.click();
    const sel=$('#proTicker');
    if(sel&&Array.from(sel.options).some(o=>o.value===symbol))sel.value=symbol;
    await loadTicker(symbol);
    renderReturnContext();
    const h=$('#proLabBody h2');
    if(h){h.setAttribute('tabindex','-1');h.focus({preventScroll:true})}
    window.__ASTRA_LAST_OPENED_CHART__={ticker:symbol,from,session:S.app?.sourceDecision?.session||null};
    return true;
  }
  function installUniversalChartAction(){
    if(S.universalInstalled)return;
    S.universalInstalled=true;ensureUniversalStyle();
    window.openStockChart=openStockChart;
    decorateTickers(document);
    const observer=new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)decorateTickers(n)})));
    observer.observe(document.body,{subtree:true,childList:true});
    document.addEventListener('click',e=>{
      const el=e.target?.closest?.('[data-chart-ticker-host],.ticker[data-chart-ticker]');if(!el)return;
      const ticker=tickerFromElement(el);if(!ticker)return;
      e.preventDefault();e.stopImmediatePropagation();
      void openStockChart(ticker);
    },true);
    document.addEventListener('keydown',e=>{
      if(e.key!=='Enter'&&e.key!==' ')return;
      const el=e.target?.closest?.('[data-chart-ticker-host],.ticker[data-chart-ticker]');if(!el)return;
      const ticker=tickerFromElement(el);if(!ticker)return;
      e.preventDefault();e.stopImmediatePropagation();
      void openStockChart(ticker);
    },true);
  }

  async function boot(){
    try{
      await waitReady();addStyle();
      [S.summary,S.universe,S.ledger,S.tickerPerf,S.app]=await Promise.all([
        load('./intelligence/performance-summary.json'),
        load('./intelligence/market-universe.json'),
        load('./intelligence/recommendation-ledger.json'),
        load('./intelligence/ticker-performance.json'),
        load('./data.json')
      ]);
      renderHomeUpgrade();renderCommand();renderLabShell();installUniversalChartAction();
      window.__ASTRA_PRO_ANALYTICS__='READY';
    }catch(e){
      console.error('ASTRA_PRO_ANALYTICS_FAILED',e);
      const h=$('#view-technical');if(h)h.innerHTML='<div class="panel"><div class="notice bad">Professional Analytics unavailable: '+E(e.message||e)+'</div></div>';
      window.__ASTRA_PRO_ANALYTICS__='UNAVAILABLE';
    }
  }
  boot();
})();