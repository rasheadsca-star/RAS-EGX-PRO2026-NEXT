const VIEW_ID = 'view-operations';
const GRID_ID = 'rc2OpsCenterGrid';
const SUMMARY_ID = 'rc2OpsCenterSummary';
const STYLE_ID = 'rc2OpsCenterStyle';
const EXP_PORTFOLIO_KEY = 'egx-tfe-rc2-v169-portfolio';
const EOD_PORTFOLIO_KEY = 'egx-tfe-rc2-v169-eod-manager';

const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };

const MODULES = Object.freeze([
  { id:'live-refresh', label:'المزامنة التلقائية', detail:'تحديث بيانات RC2 وأسعار المحفظة كل 5 دقائق مع no-store.', selector:'#rc2LiveRefreshBanner', view:'dashboard', anchor:'rc2LiveRefreshBanner', moduleId:'RC2_LIVE_REFRESH_V1' },
  { id:'session-monitor', label:'Session Monitor', detail:'متابعة الخطة المجمدة والأسعار المتأخرة أثناء الجلسة.', selector:'#rc2SessionMonitorPanel', view:'dashboard', anchor:'rc2SessionMonitorPanel', moduleId:'SESSION_MONITOR_V1' },
  { id:'ops-overlays', label:'Operational Overlays', detail:'حداثة التوصية، تأكيد الافتتاح، Basket Planner والتنبيهات.', selector:'#opsDecisionContext', view:'dashboard', anchor:'opsDecisionContext', moduleId:'V16_9_OPERATIONAL_OVERLAYS_V1' },
  { id:'intraday', label:'Intraday Operations', detail:'مسح Shadow للسوق + متابعة أسرع للمراكز والتوصيات أثناء الجلسة.', selector:'#rc2IntradayOpsPanel', view:'dashboard', anchor:'rc2IntradayOpsPanel', moduleId:'RC2_INTRADAY_OPERATIONS_V1' },
  { id:'alerts', label:'مركز التنبيهات', detail:'تنبيهات انتقال حالة التوصيات مع إذن صريح لإشعارات المتصفح.', selector:'#opsAlertsButton', view:'dashboard', action:'alerts', moduleId:'OPS_ALERT_CENTER' },
  { id:'eod-manager', label:'مدير المحفظة End-of-Day', detail:'تقييم المراكز وبناء خطة سيولة الغد بدون أوامر آلية.', selector:'#pmDesk', view:'portfolio', anchor:'pmDesk', moduleId:'RC2_EOD_PORTFOLIO_MANAGER' },
  { id:'live-portfolio', label:'المحفظة الحية', detail:'أسعار/P&L محدثة للمحفظة التجريبية ومدير المحفظة.', selector:'#rc2LivePortfolioPanel', view:'portfolio', anchor:'rc2LivePortfolioPanel', moduleId:'RC2_LIVE_PORTFOLIO_VIEW' },
  { id:'deep-portfolio', label:'التحليل الفني العميق', detail:'Candles + EMA + RSI + MACD + Volume + Fibonacci + Walk-Forward.', selector:'#portfolioDeepAnalysis', view:'portfolio', anchor:'portfolioDeepAnalysis', moduleId:'RC2_DEEP_PORTFOLIO_ANALYSIS_V1' },
  { id:'portfolio-risk', label:'Correlation & Stress', detail:'ارتباط المراكز، مخاطر التركّز وStress Test محلي.', selector:'#opsPortfolioRisk', view:'portfolio', anchor:'opsPortfolioRisk', moduleId:'RC2_PORTFOLIO_RISK_OVERLAY' },
  { id:'fundamentals', label:'التحليل المالي التلقائي', detail:'Fundamental score + peer valuation + red flags للعرض فقط.', selector:'#fundamentalAutoAnalysis', view:'fundamentals', anchor:'fundamentalAutoAnalysis', moduleId:'RC2_AUTO_FUNDAMENTALS_V1' },
  { id:'regime', label:'Market Regime Evidence', detail:'Bull / Sideways / Bear كدليل مستقل فقط عند توفر feed موثق.', selector:'#opsRegimeEvidence', view:'evidence', anchor:'opsRegimeEvidence', moduleId:'RC2_MARKET_REGIME_EVIDENCE' },
]);

