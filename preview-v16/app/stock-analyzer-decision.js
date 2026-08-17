(()=>{
  'use strict';
  if(window.__MAIN_APP_STOCK_DECISION_LAYER__)return;
  window.__MAIN_APP_STOCK_DECISION_LAYER__=true;

  const BASE=new URL('../../',location.href);
  const HISTORY_URL=t=>new URL(`data/history/${encodeURIComponent(t)}.json`,BASE).href;
  const PORTFOLIO_KEY='egx-main-app-stock-analyzer-portfolio-v1';
  const num=v=>Number.isFinite(Number(v))?Number(v):null;
  const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:d}):'—';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cache=new Map();
  let observer=null,timer=null,lastSignature='';

  async function json(url){const r=await fetch(`${url}${url.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}
  function portfolio(){try{return JSON.parse(localStorage.getItem(PORTFOLIO_KEY)||'{}')||{};}catch{return{};}}
  function ema(values,p){if(values.length<p)return null;const k=2/(p+1);let x=mean(values.slice(0,p));for(let i=p;i<values.length;i++)x=values[i]*k+x*(1-k);return x;}
  function rsi(values,p=14){if(values.length<=p)return null;let g=0,l=0;for(let i=values.length-p;i<values.length;i++){const d=values[i]-values[i-1];if(d>=0)g+=d;else l-=d;}if(l===0)return 100;const rs=(g/p)/(l/p);return 100-(100/(1+rs));}
  function atr(rows,p=14){if(rows.length<=p)return null;const t=[];for(let i=1;i<rows.length;i++){const h=num(rows[i].high),lo=num(rows[i].low),pc=num(rows[i-1].close);if([h,lo,pc].every(Number.isFinite))t.push(Math.max(h-lo,Math.abs(h-pc),Math.abs(lo-pc)));}return t.length>=p?mean(t.slice(-p)):null;}
  function swings(rows){const s=[],r=[];for(let i=2;i<rows.length-2;i++){const lo=num(rows[i].low),hi=num(rows[i].high);if(lo!==null&&lo<=num(rows[i-1].low)&&lo<=num(rows[i-2].low)&&lo<=num(rows[i+1].low)&&lo<=num(rows[i+2].low))s.push(lo);if(hi!==null&&hi>=num(rows[i-1].high)&&hi>=num(rows[i-2].high)&&hi>=num(rows[i+1].high)&&hi>=num(rows[i+2].high))r.push(hi);}return{s,r};}
  function cluster(levels,t=.012){const a=levels.filter(Number.isFinite).sort((x,y)=>x-y),out=[];for(const x of a){const c=out.at(-1);if(!c||Math.abs(x-c.m)/c.m>t)out.push({m:x,v:[x]});else{c.v.push(x);c.m=mean(c.v);}}return out.map(x=>x.m);}
  function tickerFromResults(){
    const b=document.querySelector('#saResults .sa-summary .sa-box b');
    if(b){const t=String(b.textContent||'').split('·')[0].trim().toUpperCase();if(t)return t;}
    const h=document.querySelector('#saResults h2,#saResults h3');
    const m=String(h?.textContent||'').match(/\b[A-Z]{3,6}\b/);return m?.[0]||null;
  }
  async function history(t){if(!cache.has(t))cache.set(t,json(HISTORY_URL(t)));return cache.get(t);}
  function metrics(doc){
    const rows=(doc?.sessions||[]).filter(r=>[r.close,r.high,r.low].every(v=>Number.isFinite(Number(v)))).sort((a,b)=>String(a.date||a.sessionDate||'').localeCompare(String(b.date||b.sessionDate||'')));
    if(rows.length<30)throw Error('بيانات تاريخية غير كافية');
    const closes=rows.map(r=>Number(r.close)),price=closes.at(-1),e20=ema(closes,20),e50=ema(closes,50),r14=rsi(closes),a14=atr(rows),sw=swings(rows.slice(-100));
    const supports=cluster(sw.s).filter(x=>x<price).sort((a,b)=>b-a),resistances=cluster(sw.r).filter(x=>x>price).sort((a,b)=>a-b);
    const support=supports[0]??(Number.isFinite(e50)?e50:price-(a14||price*.025));
    const resistance=resistances[0]??price+(a14||price*.025);
    const stop=Number.isFinite(support)?support-(a14||price*.02)*.35:price-(a14||price*.025);
    return{rows,price,e20,e50,rsi:r14,atr:a14,support,resistance,stop,support2:supports[1]??null,resistance2:resistances[1]??null};
  }
  function decide(t,m){
    const pos=portfolio()[t]||{};const owned=pos.owned===true||num(pos.avgCost)!==null||num(pos.quantity)>0;const cost=num(pos.avgCost),p=m.price;
    const pnl=owned&&cost?((p/cost)-1)*100:null;
    const trendUp=Number.isFinite(m.e20)&&Number.isFinite(m.e50)&&p>m.e20&&m.e20>=m.e50;
    const trendDown=Number.isFinite(m.e20)&&Number.isFinite(m.e50)&&p<m.e20&&m.e20<=m.e50;
    const nearSupport=Number.isFinite(m.support)&&p>=m.support&&p/m.support-1<=.035;
    const nearResistance=Number.isFinite(m.resistance)&&m.resistance>=p&&m.resistance/p-1<=.035;
    const brokeSupport=Number.isFinite(m.support)&&p<m.support*.992;
    let action='مراقبة',tone='neutral',why='انتظر اقتراب السعر من دعم واضح أو اختراق مقاومة بسيولة.';
    if(!owned){
      if(trendUp&&nearSupport&&m.rsi<70){action='فرصة دخول مشروطة';tone='positive';why='اتجاه صاعد والسعر قريب من دعم؛ الدخول مشروط بثبات الدعم والسيولة.';}
      else if(trendUp&&!nearResistance){action='مراقبة إيجابية';tone='positive';why='الاتجاه إيجابي لكن الأفضل انتظار نقطة دخول أفضل بدل مطاردة السعر.';}
      else if(nearResistance||m.rsi>=75){action='انتظار / لا تطارد السعر';tone='warning';why='السعر قريب من مقاومة أو الزخم مرتفع؛ الأفضل انتظار تهدئة أو اختراق مؤكد.';}
      else if(trendDown){action='تجنب مؤقتًا';tone='negative';why='الاتجاه القصير والمتوسط ضعيف حتى تظهر إشارة انعكاس أو استعادة المتوسطات.';}
    }else{
      if(brokeSupport||trendDown&&(pnl??0)<-5){action='بيع / خفض مخاطرة';tone='negative';why='كسر دعم أو اتجاه هابط مع ضعف المركز؛ الأولوية لحماية رأس المال.';}
      else if(nearResistance&&m.rsi>=68){action='تخفيف جزئي';tone='warning';why='السعر قريب من مقاومة والزخم مرتفع؛ يمكن تأمين جزء من الأرباح.';}
      else if(trendUp&&nearSupport&&m.rsi<68){action='زيادة تدريجية مشروطة';tone='positive';why='الاتجاه إيجابي والسعر قريب من دعم؛ الزيادة فقط مع ثبات الدعم وعدم ضعف السيولة.';}
      else if(trendUp){action='احتفاظ';tone='positive';why='الهيكل الفني ما زال إيجابيًا طالما لم يُكسر مستوى الإلغاء.';}
      else{action='احتفاظ بحذر';tone='neutral';why='لا يوجد كسر حاسم ولا قوة كافية للزيادة؛ راقب الدعم والمقاومة.';}
    }
    const invalidation=m.stop;
    const nearestTarget=m.resistance;
    return{owned,cost,pnl,action,tone,why,invalidation,nearestTarget,trendUp,trendDown};
  }
  function ensureStyle(){if(document.getElementById('stockDecisionStyle'))return;const s=document.createElement('style');s.id='stockDecisionStyle';s.textContent=`
    .sa-decision-card{grid-column:1/-1;display:grid;grid-template-columns:minmax(180px,.8fr) 1.6fr repeat(3,minmax(120px,.55fr));gap:10px;align-items:stretch;padding:13px;border-radius:14px;border:1px solid #3a6578;background:#081d29;margin:0 0 12px}
    .sa-decision-card.positive{border-color:#2d8b67;background:linear-gradient(135deg,#0b2b23,#081d29)}.sa-decision-card.warning{border-color:#9c7635;background:linear-gradient(135deg,#302711,#081d29)}.sa-decision-card.negative{border-color:#a64a55;background:linear-gradient(135deg,#35191e,#081d29)}
    .sa-decision-main small,.sa-decision-metric small{display:block;color:#8ca9b8;font-size:11px;margin-bottom:5px}.sa-decision-main b{font-size:22px;line-height:1.25;color:#f2fbff}.sa-decision-copy{font-size:13px;line-height:1.65;color:#bad1dc;display:flex;align-items:center}.sa-decision-metric{padding:9px 10px;border:1px solid #24495b;border-radius:10px;background:#061721}.sa-decision-metric b{font-size:15px;color:#f0f9fd}.sa-decision-chip{display:inline-flex;margin-top:6px;padding:4px 7px;border-radius:999px;background:#163647;color:#cfeaf5;font-size:10px;font-weight:700}
    .sa-open-chart{margin-top:9px;width:100%;border:1px solid #39718a;background:#0d3345;color:#e8f8ff;border-radius:10px;padding:9px 10px;font-weight:800;cursor:pointer;font-size:12px}.sa-open-chart:hover{background:#12475e}.sa-open-chart:focus{outline:2px solid #5fb9dc;outline-offset:2px}
    .tc-decision-line{stroke-width:2.4;stroke-dasharray:10 5;pointer-events:none}.tc-decision-line.invalidation{stroke:#ff6c77}.tc-decision-line.target{stroke:#65d4a1}.tc-decision-label{font-size:12px;font-weight:900;paint-order:stroke;stroke:#06141c;stroke-width:4px;stroke-linejoin:round;pointer-events:none}.tc-decision-label.invalidation{fill:#ff8790}.tc-decision-label.target{fill:#7de2b1}
    @media(max-width:900px){.sa-decision-card{grid-template-columns:1fr 1fr}.sa-decision-copy{grid-column:1/-1}}@media(max-width:560px){.sa-decision-card{grid-template-columns:1fr}.sa-decision-copy{grid-column:auto}.sa-decision-main b{font-size:20px}}
  `;document.head.appendChild(s);}
  function chartPriceScale(svg){
    const labels=[...svg.querySelectorAll('.tc-axis')].map(el=>({el,text:String(el.textContent||'').replace(/,/g,''),y:num(el.getAttribute('y'))})).filter(x=>Number.isFinite(Number(x.text))&&Number.isFinite(x.y)&&x.y<440);
    if(labels.length<2)return null;
    const pts=labels.map(x=>({v:Number(x.text),y:x.y})).sort((a,b)=>a.y-b.y),top=pts[0],bottom=pts.at(-1);if(top.v===bottom.v)return null;
    const yFor=v=>top.y+(top.v-v)/(top.v-bottom.v)*(bottom.y-top.y);return{yFor};
  }
  function annotateChart(d){
    const svg=document.querySelector('#saTechnicalChartSection svg.tc-svg');if(!svg)return;
    svg.querySelector('#tcDecisionOverlay')?.remove();const scale=chartPriceScale(svg);if(!scale)return;
    const ns='http://www.w3.org/2000/svg',g=document.createElementNS(ns,'g');g.id='tcDecisionOverlay';
    const add=(value,kind,label)=>{if(!Number.isFinite(value))return;const y=scale.yFor(value);if(!Number.isFinite(y)||y<25||y>440)return;const line=document.createElementNS(ns,'line');line.setAttribute('x1','66');line.setAttribute('x2','1045');line.setAttribute('y1',String(y));line.setAttribute('y2',String(y));line.setAttribute('class',`tc-decision-line ${kind}`);g.appendChild(line);const text=document.createElementNS(ns,'text');text.setAttribute('x','74');text.setAttribute('y',String(y-6));text.setAttribute('class',`tc-decision-label ${kind}`);text.textContent=`${label} ${fmt(value,4)}`;g.appendChild(text);};
    add(d.invalidation,'invalidation','إلغاء القرار');add(d.nearestTarget,'target','الهدف الأقرب');svg.appendChild(g);
  }
  async function renderDecision(){
    const ticker=tickerFromResults();if(!ticker)return;const section=document.getElementById('saTechnicalChartSection');if(!section)return;
    try{const doc=await history(ticker),m=metrics(doc),d=decide(ticker,m),sig=[ticker,d.action,d.invalidation,d.nearestTarget,d.cost,d.pnl].join('|');
      ensureStyle();let card=document.getElementById('saPortfolioDecisionCard');if(!card){card=document.createElement('div');card.id='saPortfolioDecisionCard';section.parentElement?.insertBefore(card,section);}card.className=`sa-decision-card ${d.tone}`;
      card.innerHTML=`<div class="sa-decision-main"><small>${d.owned?'قرار إدارة المركز':'قرار السهم'}</small><b>${esc(d.action)}</b><span class="sa-decision-chip">${d.owned?'في المحفظة':'خارج المحفظة'}</span></div><div class="sa-decision-copy">${esc(d.why)}</div><div class="sa-decision-metric"><small>إلغاء القرار</small><b>${fmt(d.invalidation,4)}</b></div><div class="sa-decision-metric"><small>الهدف الأقرب</small><b>${fmt(d.nearestTarget,4)}</b></div><div class="sa-decision-metric"><small>${d.owned&&d.cost?'أداء المركز':'السعر الحالي'}</small><b>${d.owned&&d.cost?`${fmt(d.pnl,1)}%`:fmt(m.price,4)}</b></div>`;
      annotateChart(d);lastSignature=sig;
    }catch(e){console.warn('MAIN APP portfolio decision unavailable:',e.message||e);}
  }
  function recommendationTicker(card){return String(card.querySelector('h3')?.textContent||'').trim().toUpperCase();}
  function decorateRecommendations(){
    document.querySelectorAll('#v169BasketPanel .v169-card').forEach(card=>{if(card.querySelector('.sa-open-chart'))return;const t=recommendationTicker(card);if(!/^[A-Z]{3,6}$/.test(t))return;const btn=document.createElement('button');btn.type='button';btn.className='sa-open-chart';btn.textContent='فتح الشارت الفني والتحليل الشامل';btn.dataset.ticker=t;btn.addEventListener('click',()=>openAnalyzer(t));card.appendChild(btn);});
  }
  function openAnalyzer(t){
    const panel=document.getElementById('stockAnalyzerPanel');if(!panel)return;
    const input=panel.querySelector('#saSearch,input[type="search"],input[type="text"]');if(input){input.value=t;input.dispatchEvent(new Event('input',{bubbles:true}));}
    const exact=[...panel.querySelectorAll('button')].find(b=>/تحليل|analy/i.test(b.textContent||''));if(exact)exact.click();
    panel.scrollIntoView({behavior:'smooth',block:'start'});
    setTimeout(()=>document.getElementById('saTechnicalChartSection')?.scrollIntoView({behavior:'smooth',block:'center'}),900);
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{decorateRecommendations();renderDecision();},120);}
  function init(){ensureStyle();decorateRecommendations();renderDecision();if(!observer){observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});}window.addEventListener('storage',e=>{if(e.key===PORTFOLIO_KEY)renderDecision();});document.addEventListener('change',e=>{if(e.target?.closest?.('#stockAnalyzerPanel'))setTimeout(renderDecision,200);});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
