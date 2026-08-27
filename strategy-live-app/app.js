const $ = (id) => document.getElementById(id);
const clamp = (n,a=0,b=100) => Math.max(a,Math.min(b,Number(n)||0));
const num = (v,d=1) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—';
const esc = (s='') => String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

const state = {
  market: [], verified: new Map(), verifiedRaw: null, currentView: 'near',
  watch: new Set(JSON.parse(localStorage.getItem('sx-watch') || '["ETEL"]')),
  watchData: new Map(), lastStates: JSON.parse(localStorage.getItem('sx-watch-states') || '{}'),
  refreshTimer: null, detailsCache: new Map()
};

const weights = [
  ['جودة الاتجاه',20],['القوة النسبية',15],['الزخم',10],['الحجم / التجميع',15],
  ['جودة الدخول',15],['المخاطر / العائد',15],['الأساسيات',10]
];

function fundamentalScore(v){
  if(!v) return 50;
  const q = String(v.fundamentalQuality||'').toUpperCase();
  return q==='VERY_STRONG'?92:q==='STRONG'?84:q==='GOOD'?76:q==='IMPROVING'?66:55;
}
function verificationInfo(sym){ return state.verified.get(String(sym).toUpperCase()) || null; }
function momentumScore(r){
  const r63 = Number(r?.audit_stages?.relative_strength?.raw?.R63 ?? 0);
  return clamp(((r63 + 20) / 70) * 100);
}
function riskScore(r){
  const explicit = Number(r?.audit_stages?.risk?.score);
  if(Number.isFinite(explicit)) return clamp(explicit);
  const rr=Number(r?.reward_risk||0), risk=Number(r?.risk_pct||99);
  return clamp((rr/3)*70 + Math.max(0,(8-risk)/8)*30);
}
function externalScore(r){
  const v=verificationInfo(r.symbol);
  const trend=clamp(r?.trend_template?.score ?? r?.audit_stages?.trend?.score);
  const rs=clamp(r?.rs_percentile);
  const momentum=momentumScore(r);
  const volume=clamp(r?.audit_stages?.volume?.score ?? r?.volume?.dry_up_score ?? 50);
  const entry=clamp(r?.entry_readiness_score ?? r?.audit_stages?.entry?.score);
  const risk=riskScore(r);
  const fund=fundamentalScore(v);
  return +(trend*.20 + rs*.15 + momentum*.10 + volume*.15 + entry*.15 + risk*.15 + fund*.10).toFixed(1);
}
function revisedDecision(r){
  const v=verificationInfo(r.symbol);
  const verified = v && ['VERIFIED','VERIFIED_HIGH'].includes(v.verification?.status);
  const strongFund = v && ['STRONG','VERY_STRONG'].includes(String(v.fundamentalQuality||''));
  const trend=Number(r?.trend_template?.score||0), rs=Number(r?.rs_percentile||0), rr=Number(r?.reward_risk||0), entry=Number(r?.entry_readiness_score||0);
  const status=String(r?.status||'').toUpperCase(), action=String(r?.action||'').toUpperCase();
  const score=externalScore(r);
  if(status.includes('FAILED')) return strongFund?'WATCH — EXCELLENT FUNDAMENTALS / WRONG ENTRY':'AVOID — FAILED BREAKOUT';
  if(status.includes('EXTENDED')) return 'WATCH — WAIT FOR PULLBACK';
  if(trend<60 || rs<20 || action==='AVOID') return strongFund?'WATCH — FUNDAMENTALS STRONG / TECHNICAL WEAK':'AVOID — TECHNICAL EDGE WEAK';
  if(entry>=75 && trend>=85 && rs>=70 && rr>=2){
    if(verified && strongFund && score>=82) return score>=90?'A+ — EXCEPTIONAL OPPORTUNITY':'A — STRONG OPPORTUNITY';
    return 'B+ — TACTICAL / FUNDAMENTALS UNVERIFIED';
  }
  if(status.includes('NEAR')) return verified?'WATCH — VERIFIED / WAIT TRIGGER':'WATCH — NEAR TRIGGER';
  return verified?'WATCH — VERIFIED QUALITY':'WATCH — FORMING';
}
function decisionClass(d){ return d.startsWith('A')||d.startsWith('B+')?'actionable':d.startsWith('AVOID')?'avoid':'watch'; }
function breakoutState(r){
  if(!r) return {key:'NO_DATA',label:'لا توجد بيانات',tone:'watch'};
  const status=String(r.status||'').toUpperCase();
  if(status.includes('FAILED')) return {key:'FAILED',label:'اختراق فاشل',tone:'avoid'};
  if(status.includes('EXTENDED')) return {key:'EXTENDED',label:'ممتد — لا تطارد',tone:'watch'};
  const p=Number(r.last_price), pivot=Number(r.pivot), dist=Math.abs(Number(r.distance_to_pivot_pct));
  const br=Number(r?.volume?.breakout_ratio || r?.audit_stages?.entry?.raw?.breakout_volume_ratio || 0);
  const retest=!!r?.strategy_lab?.structure_retest?.pass;
  if(Number.isFinite(p)&&Number.isFinite(pivot)&&p>=pivot){
    if(br>=1.4 && retest) return {key:'CONFIRMED',label:'اختراق مؤكد',tone:'actionable'};
    if(br>=1.4) return {key:'TRIGGERED_VOLUME',label:'اختراق بحجم — انتظار Retest',tone:'actionable'};
    return {key:'TRIGGERED',label:'تجاوز Pivot — غير مؤكد',tone:'watch'};
  }
  if(Number.isFinite(dist)&&dist<=3.5) return {key:'NEAR',label:`قريب من الاختراق • ${num(dist,2)}%`,tone:'watch'};
  return {key:'WATCH',label:'تحت المراقبة',tone:'watch'};
}
function toast(msg,tone=''){ const el=document.createElement('div');el.className=`toast ${tone}`;el.textContent=msg;$('toastStack').append(el);setTimeout(()=>el.remove(),4200); }
function notify(title,body){
  if('Notification' in window && Notification.permission==='granted') new Notification(title,{body});
}
function saveWatch(){ localStorage.setItem('sx-watch',JSON.stringify([...state.watch])); $('watchCount').textContent=state.watch.size; }

