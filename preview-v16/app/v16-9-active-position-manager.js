'use strict';
(() => {
  const VERSION = 'ui-r3-professional-5m';
  if (window.__V169_ACTIVE_POSITION_MANAGER_VERSION__ === VERSION) {
    if (typeof window.__V169_ACTIVE_POSITION_MANAGER_APPLY__ === 'function') window.__V169_ACTIVE_POSITION_MANAGER_APPLY__();
    return;
  }
  window.__V169_ACTIVE_POSITION_MANAGER_VERSION__ = VERSION;

  const CORE_SRC = 'v16-9-position-advisory-core.js?v=16.9.2-advisory-core-r3';
  const DECISION_URL = '../../data/stable/v16-main-app-current.json';
  const MANAGER_URL = '../../data/stable/v16-active-position-manager.json';
  const MARKET_URL = '../../data/quant/market-search-index-v13-17.json';
  const QUOTE_API = 'https://egx-tfe-v20-fusion-rc2.vercel.app/api/intraday';
  const CANONICAL_PORTFOLIO_KEY = 'egx-v16-professional-portfolio';
  const LEGACY_PORTFOLIO_KEY = 'egx-v137-portfolio';
  const MIGRATION_KEY = 'egx-v16-professional-portfolio-migrated-r3';
  const BACKUP_KEY = 'egx-v16-professional-portfolio-backup-r3';
  const ALERT_STATE_KEY = 'egx-v16-professional-advisory-state-r3';
  const REFRESH_MS = 5 * 60 * 1000;
  const HISTORY_CACHE_MS = 15 * 60 * 1000;
  const STYLE_ID = 'v169ActivePositionManagerStyleR3';
  const MARKER_CLASS = 'v169-position-action-r3';
  const STATUS_ID = 'v169LiveAdvisoryStatus';
  const PORTFOLIO_PANEL_ID = 'v169ProfessionalPortfolioAdvisory';
  const TOAST_ID = 'v169AdvisoryToast';

  let Core = null;
  let latestDecision = null;
  let latestManager = null;
  let latestMarket = null;
  let latestPortfolio = [];
  let latestQuotes = new Map();
  let latestAnalyses = new Map();
  let latestActions = new Map();
  let lastSuccessAt = null;
  let lastAttemptAt = null;
  let nextDueAt = null;
  let refreshTimer = null;
  let clockTimer = null;
  let refreshing = false;
  const historyCache = new Map();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const fmt = (value, digits = 3) => num(value) === null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
  const pct = value => num(value) === null ? '—' : `${fmt(value,2)}%`;
  const money = value => num(value) === null ? '—' : `${Number(value).toLocaleString('en-US',{maximumFractionDigits:0})} ج.م`;

  function safeParse(raw, fallback){try{return JSON.parse(raw) ?? fallback}catch{return fallback}}
  function readJsonStorage(key, fallback){return safeParse(localStorage.getItem(key),fallback)}
  function writeJsonStorage(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}

  async function ensureCore(){
    if (window.V169PositionAdvisoryCore) { Core = window.V169PositionAdvisoryCore; return Core; }
    await new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-v169-advisory-core]');
      if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(new Error('advisory core load failed')),{once:true});return}
      const script=document.createElement('script');script.src=CORE_SRC;script.async=true;script.dataset.v169AdvisoryCore='true';script.onload=resolve;script.onerror=()=>reject(new Error('advisory core load failed'));(document.head||document.documentElement).appendChild(script);
    });
    Core=window.V169PositionAdvisoryCore;if(!Core)throw new Error('advisory core unavailable');return Core;
  }

  function migrateLegacyOnce(){
    if(localStorage.getItem(MIGRATION_KEY))return;
    const canonicalRaw=localStorage.getItem(CANONICAL_PORTFOLIO_KEY);
    if(canonicalRaw===null){
      const legacy=readJsonStorage(LEGACY_PORTFOLIO_KEY,[]);
      if(Array.isArray(legacy)&&legacy.length){
        const migrated=legacy.filter(x=>x?.ticker&&num(x.quantity)>0&&num(x.averagePrice)>0).map(x=>({
          id:`legacy-${String(x.ticker).toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          ticker:String(x.ticker).toUpperCase(),name:x.name||'',strategyId:'LEGACY_MIGRATED',strategyLabel:'مركز مرحل من المحفظة القديمة',
          entry:num(x.averagePrice),averagePrice:num(x.averagePrice),stop:num(x.stop)||null,target:num(x.target)||null,quantity:num(x.quantity),
          notional:num(x.quantity)*num(x.averagePrice),risk:0,migratedFrom:LEGACY_PORTFOLIO_KEY
        }));
        writeJsonStorage(CANONICAL_PORTFOLIO_KEY,migrated);
      }
    }
    try{localStorage.setItem(MIGRATION_KEY,new Date().toISOString())}catch{}
  }

  function readPortfolioRows(){
    migrateLegacyOnce();
    const raw=localStorage.getItem(CANONICAL_PORTFOLIO_KEY);
    let rows=safeParse(raw,null);
    if(!Array.isArray(rows)){
      const backup=readJsonStorage(BACKUP_KEY,null);
      rows=Array.isArray(backup?.rows)?backup.rows:[];
      if(raw===null||raw==='')writeJsonStorage(CANONICAL_PORTFOLIO_KEY,rows);
    }
    writeJsonStorage(BACKUP_KEY,{version:3,updatedAt:new Date().toISOString(),rows});
    return rows;
  }

  async function fetchJson(url){
    const target=`${url}${url.includes('?')?'&':'?'}r3=${Date.now()}`;
    const response=await fetch(target,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();
  }

  function cairoParts(date=new Date()){
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(date);
    const m=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    const minute=Number(m.hour)*60+Number(m.minute);return{weekday:m.weekday,date:`${m.year}-${m.month}-${m.day}`,time:`${m.hour}:${m.minute}:${m.second}`,minute,phase:['Sun','Mon','Tue','Wed','Thu'].includes(m.weekday)?minute<600?'PRE_OPEN':minute<870?'OPEN':'POST_CLOSE':'CLOSED'};
  }

  function ensureStyle(){
    if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=`
      .${MARKER_CLASS}{margin-top:12px;padding:12px 13px;border-radius:12px;border:1px solid #31566b;background:#0b1a26;display:grid;gap:7px;direction:rtl;text-align:right;position:relative;z-index:1}
      .${MARKER_CLASS}[data-tone="danger"]{border-color:#9b4a53;background:#31191e}.v169pm-badge[data-tone="danger"]{background:#682d36;color:#ffe6e9}
      .${MARKER_CLASS}[data-tone="profit"]{border-color:#8d6b2c;background:#2e2616}.v169pm-badge[data-tone="profit"]{background:#68501e;color:#fff0b4}
      .${MARKER_CLASS}[data-tone="hold"]{border-color:#2f7a62;background:#102b25}.v169pm-badge[data-tone="hold"]{background:#1c5a46;color:#d9fff0}
      .${MARKER_CLASS}[data-tone="reentry"]{border-color:#35718e;background:#102735}.v169pm-badge[data-tone="reentry"]{background:#1f5670;color:#e0f7ff}
      .${MARKER_CLASS}[data-tone="warning"]{border-color:#8c692d;background:#302617}.v169pm-badge[data-tone="warning"]{background:#5c431c;color:#ffe4a7}
      .${MARKER_CLASS}[data-tone="watch"]{border-color:#555d78;background:#1b1e2c}.v169pm-badge[data-tone="watch"]{background:#353b56;color:#eef0ff}
      .v169pm-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.v169pm-head strong{font-size:14px}.v169pm-badge{font-size:13px;font-weight:900;padding:6px 9px;border-radius:999px;background:#17384b;color:#e6f7ff;white-space:nowrap}
      .v169pm-reason{font-size:13px;color:#d0e3eb;line-height:1.7;font-weight:700}.v169pm-context{font-size:11px;color:#9cb7c4;line-height:1.6}.v169pm-levels{display:flex;gap:6px;flex-wrap:wrap;font-size:10px}.v169pm-levels span{padding:5px 7px;border-radius:8px;background:#0e2937;border:1px solid #244657}.v169pm-local{font-size:11px;color:#a9f1d3;font-weight:800}.v169pm-time{font-size:10px;color:#7895a4}
      #${STATUS_ID}{margin:10px 0 14px;padding:12px 14px;border:1px solid #2e6d67;border-radius:13px;background:#092522;display:grid;gap:9px}#${STATUS_ID}.warn{border-color:#8a6a30;background:#302617}#${STATUS_ID}.bad{border-color:#944751;background:#32191f}
      #${STATUS_ID} .las-head{display:flex;justify-content:space-between;align-items:center;gap:9px;flex-wrap:wrap}#${STATUS_ID} .las-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px}#${STATUS_ID} .las-k{background:#081b27;border:1px solid #244858;border-radius:9px;padding:8px}#${STATUS_ID} .las-k small{display:block;color:#8ca8b7;font-size:9px}#${STATUS_ID} .las-k b{display:block;margin-top:3px;font-size:13px}
      #${PORTFOLIO_PANEL_ID}{margin:14px 0}#${PORTFOLIO_PANEL_ID} .pap-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}#${PORTFOLIO_PANEL_ID} .pap-grid{display:grid;gap:12px;margin-top:12px}#${PORTFOLIO_PANEL_ID} .pap-card{border:1px solid #2a5366;border-radius:13px;background:#081c29;padding:13px}#${PORTFOLIO_PANEL_ID} .pap-title{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}#${PORTFOLIO_PANEL_ID} .pap-title h3{margin:0;font-size:19px}#${PORTFOLIO_PANEL_ID} .pap-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;margin:10px 0}#${PORTFOLIO_PANEL_ID} .pap-m{padding:8px;border:1px solid #244758;border-radius:9px;background:#061722}#${PORTFOLIO_PANEL_ID} .pap-m small{display:block;color:#8eaab8;font-size:9px}#${PORTFOLIO_PANEL_ID} .pap-m b{display:block;font-size:13px;margin-top:3px}#${PORTFOLIO_PANEL_ID} .pap-probs{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}#${PORTFOLIO_PANEL_ID} .pap-p{padding:7px;border:1px solid #244758;border-radius:8px;background:#061722;display:flex;justify-content:space-between}#${PORTFOLIO_PANEL_ID} .pap-reasons{margin:9px 0 0;padding:9px 12px;background:#0d2a38;border-radius:9px;color:#cfe2eb;line-height:1.75;font-size:11px}#${PORTFOLIO_PANEL_ID} .pap-cal{font-size:10px;color:#9bb5c2;line-height:1.65;margin-top:8px}
      #${TOAST_ID}{position:fixed;left:18px;bottom:18px;z-index:99999;max-width:360px;padding:12px 14px;border-radius:12px;background:#102c3a;border:1px solid #3981a2;color:#effaff;box-shadow:0 12px 30px #0007;display:none;line-height:1.6}#${TOAST_ID}.show{display:block}
      @media(max-width:950px){#${STATUS_ID} .las-grid{grid-template-columns:repeat(2,1fr)}#${PORTFOLIO_PANEL_ID} .pap-metrics{grid-template-columns:repeat(3,1fr)}}@media(max-width:560px){#${PORTFOLIO_PANEL_ID} .pap-metrics{grid-template-columns:repeat(2,1fr)}#${PORTFOLIO_PANEL_ID} .pap-probs{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }

  function ensureToast(){let t=document.getElementById(TOAST_ID);if(t)return t;t=document.createElement('div');t.id=TOAST_ID;document.body.appendChild(t);return t}
  function toast(text){const t=ensureToast();t.textContent=text;t.classList.add('show');clearTimeout(t._hide);t._hide=setTimeout(()=>t.classList.remove('show'),5000)}

  function ensureStatus(){
    ensureStyle();let panel=document.getElementById(STATUS_ID);if(panel)return panel;panel=document.createElement('div');panel.id=STATUS_ID;const basket=document.getElementById('v169BasketPanel');if(basket)basket.insertAdjacentElement('beforebegin',panel);else(document.getElementById('view-dashboard')||document.querySelector('main')||document.body).insertAdjacentElement('afterbegin',panel);return panel;
  }
  function ensurePortfolioPanel(){
    let p=document.getElementById(PORTFOLIO_PANEL_ID);if(p)return p;const view=document.getElementById('view-portfolio');if(!view)return null;p=document.createElement('article');p.id=PORTFOLIO_PANEL_ID;p.className='panel';view.insertAdjacentElement('afterbegin',p);return p;
  }

  async function loadStateFiles(){
    const [d,mgr,market]=await Promise.all([fetchJson(DECISION_URL),fetchJson(MANAGER_URL).catch(()=>null),fetchJson(MARKET_URL)]);latestDecision=d;latestManager=mgr;latestMarket=market;return{d,mgr,market};
  }

  function marketMap(){return new Map((Array.isArray(latestMarket?.stocks)?latestMarket.stocks:[]).map(x=>[String(x.ticker||'').toUpperCase(),x]))}
  function managerMap(){return new Map((Array.isArray(latestManager?.recommendations)?latestManager.recommendations:[]).map(x=>[String(x.ticker||'').toUpperCase(),x]))}
  function recommendationMap(){return new Map((Array.isArray(latestDecision?.recommendations)?latestDecision.recommendations:[]).map(x=>[String(x.ticker||'').toUpperCase(),x]))}

  async function fetchQuoteBatch(tickers,force=false){
    const q=new URLSearchParams({tickers:tickers.join(','),t:String(Date.now())});if(force)q.set('force','1');const response=await fetch(`${QUOTE_API}?${q}`,{cache:'no-store',mode:'cors'});if(!response.ok)throw new Error(`quote HTTP ${response.status}`);const data=await response.json();if(!data?.ok)throw new Error(data?.error||'quote unavailable');return data.results||[];
  }
  async function fetchQuotes(tickers,force=false){
    const map=new Map(),errors=[];for(let i=0;i<tickers.length;i+=10){const group=tickers.slice(i,i+10);try{for(const r of await fetchQuoteBatch(group,force))if(r?.ticker&&r?.quote)map.set(String(r.ticker).toUpperCase(),{...r.quote,_mode:'LIVE_DELAYED'})}catch(error){errors.push(error.message)}}
    const mm=managerMap(),mk=marketMap();for(const ticker of tickers){if(map.has(ticker))continue;const mr=mm.get(ticker)?.market,mi=mk.get(ticker);const price=num(mr?.price)??num(mi?.price);if(price>0)map.set(ticker,{ticker,price,open:num(mr?.open),high:num(mr?.high),low:num(mr?.low),volume:num(mi?.volume),sourceSessionDate:mr?.sourceSessionDate||latestDecision?.sessionDate||latestMarket?.marketDate||null,sourceMarketTime:null,fetchedAt:mr?.fetchedAt||latestManager?.generatedAt||mi?.updatedAt||null,source:mr?.source||mi?.priceSource||'MAIN_APP_FALLBACK',delayedMinutes:null,_mode:'FALLBACK_EOD'})}
    return{map,errors};
  }

  async function loadHistory(ticker){
    const cached=historyCache.get(ticker);if(cached&&Date.now()-cached.at<HISTORY_CACHE_MS)return cached.data;const mi=marketMap().get(ticker),path=mi?.chartPath||`../../data/history/${encodeURIComponent(ticker)}.json`;const data=await fetchJson(path);historyCache.set(ticker,{at:Date.now(),data});return data;
  }

  function contextText(ticker){const row=managerMap().get(ticker),cycle=row?.cycle||{};if(cycle.repeatAfterTarget)return'الهدف السابق تحقق · هذه دورة توصية جديدة، وإدارة المركز الحالية تعتمد على السعر الحالي.';if(cycle.state==='PRIOR_CYCLE_STILL_OPEN')return'الدورة السابقة ما زالت مفتوحة حسب السجل؛ الإدارة الحالية للمركز القائم.';if(cycle.repeatedRecommendation)return`السهم تكرر ${cycle.recommendationOccurrences||0} مرات؛ التكرار لا يعني استثمارًا طويل الأجل تلقائيًا.`;return cycle.horizonInterpretationAr||'إدارة فنية للمركز الحالي.'}

  function buildCompact(ticker,action,analysis,holding,quote){
    const signature=[ticker,action?.code,quote?.price,action?.stop,action?.target1,action?.nextTarget,holding?.quantity,holding?.averagePrice,lastSuccessAt].join('|');
    return{signature,html:`<div class="${MARKER_CLASS}" data-tone="${esc(action?.tone||'neutral')}" data-pm-signature="${esc(signature)}"><div class="v169pm-head"><strong>إدارة المركز · Live Advisory</strong><span class="v169pm-badge" data-tone="${esc(action?.tone||'neutral')}">${esc(action?.labelAr||'مراقبة')}</span></div><div class="v169pm-reason">${esc(action?.reasonAr||'')}</div><div class="v169pm-context">${esc(contextText(ticker))}</div>${holding?`<div class="v169pm-local">في محفظتك: ${fmt(holding.quantity,0)} سهم · متوسط ${fmt(holding.averagePrice,4)} · P/L ${pct(action?.pnlPct)}</div>`:''}<div class="v169pm-levels"><span>السعر ${fmt(action?.price,4)}</span><span>وقف ${fmt(action?.stop,4)}</span><span>T1 ${fmt(action?.target1,4)}</span>${num(action?.nextTarget)>0?`<span>الهدف الفني التالي ${fmt(action.nextTarget,4)}</span>`:''}<span>RSI ${fmt(analysis?.evidence?.rsi14,1)}</span><span>ثقة ${esc(action?.confidence||'—')}</span></div><div class="v169pm-time">دورة 5 دقائق · Quote ${esc(quote?._mode==='LIVE_DELAYED'?'Mubasher delayed ~15m':'Fallback EOD')} · لا تنفيذ آلي</div></div>`};
  }

  function applyRecommendationCards(){
    if(!latestDecision||!Core)return 0;const recs=recommendationMap(),portfolio=new Map(latestPortfolio.map(x=>[x.ticker,x]));let applied=0;document.querySelectorAll('#v169BasketPanel .v169-card[data-ticker], #v169BasketPanel article[data-ticker]').forEach(card=>{const ticker=String(card.dataset.ticker||'').toUpperCase(),rec=recs.get(ticker);if(!rec)return;const analysis=latestAnalyses.get(ticker),quote=latestQuotes.get(ticker),action=latestActions.get(ticker);if(!analysis||!action)return;const rendered=buildCompact(ticker,action,analysis,portfolio.get(ticker)||null,quote);const old=card.querySelector(`.${MARKER_CLASS}`);if(old?.dataset?.pmSignature===rendered.signature){applied++;return}old?.remove();card.insertAdjacentHTML('beforeend',rendered.html);applied++});return applied;
  }

  function calibrationText(a){const c=a?.calibration;if(!c?.ready)return c?.reason||'المعايرة التاريخية غير مكتملة';return c.horizons.map(h=>`${h.h}ج: ↑${fmt(h.bull,0)}% ↔${fmt(h.side,0)}% ↓${fmt(h.bear,0)}% · عائد ${fmt(h.expected,2)}%`).join(' | ')}
  function renderPortfolioPanel(){
    const panel=ensurePortfolioPanel();if(!panel)return;const cards=latestPortfolio.map(h=>{const a=latestAnalyses.get(h.ticker),act=latestActions.get(h.ticker),q=latestQuotes.get(h.ticker),ev=a?.evidence||{};if(!a?.ready||!act)return`<div class="pap-card"><h3>${esc(h.ticker)}</h3><div class="pap-reasons">تعذر اكتمال التحليل الفني الحالي.</div></div>`;const reasons=(act.reasons||[]).filter(Boolean);return`<article class="pap-card"><div class="pap-title"><div><h3>${esc(h.ticker)} — ${esc(h.name||'')}</h3><small>${fmt(a.barsAnalyzed,0)} جلسة محللة · ${esc(q?._mode==='LIVE_DELAYED'?'سعر جلسة متأخر ~15 دقيقة':'آخر إغلاق/مصدر احتياطي')}</small></div><span class="v169pm-badge" data-tone="${esc(act.tone||'neutral')}">${esc(act.labelAr)}</span></div><div class="pap-metrics"><div class="pap-m"><small>السعر</small><b>${fmt(act.price,4)}</b></div><div class="pap-m"><small>متوسطك</small><b>${fmt(h.averagePrice,4)}</b></div><div class="pap-m"><small>P/L</small><b>${pct(act.pnlPct)}</b></div><div class="pap-m"><small>Stop</small><b>${fmt(act.stop,4)}</b></div><div class="pap-m"><small>T1</small><b>${fmt(act.target1,4)}</b></div><div class="pap-m"><small>هدف فني تالٍ</small><b>${fmt(act.nextTarget,4)}</b></div><div class="pap-m"><small>EMA20 / EMA50</small><b>${fmt(ev.ema20,3)} / ${fmt(ev.ema50,3)}</b></div><div class="pap-m"><small>SMA200</small><b>${fmt(ev.sma200,3)}</b></div><div class="pap-m"><small>RSI14</small><b>${fmt(ev.rsi14,1)}</b></div><div class="pap-m"><small>MACD Hist</small><b>${fmt(ev.macd?.hist,4)}</b></div><div class="pap-m"><small>Volume 20</small><b>${fmt(ev.volumeRatio,2)}×</b></div><div class="pap-m"><small>ATR14</small><b>${fmt(ev.atr14,3)}</b></div></div><div class="pap-probs"><div class="pap-p"><span>صاعد</span><b>${fmt(a.final.bull,1)}%</b></div><div class="pap-p"><span>عرضي</span><b>${fmt(a.final.side,1)}%</b></div><div class="pap-p"><span>هابط</span><b>${fmt(a.final.bear,1)}%</b></div></div><div class="pap-reasons"><b>${esc(act.reasonAr)}</b>${reasons.length?`<br>${reasons.map(x=>`• ${esc(x)}`).join('<br>')}`:''}<br>• دعم ${fmt(ev.supports?.[0]?.level,3)} · مقاومة ${fmt(ev.resistances?.[0]?.level,3)} · اتجاه أسبوعي ${esc(ev.weekly?.bias||'—')} · ثقة ${esc(act.confidence)} (${fmt(act.confidenceScore,0)}/100)</div><div class="pap-cal"><b>Walk-Forward حالات مشابهة:</b> ${esc(calibrationText(a))}</div></article>`}).join('');
    panel.innerHTML=`<div class="pap-head"><div><h2>التحليل الفني الاحترافي للمحفظة</h2><p>Trend + Momentum + Volume + ATR + S/R + Fibonacci + Weekly + Walk‑Forward. إدارة الصفقة تتحدث كل 5 دقائق ولا تغيّر اختيار V16.9 الرسمي.</p></div><button class="btn" id="v169PortfolioRefreshNow">تحديث التحليل الآن</button></div>${latestPortfolio.length?`<div class="pap-grid">${cards}</div>`:'<div class="pap-reasons">لا توجد مراكز في المحفظة الحالية. المصدر المعتمد: egx-v16-professional-portfolio.</div>'}`;
    panel.querySelector('#v169PortfolioRefreshNow')?.addEventListener('click',()=>refreshCycle('manual',true));
  }

  function recommendationSignature(){return`${latestDecision?.sessionDate||''}|${(latestDecision?.recommendations||[]).map(x=>`${x.rank}:${x.ticker}:${x.entryLow}:${x.entryHigh}:${x.stopLoss}:${x.target1}`).join('|')}`}
  function readAlertState(){return readJsonStorage(ALERT_STATE_KEY,{actions:{},recommendationSignature:null})}
  function notify(title,body){toast(`${title}: ${body}`);if('Notification'in window&&Notification.permission==='granted'){try{new Notification(title,{body,tag:'egx-v169-advisory'})}catch{}}}
  function detectChanges(){
    const state=readAlertState(),next={actions:{},recommendationSignature:recommendationSignature()},changes=[];for(const [ticker,act] of latestActions){next.actions[ticker]=act.code;const prev=state.actions?.[ticker];if(prev&&prev!==act.code)changes.push({ticker,from:prev,to:act.code,label:act.labelAr})}
    if(state.recommendationSignature&&state.recommendationSignature!==next.recommendationSignature)notify('تحديث توصيات MAIN APP','تغيرت قائمة/خطة توصيات V16.9 الرسمية المنشورة.');for(const c of changes)notify(`تنبيه ${c.ticker}`,`تغيرت إدارة المركز إلى: ${c.label}`);writeJsonStorage(ALERT_STATE_KEY,next);return changes.length;
  }

  function renderStatus(error=null,liveCount=0,fallbackCount=0,changeCount=0){
    const panel=ensureStatus(),phase=cairoParts(),total=latestQuotes.size,ok=!error&&total>0,partial=fallbackCount>0||liveCount<total;panel.className=error?'bad':partial?'warn':'';const nextText=nextDueAt?new Date(nextDueAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';const lastText=lastSuccessAt?new Date(lastSuccessAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';panel.innerHTML=`<div class="las-head"><div><b>MAIN APP · دورة إدارة التوصيات والمحفظة</b><div style="font-size:11px;color:#9eb8c5;margin-top:4px">${esc(phase.phase)} · Cairo ${esc(phase.time)} · تحديث مستهدف كل 5 دقائق</div></div><div><button class="btn" id="v169NotifyBtn">${'Notification'in window&&Notification.permission==='granted'?'التنبيهات مفعلة':'تفعيل تنبيهات المتصفح'}</button> <button class="btn primary" id="v169RefreshNow">تحديث الآن</button></div></div><div class="las-grid"><div class="las-k"><small>آخر دورة ناجحة</small><b>${esc(lastText)}</b></div><div class="las-k"><small>الدورة القادمة</small><b id="v169NextCycle">${esc(nextText)}</b></div><div class="las-k"><small>Live Quotes</small><b>${liveCount}/${total||0}</b></div><div class="las-k"><small>Fallback</small><b>${fallbackCount}</b></div><div class="las-k"><small>تغيرات القرار</small><b>${changeCount}</b></div></div><div style="font-size:10px;color:${error?'#ffd0d5':partial?'#ffe2a1':'#bdebdc'}">${error?`فشل آخر تحديث: ${esc(error.message||error)}`:partial?'الدورة اكتملت لكن بعض الأسعار من آخر إغلاق؛ لا تُعامل كتحديث حي.':'الدورة مكتملة؛ السعر اللحظي مصدر متأخر ~15 دقيقة ويعاد طلبه كل 5 دقائق.'} · التوصية الرسمية V16.9 لا تتغير إلا إذا نشر المحرك Snapshot جديدًا.</div>`;
    panel.querySelector('#v169RefreshNow')?.addEventListener('click',()=>refreshCycle('manual',true));panel.querySelector('#v169NotifyBtn')?.addEventListener('click',async()=>{if(!('Notification'in window))return toast('المتصفح لا يدعم إشعارات النظام.');const p=await Notification.requestPermission();toast(p==='granted'?'تم تفعيل التنبيهات.':'لم يتم منح إذن التنبيهات.');renderStatus(null,liveCount,fallbackCount,0)});
  }

  async function analyzeAll(tickers){
    latestAnalyses=new Map();for(const ticker of tickers){try{const history=await loadHistory(ticker),analysis=Core.analyze(history,latestQuotes.get(ticker)||null);latestAnalyses.set(ticker,analysis)}catch(error){latestAnalyses.set(ticker,{ready:false,reason:error.message})}}
  }
  function buildActions(){
    const recs=recommendationMap(),holdings=new Map(latestPortfolio.map(x=>[x.ticker,x]));latestActions=new Map();const tickers=new Set([...recs.keys(),...holdings.keys()]);for(const ticker of tickers){const a=Core.advisory({holding:holdings.get(ticker)||null,recommendation:recs.get(ticker)||null,analysis:latestAnalyses.get(ticker)||null,quote:latestQuotes.get(ticker)||null});latestActions.set(ticker,a)}
  }

  async function refreshCycle(reason='timer',force=false){
    if(refreshing)return;refreshing=true;lastAttemptAt=Date.now();try{
      await ensureCore();await loadStateFiles();const rawPortfolio=readPortfolioRows();latestPortfolio=Core.normalizePortfolio(rawPortfolio);const recs=recommendationMap(),tickers=[...new Set([...recs.keys(),...latestPortfolio.map(x=>x.ticker)])];const q=await fetchQuotes(tickers,force);latestQuotes=q.map;await analyzeAll(tickers);buildActions();lastSuccessAt=Date.now();nextDueAt=lastSuccessAt+REFRESH_MS;const changes=detectChanges();applyRecommendationCards();renderPortfolioPanel();const live=[...latestQuotes.values()].filter(x=>x._mode==='LIVE_DELAYED').length,fallback=[...latestQuotes.values()].filter(x=>x._mode!=='LIVE_DELAYED').length;renderStatus(null,live,fallback,changes);window.__V169_ACTIVE_POSITION_MANAGER_READY__=true;window.__V169_ACTIVE_POSITION_MANAGER_DEBUG__={version:VERSION,reason,lastSuccessAt:new Date(lastSuccessAt).toISOString(),nextDueAt:new Date(nextDueAt).toISOString(),portfolioKey:CANONICAL_PORTFOLIO_KEY,portfolioCount:latestPortfolio.length,recommendationCount:recs.size,liveQuotes:live,fallbackQuotes:fallback,refreshMs:REFRESH_MS,automaticOrders:false};
    }catch(error){console.warn('V16.9 professional advisory refresh failed',error);nextDueAt=Date.now()+REFRESH_MS;renderStatus(error,0,0,0);window.__V169_ACTIVE_POSITION_MANAGER_READY__=false;window.__V169_ACTIVE_POSITION_MANAGER_DEBUG__={version:VERSION,error:String(error?.message||error),lastAttemptAt:new Date(lastAttemptAt).toISOString(),refreshMs:REFRESH_MS}}
    finally{refreshing=false;scheduleNext()}
  }

  function scheduleNext(){clearTimeout(refreshTimer);const wait=Math.max(1000,(nextDueAt||Date.now()+REFRESH_MS)-Date.now());refreshTimer=setTimeout(()=>refreshCycle('timer',false),wait)}
  function apply(){applyRecommendationCards();renderPortfolioPanel();return latestActions.size}
  window.__V169_ACTIVE_POSITION_MANAGER_APPLY__=apply;

  function bridgePortfolioChanges(){
    document.addEventListener('click',event=>{const target=event.target?.closest?.('#addPortfolioBtn,#clearPortfolioBtn,#portfolioRows [data-r]');if(!target)return;setTimeout(()=>{readPortfolioRows();refreshCycle('portfolio-change',false)},120)},true);
    window.addEventListener('storage',event=>{if(event.key===CANONICAL_PORTFOLIO_KEY)refreshCycle('portfolio-storage',false)});
  }

  function start(){
    ensureStyle();ensureStatus();ensurePortfolioPanel();bridgePortfolioChanges();refreshCycle('start',true);clearInterval(clockTimer);clockTimer=setInterval(()=>{const el=document.getElementById('v169NextCycle');if(!el||!nextDueAt)return;const sec=Math.max(0,Math.ceil((nextDueAt-Date.now())/1000)),m=Math.floor(sec/60),s=sec%60;el.textContent=`${m}:${String(s).padStart(2,'0')}`},1000);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)return;if(!lastSuccessAt||Date.now()-lastSuccessAt>=REFRESH_MS)refreshCycle('visibility-catchup',false);else apply()});window.addEventListener('focus',()=>{if(!lastSuccessAt||Date.now()-lastSuccessAt>=REFRESH_MS)refreshCycle('focus-catchup',false)});window.addEventListener('pageshow',()=>{if(!lastSuccessAt||Date.now()-lastSuccessAt>=REFRESH_MS)refreshCycle('pageshow-catchup',false)});
    [250,800,1800,3500].forEach(ms=>setTimeout(apply,ms));
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