function ensureShell(){
  const nav=document.querySelector('nav.tabs');
  if(nav&&!nav.querySelector('.tab[data-view="operations"]')){
    const tab=document.createElement('button');tab.className='tab';tab.dataset.view='operations';tab.textContent='مركز RC2 Ops';
    const first=nav.querySelector('.tab[data-view="dashboard"]');first?.insertAdjacentElement('afterend',tab);
  }
  const main=document.querySelector('main');
  if(main&&!document.getElementById(VIEW_ID)){
    const section=document.createElement('section');section.className='view';section.id=VIEW_ID;
    section.innerHTML=`<div class="roc-hero"><article class="panel"><div class="panel-head split"><div><h2>RC2 Operations Center</h2><p>كل حزم التشغيل والإضافات الخاصة بـRC2 داخل واجهة V16.9 في مكان واحد، بدون تكرار للمحرك أو تغيير للتوصيات.</p></div><button class="btn primary" id="rc2OpsCenterRefresh">تحديث وحدات التشغيل الآن</button></div><div id="${SUMMARY_ID}"></div></article><article class="panel"><div class="panel-head"><div><h2>قواعد الدمج</h2><p>Integration layer فقط — الوحدات الأصلية تظل صاحبة الحسابات والبيانات.</p></div></div><div class="rc2-note">لا Double Polling · لا تغيير Alpha/Fusion · لا Automatic Orders · لا إعادة كتابة للتوصية الرسمية. مركز العمليات يفتح الوحدات الموجودة ويعرض جاهزيتها فقط.</div></article></div><div id="${GRID_ID}"></div>`;
    const dashboard=document.getElementById('view-dashboard');dashboard?.insertAdjacentElement('afterend',section);
  }
}