async function fetchJSON(url){
  const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(`${r.status}`); return r.json();
}
async function loadVerified(){
  const d=await fetchJSON('/data/verified.json'); state.verifiedRaw=d; state.verified.clear();
  for(const r of d.records||[]) state.verified.set(r.symbol,r);
  renderAudit();
}
async function loadMarket(view=state.currentView){
  state.currentView=view; $('opportunityGrid').innerHTML='<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try{
    const d=await fetchJSON(`/sx/opportunities/${encodeURIComponent(view)}`);
    state.market=Array.isArray(d)?d:(d.data||[]);
    renderMarket(); updateMarketHero(); setUpdated();
  }catch(e){ $('opportunityGrid').innerHTML='<div class="empty">تعذر قراءة SEPA-X حاليًا. أعد المحاولة.</div>'; $('sourceBadge').className='pill red'; $('sourceBadge').textContent='المصدر غير متاح'; }
}
async function getStock(symbol,force=false){
  symbol=String(symbol).toUpperCase(); if(!force&&state.detailsCache.has(symbol)) return state.detailsCache.get(symbol);
  const d=await fetchJSON(`/sx/stock/${encodeURIComponent(symbol)}/analysis`); state.detailsCache.set(symbol,d); return d;
}
function renderMarket(){
  const decision=$('decisionFilter').value, minRS=Number($('rsFilter').value||0), verifiedOnly=$('verifiedOnly').checked;
  let rows=[...state.market].filter(r=>Number(r.rs_percentile||0)>=minRS);
  if(verifiedOnly) rows=rows.filter(r=>['VERIFIED','VERIFIED_HIGH'].includes(verificationInfo(r.symbol)?.verification?.status));
  rows=rows.filter(r=>{ const dc=decisionClass(revisedDecision(r)); return decision==='ALL'||decision===dc.toUpperCase()||(decision==='WATCH'&&dc==='watch')||(decision==='AVOID'&&dc==='avoid'); });
  rows.sort((a,b)=>externalScore(b)-externalScore(a));
  $('resultCount').textContent=`${rows.length} سهم`;
  $('opportunityGrid').innerHTML=rows.length?rows.map(stockCard).join(''):'<div class="empty">لا توجد نتائج وفق الفلاتر الحالية.</div>';
  bindCardActions();
}
function stockCard(r){
  const v=verificationInfo(r.symbol), ver=v?.verification?.status||'UNVERIFIED', conf=v?.verification?.confidence??0;
  const dec=revisedDecision(r), dc=decisionClass(dec), score=externalScore(r), br=breakoutState(r);
  const accent=dc==='actionable'?'#39e58c':dc==='avoid'?'#ff6b6b':'#f2bd4b';
  return `<article class="stock-card" style="--accent:${accent}">
    <div class="stock-head"><div><div class="stock-symbol">${esc(r.symbol)}</div><div class="stock-name">${esc(r.name||'')}</div></div><span class="classification ${dc==='watch'?'watch':dc==='avoid'?'avoid':''}">${esc(dec.split(' — ')[0])}</span></div>
    <div class="stock-score-row"><div class="score-cell"><b>${num(score,1)}</b><small>External Score</small></div><div class="score-cell"><b>${num(r.last_price,2)}</b><small>السعر</small></div><div class="score-cell"><b>${num(r.pivot,2)}</b><small>Pivot</small></div></div>
    ${progress('Trend',r?.trend_template?.score||0)}${progress('RS',r?.rs_percentile||0)}${progress('Entry',r?.entry_readiness_score||0)}
    <div class="decision-box"><b>${esc(dec)}</b><br>${esc(br.label)} • R/R ${num(r.reward_risk,2)} • Fund ${esc(ver)} ${conf?conf+'%':''}</div>
    <div class="card-actions"><button class="btn secondary details" data-symbol="${esc(r.symbol)}">التفاصيل</button><button class="btn ghost watch" data-symbol="${esc(r.symbol)}">${state.watch.has(r.symbol)?'إلغاء المراقبة':'راقب الاختراق'}</button></div>
  </article>`;
}
function progress(label,val){ return `<div class="progress-line"><span>${label}</span><span class="bar"><span style="width:${clamp(val)}%"></span></span><b>${num(val,0)}</b></div>`; }
function bindCardActions(){
  document.querySelectorAll('.details').forEach(b=>b.onclick=()=>openDetails(b.dataset.symbol));
  document.querySelectorAll('.watch').forEach(b=>b.onclick=()=>toggleWatch(b.dataset.symbol));
}
function updateMarketHero(){
  const all=[...state.market].sort((a,b)=>externalScore(b)-externalScore(a)), best=all[0]; if(!best)return;
  $('heroSymbol').textContent=best.symbol; $('heroTitle').textContent=best.name||revisedDecision(best);
  $('heroMetrics').innerHTML=`<span class="pill ok">Score ${num(externalScore(best),1)}</span><span class="pill">RS ${num(best.rs_percentile,0)}</span><span class="pill">Pivot ${num(best.pivot,2)}</span><span class="pill">R/R ${num(best.reward_risk,2)}</span>`;
  $('heroDetailsBtn').onclick=()=>openDetails(best.symbol); $('heroWatchBtn').onclick=()=>toggleWatch(best.symbol);
  const action=all.filter(x=>decisionClass(revisedDecision(x))==='actionable').length, watch=all.filter(x=>decisionClass(revisedDecision(x))==='watch').length, avoid=all.length-action-watch;
  $('marketState').textContent=action?'توجد فرص مشروطة':'سوق انتقائي — لا مطاردة';
  $('marketCounters').innerHTML=`<div class="mini-metric"><b>${action}</b><small>قابل للتنفيذ</small></div><div class="mini-metric"><b>${watch}</b><small>مراقبة</small></div><div class="mini-metric"><b>${avoid}</b><small>تجنب</small></div><div class="mini-metric"><b>${all.length}</b><small>المفحوص</small></div>`;
}
async function openDetails(symbol){
  $('dialogSymbol').textContent=symbol; $('dialogName').textContent='تحميل التحليل الحي…'; $('dialogBody').innerHTML='<div class="skeleton"></div>'; $('detailsDialog').showModal();
  try{
    const r=await getStock(symbol,true), v=verificationInfo(symbol), dec=revisedDecision(r), br=breakoutState(r);
    $('dialogName').textContent=r.name||symbol;
    const vs=v?.verification||{};
    $('dialogBody').innerHTML=`<div class="detail-grid">
      ${detail('السعر',num(r.last_price,2))}${detail('Pivot',num(r.pivot,2))}${detail('Stop',num(r.stop_loss,2))}${detail('R/R',num(r.reward_risk,2))}
      ${detail('Trend',num(r.trend_template?.score,0))}${detail('RS',num(r.rs_percentile,1))}${detail('Entry',num(r.entry_readiness_score,0))}${detail('External',num(externalScore(r),1))}
    </div>
    <div class="detail-section"><h3>القرار المصحح</h3><div class="rule-box"><b>${esc(dec)}</b><br>${esc(br.label)}. Fundamentals: ${esc(vs.status||'UNVERIFIED')} ${vs.confidence??0}%.</div></div>
    <div class="detail-section"><h3>خطة الاختراق</h3><p class="detail-text">Trigger/Pivot: <b>${num(r.pivot,2)}</b> • Entry Zone: <b>${num(r.entry_zone?.from,2)} – ${num(r.entry_zone?.to,2)}</b> • Stop: <b>${num(r.stop_loss,2)}</b> • مخاطرة ${num(r.risk_pct,2)}% • Breakout Volume Ratio ${num(r.volume?.breakout_ratio,2)}.</p></div>
    <div class="detail-section"><h3>سبب الاختيار / المخاطر</h3><p class="detail-text">${esc((r.why_selected||[]).join(' • ')||'—')}<br><span style="color:#ffaaaa">${esc((r.risks||[]).join(' • ')||'لا توجد مخاطر مسجلة من المصدر')}</span></p></div>
    <div class="detail-section"><button class="btn primary" id="dialogWatch">${state.watch.has(symbol)?'إلغاء مراقبة الاختراق':'إضافة لمراقبة الاختراق'}</button></div>`;
    $('dialogWatch').onclick=()=>{toggleWatch(symbol);openDetails(symbol)};
  }catch(e){ $('dialogName').textContent=symbol; $('dialogBody').innerHTML='<div class="empty">تعذر جلب التحليل الحي لهذا السهم.</div>'; }
}
function detail(k,v){return `<div class="detail-box"><b>${v}</b><small>${k}</small></div>`}
function toggleWatch(symbol){
  symbol=String(symbol).toUpperCase(); if(state.watch.has(symbol)){state.watch.delete(symbol);state.watchData.delete(symbol);toast(`تم إلغاء مراقبة ${symbol}`,'warn')} else {state.watch.add(symbol);toast(`بدأت مراقبة اختراق ${symbol}`);}
  saveWatch(); renderMarket(); refreshWatch();
}
async function refreshWatch(){
  if(!state.watch.size){renderWatch();return;}
  const syms=[...state.watch];
  await Promise.all(syms.map(async s=>{try{const r=await getStock(s,true);state.watchData.set(s,r);const bs=breakoutState(r);const old=state.lastStates[s];if(old&&old!==bs.key){toast(`${s}: ${bs.label}`,bs.tone==='avoid'?'bad':bs.tone==='watch'?'warn':'');notify(`SEPA-X Breakout Monitor — ${s}`,bs.label);}state.lastStates[s]=bs.key;}catch(e){}}));
  localStorage.setItem('sx-watch-states',JSON.stringify(state.lastStates)); renderWatch(); setUpdated();
}
function renderWatch(){
  $('watchCount').textContent=state.watch.size;
  const rows=[...state.watch].map(s=>state.watchData.get(s)).filter(Boolean), counts={CONFIRMED:0,NEAR:0,FAILED:0,OTHER:0};
  rows.forEach(r=>{const k=breakoutState(r).key;if(k==='CONFIRMED'||k==='TRIGGERED_VOLUME')counts.CONFIRMED++;else if(k==='NEAR')counts.NEAR++;else if(k==='FAILED')counts.FAILED++;else counts.OTHER++;});
  $('breakoutSummary').innerHTML=`${summary(counts.CONFIRMED,'Triggered')}${summary(counts.NEAR,'Near Pivot')}${summary(counts.FAILED,'Failed')}${summary(state.watch.size,'Total Watch')}`;
  $('watchGrid').innerHTML=state.watch.size?(rows.length?rows.map(watchCard).join(''):'<div class="empty">جاري فحص قائمة المراقبة…</div>'):'<div class="empty">قائمة المراقبة فارغة. أضف سهمًا من لوحة الفرص.</div>';
  document.querySelectorAll('.remove-watch').forEach(b=>b.onclick=()=>toggleWatch(b.dataset.symbol));
}
function summary(n,l){return `<div class="summary-box"><b>${n}</b><small>${l}</small></div>`}
function watchCard(r){
  const bs=breakoutState(r), p=Number(r.last_price||0), pivot=Number(r.pivot||0), pct=pivot?clamp((p/pivot)*100,0,120):0;
  return `<article class="watch-card"><div class="watch-top"><div><div class="watch-symbol">${esc(r.symbol)}</div><div class="stock-name">${esc(r.name||'')}</div></div><span class="classification ${bs.tone==='avoid'?'avoid':bs.tone==='watch'?'watch':''}">${esc(bs.label)}</span></div>
  <div class="trigger-track"><div class="fill" style="width:${Math.min(100,pct)}%"></div></div><div class="trigger-row"><span>السعر ${num(p,2)}</span><span>Pivot ${num(pivot,2)}</span></div>
  <div class="watch-metrics">${watchMetric('Distance',`${num(r.distance_to_pivot_pct,2)}%`)}${watchMetric('Volume',num(r.volume?.breakout_ratio,2))}${watchMetric('RS',num(r.rs_percentile,0))}${watchMetric('R/R',num(r.reward_risk,2))}</div>
  <div class="card-actions"><button class="btn secondary details" onclick="void(0)" data-symbol="${esc(r.symbol)}">فتح التحليل</button><button class="btn ghost danger remove-watch" data-symbol="${esc(r.symbol)}">إزالة</button></div></article>`;
}
function watchMetric(k,v){return `<div class="watch-metric"><b>${v}</b><small>${k}</small></div>`}
function renderAudit(){
  const rows=state.verifiedRaw?.records||[];
  $('auditTable').innerHTML=rows.map(v=>{const x=v.verification||{};return `<article class="audit-row"><div class="sym">${esc(v.symbol)}</div><div class="desc"><b>${esc(v.fundamentalQuality||'UNKNOWN')}</b><br>${esc(v.rationale||'')}</div><div><span class="pill ${x.status==='VERIFIED_HIGH'?'ok':x.status==='VERIFIED'?'':'warning'}">${esc(x.status||'UNVERIFIED')}</span></div><div class="pct">${x.confidence??0}%</div><div>${esc(x.model||'—')}</div></article>`}).join('');
}
function renderWeights(){ $('weightsChart').innerHTML=weights.map(([n,w])=>`<div class="weight-row"><span>${n}</span><span class="bar"><span style="width:${w*5}%"></span></span><b>${w}%</b></div>`).join(''); }
function setUpdated(){ $('lastUpdate').textContent=`آخر فحص ${new Date().toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`; $('sourceBadge').className='pill ok'; $('sourceBadge').textContent='SEPA-X • READ ONLY'; }

