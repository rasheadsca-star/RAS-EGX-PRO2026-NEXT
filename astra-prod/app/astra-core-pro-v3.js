'use strict';
(() => {
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const N=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('ar-EG',{maximumFractionDigits:d}):'—';
  const P=v=>Number.isFinite(Number(v))?N(v,2)+'%':'—';
  const A=v=>Array.isArray(v)?v:[];
  const fmtDate=v=>v?String(v).slice(0,10):'—';
  const loadJson=async url=>{const r=await fetch(url+(url.includes('?')?'&':'?')+'cb='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw new Error(url+' HTTP '+r.status);return r.json()};
  const loadOptionalJson=async (name,url,fallback)=>{
    try{
      const value=await loadJson(url);
      state.bootSources[name]={status:'READY',url,error:null};
      return value;
    }catch(error){
      state.bootSources[name]={status:'UNAVAILABLE',url,error:String(error?.message||error)};
      console.warn('ASTRA_OPTIONAL_SOURCE_UNAVAILABLE',name,state.bootSources[name].error);
      return typeof fallback==='function'?fallback():fallback;
    }
  };
  const state={data:null,search:null,stocks:null,history:null,searchMap:new Map(),stockMap:new Map(),recMap:new Map(),portfolio:[],selected:null,historyDoc:null,bootSources:{}};
  const PORT_KEY='egx-astra-g22-portfolio';

  function nameOf(t){
    const s=state.searchMap.get(t)||state.stockMap.get(t)||{};
    return s.companyNameAr||s.companyNameEn||'';
  }
  function recs(){return A(state.data?.decisionSnapshot?.top5)}
  function basket(){return state.data?.decisionSnapshot?.basket||{}}
  function riskOf(o){return o?.risk||{}}
  function target(o,i=0){
    const t=A(o?.targets);
    if(typeof t[i]==='number')return t[i];
    const rt=A(riskOf(o)?.targets);
    return rt[i]??null;
  }
  function recCard(o){
    const r=riskOf(o),name=nameOf(o.ticker),entry=o.entryPlan||{},score=o.decisionScore??o.ranking?.score;
    return `<div class="rec-card">
      <div class="rank">#${E(o.rank)}</div>
      <div>
        <div class="rec-head"><div><h3><span class="ticker">${E(o.ticker)}</span> ${name?'— '+E(name):''}</h3><div class="muted">Astra DecisionSnapshot · score ترتيب مصدر، وليس احتمال نجاح</div></div><span class="tag good">فرصة قرار معتمدة</span></div>
        <div class="metrics">
          <div class="metric"><small>درجة القرار</small><b>${N(score,2)}</b></div>
          <div class="metric"><small>الدخول</small><b>${N(entry.low??r.entry,3)} – ${N(entry.high??r.entry,3)}</b></div>
          <div class="metric"><small>وقف الخسارة</small><b>${N(o.stopLoss??r.stopLoss,3)}</b></div>
          <div class="metric"><small>الهدف الأول</small><b>${N(target(o,0),3)}</b></div>
          <div class="metric"><small>التعرض</small><b>${P(r.exposurePct)}</b></div>
        </div>
      </div>
    </div>`;
  }

  function bootSourceNotice(){
    const bad=Object.entries(state.bootSources).filter(([,v])=>v?.status==='UNAVAILABLE');
    if(!bad.length)return '';
    return '<div class="notice" style="margin-bottom:12px"><b>تشغيل جزئي آمن:</b> قرار Astra الأساسي محمّل، لكن بعض مصادر العرض المساعدة غير متاحة على هذا الجهاز حاليًا: '+
      bad.map(([k,v])=>E(k)+' ('+E(v.error)+')').join(' · ')+
      '. لا يتم استخدام fallback لتغيير قرار Astra.</div>';
  }

  function renderHome(){
    const d=state.data,h=d.health,ds=d.decisionSnapshot,rs=basket(),rows=recs();
    $('#view-home').innerHTML=bootSourceNotice()+`
      <div class="grid cards">
        <div class="card"><small>حالة Astra</small><b class="good">${E(ds.status)}</b></div>
        <div class="card"><small>جلسة القرار</small><b>${E(d.sourceDecision.session)}</b></div>
        <div class="card"><small>فرص Astra الحالية</small><b class="blue">${rows.length}</b></div>
        <div class="card"><small>Decision Ready</small><b>${E(h.decisionReady?.pipelineReadySecurities??'—')}</b></div>
        <div class="card"><small>CRITICAL / HIGH</small><b class="${Number(h.criticalUnresolved)>0?'bad':Number(h.highUnresolved)>0?'warn':'good'}">${E(h.criticalUnresolved)} / ${E(h.highUnresolved)}</b></div>
        <div class="card"><small>Cash reserve</small><b>${P(rs.cashReservePct)}</b></div>
      </div>
      <div class="panel">
        <div class="section-title"><div><h2>أفضل فرص Astra</h2><p>الحد الأقصى 5؛ المعروض هو العدد الحقيقي الناتج من الـDecisionSnapshot.</p></div><span class="tag good">Snapshot exact rebuild</span></div>
        <div class="grid">${rows.length?rows.map(recCard).join(''):'<div class="empty">لا توجد فرص صالحة في اللقطة الحالية.</div>'}</div>
      </div>
      <div class="grid two">
        <div class="panel"><div class="section-title"><div><h2>حالة السوق والبيانات</h2></div></div>
          <div class="stock-grid">
            <div class="stock-box"><small>Active universe</small><b>${E(h.activeUniverse)}</b></div>
            <div class="stock-box"><small>Current canonical</small><b>${E(h.currentCanonical?.numerator)}/${E(h.currentCanonical?.denominator)}</b></div>
            <div class="stock-box"><small>Support / Resistance</small><b>${E(h.supportResistance?.bothAvailable?.numerator)}/${E(h.supportResistance?.bothAvailable?.denominator)}</b></div>
            <div class="stock-box"><small>Search ready</small><b>${E(h.searchReadiness?.resolvedActive)}/${E(h.searchReadiness?.intendedActive)}</b></div>
          </div>
        </div>
        <div class="panel"><div class="section-title"><div><h2>Morning Confirmation</h2></div></div>
          <div class="notice">لا يوجد MorningConfirmationRecord مستقل منشور داخل G22 لهذه اللقطة. لذلك لا يتم استنتاج CONFIRMED/CANCELLED من بيانات لاحقة. الحالة: <b>UNKNOWN / NOT PUBLISHED</b>.</div>
        </div>
      </div>`;
  }

  function renderRecommendations(){
    const rows=recs(),rs=basket();
    $('#view-recommendations').innerHTML=`
      <div class="panel">
        <div class="section-title"><div><h2>توصيات / فرص Astra الحالية</h2><p>كل صف مربوط بنفس DecisionSnapshot ID: <span class="mono">${E(state.data.sourceDecision.decisionSnapshotId)}</span></p></div><span class="tag good">No legacy fallback</span></div>
        <div class="table"><table><thead><tr><th>#</th><th>السهم</th><th>الدرجة</th><th>الدخول</th><th>وقف</th><th>هدف 1</th><th>هدف 2</th><th>Risk %</th><th>Exposure</th><th>Qty</th></tr></thead><tbody>
          ${rows.map(o=>{const r=riskOf(o),e=o.entryPlan||{};return `<tr><td>${E(o.rank)}</td><td><b class="ticker">${E(o.ticker)}</b><br>${E(nameOf(o.ticker))}</td><td>${N(o.decisionScore??o.ranking?.score,2)}</td><td>${N(e.low??r.entry,3)}–${N(e.high??r.entry,3)}</td><td>${N(o.stopLoss??r.stopLoss,3)}</td><td>${N(target(o,0),3)}</td><td>${N(target(o,1),3)}</td><td>${P(r.riskPct)}</td><td>${P(r.exposurePct)}<br><span class="muted">${N(r.exposureEgp,0)} ج</span></td><td>${N(r.quantity,0)}</td></tr>`}).join('')}
        </tbody></table></div>
      </div>
      <div class="grid three">
        <div class="card"><small>Basket members</small><b>${E(rs.memberCount)}</b></div>
        <div class="card"><small>Total exposure</small><b>${P(rs.totalExposurePct)}</b></div>
        <div class="card"><small>Cash reserve</small><b>${P(rs.cashReservePct)}</b></div>
      </div>
      <div class="panel"><div class="notice good">هذه هي الفرص الفعلية الناتجة من Astra snapshot المعتمد. إذا كان العدد أقل من 5 فلا يتم إنشاء أسهم إضافية لملء القائمة.</div></div>`;
  }

  function mergedStock(ticker){
    const s=state.searchMap.get(ticker)||{},x=state.stockMap.get(ticker)||{},r=state.recMap.get(ticker);
    return {ticker,...s,...x,currentAstra:r};
  }
  function renderSearchShell(){
    $('#view-search').innerHTML=`
      <div class="panel"><div class="section-title"><div><h2>بحث السوق الكامل</h2><p>الاسم/الرمز/aliases للبحث فقط؛ قرار Astra يأتي حصريًا من G22 snapshot.</p></div></div>
        <div class="searchbar"><input id="marketSearch" placeholder="اكتب اسم السهم أو الرمز..."><button class="btn" id="searchBtn">بحث</button></div>
        <div class="results" id="searchResults"></div>
      </div>
      <div id="stockDetail"></div>`;
    $('#marketSearch').addEventListener('input',doSearch);
    $('#searchBtn').onclick=doSearch;
  }
  function doSearch(){
    const q=String($('#marketSearch')?.value||'').trim().toLowerCase();
    const rows=A(state.search?.stocks).filter(s=>!q||String(s.searchText||[s.ticker,s.companyNameAr,s.companyNameEn].join(' ')).toLowerCase().includes(q)).slice(0,25);
    $('#searchResults').innerHTML=rows.length?rows.map(s=>{
      const r=state.recMap.get(s.ticker),x=state.stockMap.get(s.ticker)||s;
      return `<div class="result" data-stock="${E(s.ticker)}"><div><b class="ticker">${E(s.ticker)}</b> — ${E(s.companyNameAr||s.companyNameEn||'')}<div class="name">${r?'ضمن توصيات Astra الحالية':'ليس ضمن توصيات Astra الحالية'}</div></div><div style="text-align:left"><b>${N(x.price,3)}</b><div class="${Number(x.change1Pct??x.changePct)>=0?'good':'bad'}">${P(x.change1Pct??x.changePct)}</div></div></div>`;
    }).join(''):'<div class="empty">لا توجد نتائج.</div>';
    $$('[data-stock]').forEach(el=>el.onclick=()=>selectStock(el.dataset.stock));
  }
  async function selectStock(ticker){
    state.selected=mergedStock(ticker);
    renderStockDetail();
    try{
      const h=await loadJson('../../data/history/'+encodeURIComponent(ticker)+'.json');
      state.historyDoc=h;drawChart();
    }catch{state.historyDoc=null;drawChart()}
  }
  function renderStockDetail(){
    const x=state.selected;if(!x){$('#stockDetail').innerHTML='';return}
    const r=x.currentAstra,aux=state.stockMap.get(x.ticker)||{};
    $('#stockDetail').innerHTML=`
      <div class="panel">
        <div class="section-title"><div><h2><span class="ticker">${E(x.ticker)}</span> — ${E(x.companyNameAr||x.companyNameEn||'')}</h2><p>${r?'ضمن DecisionSnapshot الحالي':'ليس ضمن توصيات Astra الحالية'}</p></div>${r?'<span class="tag good">Astra current</span>':'<span class="tag">Search only</span>'}</div>
        <div class="stock-grid">
          <div class="stock-box"><small>السعر المساعد</small><b>${N(aux.price??x.price,3)}</b></div>
          <div class="stock-box"><small>التغير</small><b class="${Number(aux.change1Pct??x.changePct)>=0?'good':'bad'}">${P(aux.change1Pct??x.changePct)}</b></div>
          <div class="stock-box"><small>RSI 14 — عرض فقط</small><b>${N(aux.rsi14,2)}</b></div>
          <div class="stock-box"><small>الاتجاه — عرض فقط</small><b>${E(aux.trendLabelAr||'—')}</b></div>
          <div class="stock-box"><small>دعم 20 — عرض فقط</small><b>${N(aux.support20??x.historicalSupport20,3)}</b></div>
          <div class="stock-box"><small>مقاومة 20 — عرض فقط</small><b>${N(aux.resistance20??x.historicalResistance20,3)}</b></div>
          <div class="stock-box"><small>جلسة البيانات المساعدة</small><b>${E(aux.sessionId||x.updatedAt?.slice?.(0,10)||'—')}</b></div>
          <div class="stock-box"><small>حالة Astra</small><b class="${r?'good':'warn'}">${r?'موصى/مختار':'خارج القائمة الحالية'}</b></div>
        </div>
        ${r?`<div class="metrics" style="margin-top:10px"><div class="metric"><small>الدخول Astra</small><b>${N(r.entryPlan?.low??r.risk?.entry,3)}–${N(r.entryPlan?.high??r.risk?.entry,3)}</b></div><div class="metric"><small>وقف Astra</small><b>${N(r.stopLoss??r.risk?.stopLoss,3)}</b></div><div class="metric"><small>هدف 1</small><b>${N(target(r,0),3)}</b></div><div class="metric"><small>Risk</small><b>${P(r.risk?.riskPct)}</b></div><div class="metric"><small>Exposure</small><b>${P(r.risk?.exposurePct)}</b></div></div>`:''}
        <div class="notice" style="margin-top:10px">السعر/RSI/الاتجاه/الدعم والمقاومة في هذه الشاشة بيانات مساعدة للعرض والبحث، ولا تدخل في قرار Astra الحالي. لو السهم ضمن التوصيات، خطة الدخول/الوقف/الأهداف المعروضة أعلاه تأتي من DecisionSnapshot نفسه.</div>
      </div>
      <div class="panel"><div class="section-title"><div><h2>الرسم التاريخي</h2><p>عرض فقط من data/history؛ لا يغير التوصية.</p></div></div><div class="chart" id="chart"><div class="empty">جارٍ تحميل التاريخ…</div></div></div>`;
  }
  function historyRows(doc){
    const arr=Array.isArray(doc)?doc:Array.isArray(doc?.sessions)?doc.sessions:Array.isArray(doc?.rows)?doc.rows:[];
    return arr.map(r=>({date:r.date||r.sessionDate,close:Number(r.close)})).filter(r=>r.date&&Number.isFinite(r.close)&&r.close>0).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  }
  function drawChart(){
    const el=$('#chart');if(!el)return;
    const rows=historyRows(state.historyDoc).slice(-80);
    if(rows.length<2){el.innerHTML='<div class="empty">لا توجد بيانات تاريخية كافية للرسم.</div>';return}
    const W=900,H=260,pad=30,vals=rows.map(x=>x.close),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
    const pts=rows.map((r,i)=>[(pad+i*(W-pad*2)/(rows.length-1)).toFixed(1),(pad+(max-r.close)*(H-pad*2)/range).toFixed(1)]).map(x=>x.join(',')).join(' ');
    el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="#244d66"/><polyline fill="none" stroke="#38bdf8" stroke-width="3" points="${pts}"/><text x="${pad}" y="18" fill="#91acbd" font-size="12">${E(rows[0].date)} → ${E(rows.at(-1).date)}</text><text x="${W-pad-80}" y="18" fill="#ecf8ff" font-size="12">${N(rows.at(-1).close,3)}</text></svg>`;
  }

  function loadPortfolio(){try{const p=JSON.parse(localStorage.getItem(PORT_KEY)||'[]');state.portfolio=Array.isArray(p)?p:[]}catch{state.portfolio=[]}}
  function savePortfolio(){localStorage.setItem(PORT_KEY,JSON.stringify(state.portfolio))}
  function renderPortfolio(){
    const stocks=A(state.search?.stocks).filter(x=>x.active!==false);
    $('#view-portfolio').innerHTML=`
      <div class="panel"><div class="section-title"><div><h2>المحفظة</h2><p>محلية داخل المتصفح فقط؛ لا يتم رفع بياناتك.</p></div></div>
        <div class="form"><select id="pfTicker">${stocks.map(s=>`<option value="${E(s.ticker)}">${E(s.ticker)} — ${E(s.companyNameAr||s.companyNameEn||'')}</option>`).join('')}</select><input id="pfQty" type="number" min="0" step="any" placeholder="الكمية"><input id="pfAvg" type="number" min="0" step="any" placeholder="متوسط الشراء"><button class="btn good" id="pfAdd">إضافة / تحديث</button></div>
      </div>
      <div class="panel"><div class="portfolio-cards" id="pfCards"></div></div>
      <div class="panel"><div class="table"><table><thead><tr><th>السهم</th><th>الكمية</th><th>متوسط الشراء</th><th>السعر المساعد</th><th>القيمة</th><th>P/L</th><th>الوزن</th><th>Astra</th><th>خطة القرار</th><th></th></tr></thead><tbody id="pfRows"></tbody></table></div></div>
      <div class="panel"><div class="notice">حساب الربح/الخسارة يعتمد على السعر المساعد المتاح في ملفات السوق، وليس feed تداول لحظي. لا توجد أوامر شراء/بيع أو اتصال بوسيط.</div></div>`;
    $('#pfAdd').onclick=()=>{
      const ticker=$('#pfTicker').value,quantity=Number($('#pfQty').value),averagePrice=Number($('#pfAvg').value);
      if(!(quantity>0&&averagePrice>0))return;
      state.portfolio=state.portfolio.filter(x=>x.ticker!==ticker);state.portfolio.push({ticker,quantity,averagePrice});savePortfolio();renderPortfolio();
    };
    renderPortfolioRows();
  }
  function renderPortfolioRows(){
    const rows=state.portfolio.map(h=>{
      const x=mergedStock(h.ticker),price=Number(state.stockMap.get(h.ticker)?.price??x.price),value=Number.isFinite(price)?price*h.quantity:null,cost=h.averagePrice*h.quantity,pl=value===null?null:value-cost;
      return{...h,x,price,value,cost,pl,plPct:value===null||!cost?null:pl/cost*100,rec:state.recMap.get(h.ticker)};
    });
    const total=rows.reduce((s,x)=>s+(x.value||0),0),cost=rows.reduce((s,x)=>s+x.cost,0),pl=total-cost;
    $('#pfCards').innerHTML=[
      ['قيمة المحفظة',N(total,2)+' ج'],['التكلفة',N(cost,2)+' ج'],['الربح/الخسارة',N(pl,2)+' ج'],['النسبة',P(cost?pl/cost*100:null)],['عدد الأسهم',rows.length]
    ].map(([a,b])=>`<div class="card"><small>${E(a)}</small><b>${E(b)}</b></div>`).join('');
    $('#pfRows').innerHTML=rows.length?rows.map(x=>{
      const w=total&&x.value?x.value/total*100:0,r=x.rec;
      return `<tr><td><b class="ticker">${E(x.ticker)}</b><br>${E(nameOf(x.ticker))}</td><td>${N(x.quantity,2)}</td><td>${N(x.averagePrice,3)}</td><td>${N(x.price,3)}</td><td>${N(x.value,2)}</td><td class="${(x.pl||0)>=0?'good':'bad'}">${N(x.pl,2)}<br>${P(x.plPct)}</td><td>${P(w)}<div class="bar"><i style="width:${Math.min(100,w)}%"></i></div></td><td>${r?'<span class="tag good">ضمن Astra</span>':'<span class="tag">خارج القائمة</span>'}</td><td>${r?`وقف ${N(r.stopLoss??r.risk?.stopLoss,3)}<br>هدف ${N(target(r,0),3)}`:'—'}</td><td><button class="btn danger" data-del="${E(x.ticker)}">حذف</button></td></tr>`;
    }).join(''):'<tr><td colspan="10" class="empty">المحفظة فارغة.</td></tr>';
    $$('[data-del]').forEach(b=>b.onclick=()=>{state.portfolio=state.portfolio.filter(x=>x.ticker!==b.dataset.del);savePortfolio();renderPortfolioRows()});
  }

  function renderHistory(){
    const rows=A(state.history?.records).slice().sort((a,b)=>String(b.sessionDate).localeCompare(String(a.sessionDate))||Number(a.rank)-Number(b.rank));
    $('#view-history').innerHTML=`
      <div class="panel"><div class="section-title"><div><h2>سجل التوصيات المنشور</h2><p>أرشيف تاريخي للعرض فقط؛ لا يغير قرار Astra الحالي.</p></div><span class="tag">read-only archive</span></div>
      <div class="table"><table><thead><tr><th>الجلسة</th><th>#</th><th>السهم</th><th>الحالة</th><th>السعر</th><th>الدخول</th><th>وقف</th><th>هدف 1</th><th>المصدر</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${E(r.sessionDate)}</td><td>${E(r.rank)}</td><td><b class="ticker">${E(r.ticker)}</b></td><td>${E(r.decision)}</td><td>${N(r.price,3)}</td><td>${N(r.entryLow,3)}–${N(r.entryHigh,3)}</td><td>${N(r.stop,3)}</td><td>${N(r.target1,3)}</td><td><span class="muted">${E(r.sourceType)}</span></td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="panel"><div class="notice">هذا السجل ليس بديلًا عن G22 DecisionSnapshot. أي صف تاريخي لا يدخل تلقائيًا في توصيات اليوم.</div></div>`;
  }

  function renderHealth(){
    const d=state.data,h=d.health,sd=d.sourceDecision;
    $('#view-health').innerHTML=`
      <div class="grid cards">
        <div class="card"><small>Decision status</small><b class="good">${E(sd.status)}</b></div>
        <div class="card"><small>Freshness</small><b class="good">${E(h.freshness)}</b></div>
        <div class="card"><small>CRITICAL</small><b class="${Number(h.criticalUnresolved)>0?'bad':'good'}">${E(h.criticalUnresolved)}</b></div>
        <div class="card"><small>HIGH</small><b class="${Number(h.highUnresolved)>0?'warn':'good'}">${E(h.highUnresolved)}</b></div>
        <div class="card"><small>Guard</small><b class="${String(h.guardStatus||'').startsWith('PASS_WITH')?'warn':String(h.guardStatus||'').startsWith('PASS')?'good':'bad'}">${E(h.guardStatus)}</b></div>
        <div class="card"><small>Production cutover</small><b class="good">TRUE</b></div>
      </div>
      <div class="panel"><div class="section-title"><div><h2>هوية القرار</h2></div></div>
        <div class="stock-grid">
          <div class="stock-box"><small>DecisionSnapshot ID</small><b class="mono">${E(sd.decisionSnapshotId)}</b></div>
          <div class="stock-box"><small>Semantic hash</small><b class="mono">${E(sd.semanticDecisionHash)}</b></div>
          <div class="stock-box"><small>Object hash</small><b class="mono">${E(sd.decisionSnapshotObjectHash)}</b></div>
          <div class="stock-box"><small>Original source HEAD</small><b class="mono">${E(sd.sourceHead)}</b></div>
        </div>
      </div>
      <div class="panel"><div class="section-title"><div><h2>سياسة الفصل</h2></div></div>
        <div class="notice good">Current decision truth = G22 exact-rebuilt Astra DecisionSnapshot. Auxiliary search/price/history files are display-only. Legacy V15/V16 decision files are forbidden as decision truth.</div>
      </div>`;
  }

  function switchView(name){
    $$('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+name));
    $$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    if(name==='search'&&!$('#view-search').children.length){renderSearchShell();doSearch()}
  }

  async function boot(){
    try{
      // Only Astra DecisionSnapshot/data.json is critical. Search/intelligence/history are display-only.
      const data=await loadJson('./data.json');
      state.bootSources.data={status:'READY',url:'./data.json',error:null};
      const [search,stocks,history]=await Promise.all([
        loadOptionalJson('market-search','../../data/quant/market-search-index-v13-17.json',()=>({stocks:[]})),
        loadOptionalJson('stock-intelligence','../../data/quant/stock-intelligence-index.json',()=>({stocks:[]})),
        loadOptionalJson('recommendation-history','../../data/rc2/recommendation-history.json',()=>({records:[]}))
      ]);
      state.data=data;state.search=search;state.stocks=stocks;state.history=history;
      state.searchMap=new Map(A(search.stocks).map(x=>[x.ticker,x]));
      state.stockMap=new Map(A(stocks.stocks).map(x=>[x.ticker,x]));
      state.recMap=new Map(recs().map(x=>[x.ticker,x]));
      loadPortfolio();
      $('#sessionBadge').textContent='جلسة '+data.sourceDecision.session;
      $('#snapshotBadge').textContent='Snapshot '+data.sourceDecision.decisionSnapshotId.slice(-8);
      renderHome();renderRecommendations();renderPortfolio();renderHistory();renderHealth();
      renderSearchShell();doSearch();
      $$('#nav button').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
      const params=new URLSearchParams(location.search);const v=params.get('view');if(v&&$('#view-'+v))switchView(v);
      document.documentElement.dataset.g22Ready='true';
      window.__ASTRA_G22_READY__={snapshotId:data.sourceDecision.decisionSnapshotId,semanticDecisionHash:data.sourceDecision.semanticDecisionHash,recommendations:recs().length,bootSources:state.bootSources};
    }catch(error){
      const main=document.querySelector('main.wrap');
      if(main) main.innerHTML=`<div class="panel"><h2>تعذر تحميل بيانات Astra الأساسية</h2><div class="notice bad">${E(error.message||error)}</div><div class="notice" style="margin-top:10px">الواجهة نفسها محمّلة، لكن data.json الأساسي لم يصل. أعد فتح الصفحة أو تحقق من الاتصال؛ لن يتم إنشاء قرار بديل.</div></div>`;
      else document.body.insertAdjacentHTML('beforeend',`<main class="wrap"><div class="panel"><h2>تعذر تحميل بيانات Astra الأساسية</h2><div class="notice bad">${E(error.message||error)}</div></div></main>`);
      console.error('ASTRA_G22_BOOT_FAILED',error);
    }
  }
  boot();
})();