function ensureStyle(){
  if(document.getElementById(STYLE_ID)) return;
  const style=document.createElement('style');
  style.id=STYLE_ID;
  style.textContent=`
    #${VIEW_ID} .roc-hero{display:grid;grid-template-columns:1.5fr 1fr;gap:14px;margin-bottom:14px}
    #${VIEW_ID} .roc-status{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}
    #${VIEW_ID} .roc-kpi{padding:10px;border:1px solid #274e63;border-radius:10px;background:#071923}
    #${VIEW_ID} .roc-kpi small{display:block;color:#8faabb;font-size:9px;margin-bottom:4px}#${VIEW_ID} .roc-kpi b{font-size:16px}
    #${GRID_ID}{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}
    .roc-card{border:1px solid #274d63;border-radius:13px;background:#081d2b;padding:12px;display:flex;flex-direction:column;gap:9px;min-height:160px}
    .roc-card.active{border-color:#2e7f62}.roc-card.wait{border-color:#7b642d}.roc-card h3{margin:0;font-size:15px}.roc-card p{margin:0;color:#9ab5c4;line-height:1.65;font-size:10px;flex:1}
    .roc-card-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.roc-id{font-size:8px;color:#7194a7;direction:ltr;text-align:left;word-break:break-all}
    .roc-pill{display:inline-flex;padding:4px 7px;border-radius:999px;border:1px solid #446577;font-size:9px;white-space:nowrap}.roc-pill.good{color:#caffdf;border-color:#2d7b5b}.roc-pill.warn{color:#ffe1a0;border-color:#80652e}
    .roc-actions{display:flex;gap:7px;flex-wrap:wrap}.roc-actions .btn{font-size:10px}
    .roc-note{padding:10px 12px;border-radius:10px;background:#102b38;color:#cfe1e9;line-height:1.75;font-size:10px}.roc-note.warn{background:#302718;color:#ffe5a5}
    @media(max-width:1050px){#${GRID_ID}{grid-template-columns:repeat(2,minmax(0,1fr))}#${VIEW_ID} .roc-hero{grid-template-columns:1fr}}
    @media(max-width:650px){#${GRID_ID}{grid-template-columns:1fr}#${VIEW_ID} .roc-status{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(style);
}

function portfolioCounts(){
  const exp=load(EXP_PORTFOLIO_KEY,[]),eod=load(EOD_PORTFOLIO_KEY,{});
  const expCount=Array.isArray(exp)?exp.filter(x=>x?.ticker).length:0;
  const eodCount=Array.isArray(eod?.holdings)?eod.holdings.filter(x=>x?.ticker).length:0;
  return {expCount,eodCount,total:expCount+eodCount};
}
const moduleReady=m=>Boolean(document.querySelector(m.selector));
const scanSnapshot=()=>window.__RC2_UI_SCAN__||{};
const monitorSnapshot=()=>window.__RC2_SESSION_MONITOR_LAST__||{};

function render(){
  ensureShell();
  const view=document.getElementById(VIEW_ID),grid=document.getElementById(GRID_ID),summary=document.getElementById(SUMMARY_ID);if(!view||!grid||!summary)return;
  ensureStyle();const ready=MODULES.filter(moduleReady).length,scan=scanSnapshot(),monitor=monitorSnapshot(),p=portfolioCounts();
  const session=scan.effectiveDate||scan.scan?.universe?.sessionDate||monitor.phase?.date||'—';
  const recs=Array.isArray(scan.scan?.recommendations)?scan.scan.recommendations.length:0;
  summary.innerHTML=`<div class="roc-status"><div class="roc-kpi"><small>حزم RC2 المفعلة</small><b>${ready}/${MODULES.length}</b></div><div class="roc-kpi"><small>جلسة البيانات</small><b>${esc(session)}</b></div><div class="roc-kpi"><small>توصيات RC2 الحالية</small><b>${recs}</b></div><div class="roc-kpi"><small>مراكز محلية</small><b>${p.total}</b></div></div><div class="roc-note" style="margin-top:10px">المحفظة التجريبية: ${p.expCount} · مدير End-of-Day: ${p.eodCount}. الحزم تعرض/تتابع نفس بيانات RC2 ولا تغيّر Alpha أو Fusion Rank. التنفيذ الآلي ما زال مقفولًا.</div>`;
  grid.innerHTML=MODULES.map(m=>{const active=moduleReady(m);return `<article class="roc-card ${active?'active':'wait'}" data-module="${esc(m.id)}"><div class="roc-card-head"><div><h3>${esc(m.label)}</h3><div class="roc-id">${esc(m.moduleId)}</div></div><span class="roc-pill ${active?'good':'warn'}">${active?'ACTIVE':'WAITING'}</span></div><p>${esc(m.detail)}</p><div class="roc-actions"><button class="btn" data-open="${esc(m.id)}">فتح الوحدة</button></div></article>`}).join('');
  grid.querySelectorAll('[data-open]').forEach(btn=>btn.addEventListener('click',()=>openModule(btn.dataset.open)));
}

function activateView(view){
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${view}`));
  document.querySelector(`.tab[data-view="${view}"]`)?.dispatchEvent(new Event('rc2:ops-center-view'));
}
function openModule(id){
  const m=MODULES.find(x=>x.id===id);if(!m)return;
  if(m.action==='alerts'){const b=document.getElementById('opsAlertsButton');if(b){b.click();return;}}
  const tab=document.querySelector(`.tab[data-view="${m.view}"]`);if(tab)tab.click();else activateView(m.view);
  setTimeout(()=>{const target=m.anchor?document.getElementById(m.anchor):document.querySelector(m.selector);target?.scrollIntoView({behavior:'smooth',block:'start'})},80);
}
function safeRefreshAll(){
  document.getElementById('refreshBtn')?.click();
  setTimeout(()=>document.getElementById('sessionMonitorRefresh')?.click(),250);
  setTimeout(()=>document.getElementById('ioPriorityNow')?.click(),500);
  setTimeout(()=>document.getElementById('ioBatchNow')?.click(),750);
  setTimeout(render,1200);
}
function bind(){
  document.getElementById('rc2OpsCenterRefresh')?.addEventListener('click',safeRefreshAll);
  window.addEventListener('rc2:ui-scan',()=>setTimeout(render,50));window.addEventListener('rc2:session-monitor',()=>setTimeout(render,50));
  window.addEventListener('storage',e=>{if([EXP_PORTFOLIO_KEY,EOD_PORTFOLIO_KEY].includes(e.key))setTimeout(render,50)});
  document.querySelector('.tab[data-view="operations"]')?.addEventListener('click',()=>{activateView('operations');setTimeout(render,80)});
  let timer=null;const observer=new MutationObserver(records=>{
    const external=records.some(r=>{const t=r.target;return !(t instanceof Element) || !t.closest(`#${VIEW_ID}`)});
    if(!external)return;clearTimeout(timer);timer=setTimeout(render,180);
  });observer.observe(document.body,{childList:true,subtree:true});
}
function start(){ensureShell();ensureStyle();bind();render();setTimeout(render,1600)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