async function doSearch(){ const s=$('symbolSearch').value.trim().toUpperCase();if(!s)return;await openDetails(s); }
async function enableNotifications(){
  if(!('Notification' in window)){toast('المتصفح لا يدعم التنبيهات','warn');return}
  const p=await Notification.requestPermission();toast(p==='granted'?'تم تفعيل تنبيهات الاختراق':'لم يتم السماح بالتنبيهات',p==='granted'?'':'warn');
}
function setupEvents(){
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));t.classList.add('active');$(t.dataset.tab).classList.add('active');if(t.dataset.tab==='monitor')refreshWatch();});
  $('dialogClose').onclick=()=>$('detailsDialog').close();
  $('refreshBtn').onclick=async()=>{state.detailsCache.clear();await Promise.all([loadMarket(),refreshWatch()]);toast('تم تحديث البيانات الحية')};
  $('monitorRefreshBtn').onclick=refreshWatch; $('clearWatchBtn').onclick=()=>{state.watch.clear();saveWatch();renderWatch();toast('تم مسح قائمة المراقبة','warn')};
  $('notifyBtn').onclick=enableNotifications; $('searchBtn').onclick=doSearch; $('symbolSearch').onkeydown=e=>{if(e.key==='Enter')doSearch()};
  $('viewFilter').onchange=e=>loadMarket(e.target.value); $('decisionFilter').onchange=renderMarket; $('rsFilter').oninput=renderMarket; $('verifiedOnly').onchange=renderMarket;
}

async function init(){
  renderWeights(); setupEvents(); saveWatch();
  try{await loadVerified()}catch(e){toast('تعذر تحميل سجل التحقق المالي','warn')}
  await loadMarket('near'); await refreshWatch();
  state.refreshTimer=setInterval(()=>refreshWatch(),30000);
}
init();
