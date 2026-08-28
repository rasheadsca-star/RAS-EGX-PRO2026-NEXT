import { marketPhase } from './session-monitor-core.js';

const KEYS = Object.freeze({
  archive:'egx-tfe-rc2-v169-forward-archive',
  portfolio:'egx-tfe-rc2-v169-portfolio',
  settings:'egx-tfe-rc2-v169-risk-settings',
  alerts:'egx-tfe-rc2-v169-alerts',
  readAlerts:'egx-tfe-rc2-v169-read-alerts',
  notified:'egx-tfe-rc2-v169-notified-alerts',
});
const API='/api/index';
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const fmt=(v,d=2)=>n(v)===null?'—':Number(v).toLocaleString('en-GB',{maximumFractionDigits:d});
const pct=v=>n(v)===null?'—':`${fmt(v,2)}%`;
const money=v=>n(v)===null?'—':`${Number(v).toLocaleString('en-GB',{maximumFractionDigits:0})} ج.م`;
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
const save=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const state={monitor:window.__RC2_SESSION_MONITOR_LAST__||null,alerts:load(KEYS.alerts,[]),corrCache:null,corrCacheAt:0};

function latestSignals(){
  const rows=load(KEYS.archive,[]);
  if(!Array.isArray(rows)||!rows.length)return[];
  const session=rows.map(x=>x.sessionDate).filter(Boolean).sort().at(-1);
  return rows.filter(x=>x.sessionDate===session&&x.ticker&&n(x.entryLow)>0&&n(x.entryHigh)>=n(x.entryLow)&&n(x.stop)>0&&n(x.target1)>0)
    .sort((a,b)=>(n(b.fusionRank)??-1)-(n(a.fusionRank)??-1)||String(a.ticker).localeCompare(String(b.ticker)));
}

async function history(ticker,limit=80){
  const q=new URLSearchParams({route:'history',ticker,limit:String(limit),t:String(Date.now())});
  const r=await fetch(`${API}?${q}`,{cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(`HISTORY_${ticker}_${r.status}`);
  return Array.isArray(d.bars)?d.bars:[];
}

function ensureStyle(){
  if(document.getElementById('rc2OpsV169Style'))return;
  const s=document.createElement('style');s.id='rc2OpsV169Style';s.textContent=`
    .ops-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px}.ops-card{background:#0a2437;border:1px solid #28516a;border-radius:14px;padding:13px}.ops-card h3{margin:0 0 7px;font-size:15px}.ops-card p{margin:0;color:#9db8c8;font-size:10px;line-height:1.75}.ops-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}.ops-metric{padding:8px;border-radius:9px;background:#071823;border:1px solid #17384a}.ops-metric small{display:block;color:#8eacbc;font-size:9px;margin-bottom:5px}.ops-metric b{font-size:12px}.ops-list{display:grid;gap:7px;margin-top:10px}.ops-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px;border:1px solid #1f4358;border-radius:9px;background:#071b29;font-size:10px}.ops-row small{color:#9db8c8}.ops-note{margin-top:10px;padding:9px;border-radius:9px;background:#122b35;color:#cfe1e9;font-size:10px;line-height:1.7}.ops-note.warn{background:#302718;color:#ffe5a5}.ops-note.bad{background:#341b22;color:#ffd0d5}.ops-pill{display:inline-flex;padding:5px 8px;border-radius:999px;border:1px solid #3b647c;font-size:9px}.ops-pill.good{border-color:#2f8a66;color:#caffdf}.ops-pill.warn{border-color:#86672e;color:#ffe3a0}.ops-pill.bad{border-color:#8b4451;color:#ffccd2}.ops-pill.neutral{color:#cbefff}.ops-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.ops-drawer{position:fixed;inset:0;z-index:120;display:none}.ops-drawer.open{display:block}.ops-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.62)}.ops-panel{position:absolute;left:0;top:0;bottom:0;width:min(430px,92vw);background:#071927;border-right:1px solid #315b73;padding:14px;overflow:auto}.ops-panel-head{display:flex;justify-content:space-between;gap:10px;align-items:center;position:sticky;top:0;background:#071927;padding-bottom:10px;z-index:2}.ops-alert{padding:10px;border:1px solid #28516a;border-radius:10px;background:#0a2234;margin-bottom:8px}.ops-alert.good{border-color:#2f795c}.ops-alert.warn{border-color:#84662e}.ops-alert.bad{border-color:#8b4451}.ops-alert h4{margin:0 0 5px;font-size:12px}.ops-alert p{margin:0;color:#b9ceda;font-size:10px;line-height:1.65}.ops-actions{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.ops-alert-button{position:relative}.ops-alert-count{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:999px;background:#b43d4c;color:white;font-size:9px;margin-inline-start:5px;padding:0 5px}.ops-table{width:100%;border-collapse:collapse;margin-top:8px}.ops-table th,.ops-table td{font-size:9px;padding:7px;border-bottom:1px solid #17384a;white-space:nowrap}.ops-split{display:grid;grid-template-columns:1.4fr 1fr;gap:12px;margin-bottom:12px}@media(max-width:980px){.ops-grid,.ops-split{grid-template-columns:1fr}}`;
  document.head.appendChild(s);
}

function ensureShell(){
  ensureStyle();
  const top=document.querySelector('.top-actions');
  if(top&&!document.getElementById('opsAlertsButton'))top.insertAdjacentHTML('beforeend','<button class="btn ops-alert-button" id="opsAlertsButton" type="button">التنبيهات <span class="ops-alert-count" id="opsAlertsCount">0</span></button>');
  if(!document.getElementById('opsAlertDrawer'))document.body.insertAdjacentHTML('beforeend',`<aside class="ops-drawer" id="opsAlertDrawer" aria-hidden="true"><div class="ops-backdrop" id="opsAlertsBackdrop"></div><section class="ops-panel" role="dialog" aria-modal="true" aria-label="مركز تنبيهات RC2"><div class="ops-panel-head"><div><b>مركز التنبيهات</b><div style="font-size:9px;color:#9db8c8">Session Monitor فقط — لا يغير RC2</div></div><button class="btn" id="opsCloseAlerts">إغلاق</button></div><div class="ops-actions"><button class="btn primary" id="opsEnableNotifications">تفعيل إشعارات المتصفح</button><button class="btn" id="opsMarkRead">تحديد الكل كمقروء</button></div><div id="opsAlertsList"></div></section></aside>`);
  const dash=document.getElementById('view-dashboard');
  if(dash&&!document.getElementById('opsDecisionContext')){
    const monitor=document.getElementById('rc2SessionMonitorPanel');
    const html=`<div class="ops-grid" id="opsDecisionContext"><article class="ops-card" id="opsFreshness"><h3>حداثة التوصية</h3></article><article class="ops-card" id="opsMorning"><h3>تأكيد الافتتاح</h3></article><article class="ops-card" id="opsBasket"><h3>سلة المرشحين</h3></article></div>`;
    if(monitor)monitor.insertAdjacentHTML('afterend',html);else dash.insertAdjacentHTML('afterbegin',html);
  }
  const pf=document.getElementById('view-portfolio');
  if(pf&&!document.getElementById('opsPortfolioRisk'))pf.insertAdjacentHTML('afterbegin',`<div class="ops-split" id="opsPortfolioRisk"><article class="ops-card"><div class="ops-head"><div><h3>الارتباط ومخاطر التركّز</h3><p>Correlation من العوائد اليومية التاريخية للمراكز التجريبية فقط.</p></div><button class="btn" id="opsRefreshRisk">تحديث</button></div><div id="opsCorrelationBody"></div></article><article class="ops-card"><h3>Portfolio Stress Test</h3><div id="opsStressBody"></div></article></div>`);
  const ev=document.getElementById('view-evidence');
  if(ev&&!document.getElementById('opsRegimeEvidence'))ev.insertAdjacentHTML('afterbegin',`<article class="panel" id="opsRegimeEvidence"><div class="panel-head"><div><h2>Market Regime — Evidence Only</h2><p>واجهة Bull / Sideways / Bear منفصلة عن Alpha. لا تغيّر المخاطرة أو التوصيات تلقائيًا.</p></div><span class="badge neutral">scoringImpact = NONE</span></div><div style="padding:12px" id="opsRegimeBody"></div></article>`);
}

function currentScanMeta(){
  const payload=window.__RC2_UI_SCAN__||{};
  const scan=payload.scan||{};
  const dataSession=payload.effectiveDate||scan?.universe?.sessionDate||null;
  const published=n(scan?.summary?.publicationEligibleTotal)??(Array.isArray(scan?.recommendations)?scan.recommendations.length:null);
  return{dataSession,published};
}

function freshnessModel(){
  const signals=latestSignals();const phase=marketPhase();const session=signals[0]?.sessionDate||null;
  const {dataSession,published}=currentScanMeta();
  if(!session){
    if(dataSession&&published===0)return{cls:'neutral',label:`جلسة ${dataSession}: لا توصيات`,detail:`بيانات جلسة ${dataSession} محدثة، لكن 0 سهم اجتاز جميع بوابات النشر؛ لا توجد توصية مجمدة جديدة.`};
    return{cls:'warn',label:'لا توجد إشارة مجمدة',detail:'في انتظار أول Recommendation Snapshot.'};
  }
  if(dataSession&&session<dataSession){
    const phaseNote=phase.phase==='WEEKEND'?`السوق مغلق الآن (${phase.date})`:`حالة السوق الآن ${phase.phase}`;
    if(published===0)return{cls:'neutral',label:`جلسة ${dataSession}: لا توصيات جديدة`,detail:`تم تحديث وفحص جلسة ${dataSession}، لكن 0 سهم اجتاز بوابات النشر. Snapshot ${session} سجل متابعة تاريخي فقط؛ ${phaseNote}.`};
    return{cls:'warn',label:'Snapshot أقدم من جلسة البيانات',detail:`جلسة البيانات ${dataSession} أحدث من Snapshot ${session}. لا يُعرض القديم كتوصية حالية؛ ${phaseNote}.`};
  }
  if(session===dataSession||(!dataSession&&session===phase.date))return{cls:'good',label:`Snapshot جلسة ${session}`,detail:`الإشارة متطابقة مع آخر جلسة بيانات مكتملة. حالة المتابعة ${phase.phase}.`};
  if(session<phase.date&&phase.phase==='OPEN')return{cls:'good',label:'إشارة مجمدة تحت المتابعة',detail:`خطة ${session} تُتابع الآن في جلسة ${phase.date}; لا يعاد حساب Alpha داخل الجلسة.`};
  if(session<phase.date)return{cls:'neutral',label:'إشارة سابقة — Reference/Tracking',detail:`Snapshot ${session} سجل متابعة فقط. السوق مغلق الآن بتاريخ ${phase.date} (${phase.phase}).`};
  return{cls:'bad',label:'تاريخ الإشارة غير متسق',detail:`Signal ${session} > Cairo ${phase.date}`};
}

function renderFreshness(){
  const box=document.getElementById('opsFreshness');if(!box)return;const f=freshnessModel();
  box.innerHTML=`<div class="ops-head"><div><h3>حداثة التوصية</h3><p>التوصية نفسها مجمدة؛ الذي يتغير فقط هو موقفها أثناء الجلسة.</p></div><span class="ops-pill ${f.cls}">${esc(f.label)}</span></div><div class="ops-note ${f.cls==='bad'?'bad':f.cls==='warn'?'warn':''}">${esc(f.detail)}</div>`;
}

function morningRows(){
  const detail=state.monitor||{};const signals=detail.signals||latestSignals();const quotes=new Map((detail.quotes||[]).map(q=>[q.ticker,q]));const phase=detail.phase||marketPhase();
  return signals.map(s=>{
    const q=quotes.get(s.ticker);if(!q||q.sourceSessionDate!==phase.date)return{ticker:s.ticker,label:'غير متاح لجلسة اليوم',cls:'warn',detail:'لا يوجد Open حديث من مصدر المتابعة.'};
    const open=n(q.open),lo=n(s.entryLow),hi=n(s.entryHigh);if(!(open>0&&lo>0&&hi>=lo))return{ticker:s.ticker,label:'بيانات غير كافية',cls:'bad',detail:'Open/Entry غير صالح.'};
    if(open>=lo&&open<=hi)return{ticker:s.ticker,label:'Open داخل منطقة الدخول',cls:'good',detail:`Open ${fmt(open,4)} داخل ${fmt(lo,4)}–${fmt(hi,4)}.`};
    if(open>hi)return{ticker:s.ticker,label:'Open أعلى من الدخول',cls:'warn',detail:`انتظار Pullback؛ ممنوع تحويلها إلى مطاردة.`};
    return{ticker:s.ticker,label:'Open أسفل الدخول',cls:'warn',detail:'انتظار تعافٍ/عودة للمنطقة؛ لا دخول تلقائي.'};
  });
}

function renderMorning(){
  const box=document.getElementById('opsMorning');if(!box)return;const rows=morningRows();
  box.innerHTML=`<div class="ops-head"><div><h3>تأكيد الافتتاح</h3><p>Price confirmation من Open فقط. مصدر الـ15 دقيقة لا يعطي First-15m volume bar موثوقًا، لذلك لا نخترع Liquidity Confirmation.</p></div><span class="ops-pill neutral">PRICE_ONLY</span></div><div class="ops-list">${rows.length?rows.map(r=>`<div class="ops-row"><div><b>${esc(r.ticker)}</b><br><small>${esc(r.detail)}</small></div><span class="ops-pill ${r.cls}">${esc(r.label)}</span></div>`).join(''):'<div class="ops-note warn">لا توجد إشارات حالية.</div>'}</div>`;
}

function basketPlan(){
  const sig=latestSignals();if(!sig.length)return{rows:[],capital:0,total:0,cash:0,totalRisk:0};
  const capital=n(document.getElementById('capitalInput')?.value)||100000;const requested=n(document.getElementById('riskPctInput')?.value)||0.5;const maxWeight=n(document.getElementById('maxWeightInput')?.value)||10;const settings=load(KEYS.settings,{portfolioRiskLimit:2});const totalRiskLimit=n(settings.portfolioRiskLimit)||2;const eachRiskPct=Math.min(requested,totalRiskLimit/sig.length);
  const rows=sig.map(s=>{const entry=n(s.entryHigh),stop=n(s.stop);if(!(entry>stop&&stop>0))return{ticker:s.ticker,qty:0,value:0,risk:0};const riskCash=capital*eachRiskPct/100;const qtyRisk=Math.floor(riskCash/(entry-stop));const qtyWeight=Math.floor(capital*maxWeight/100/entry);const qty=Math.max(0,Math.min(qtyRisk,qtyWeight));return{ticker:s.ticker,qty,entry,value:qty*entry,risk:qty*(entry-stop),riskPct:capital?qty*(entry-stop)/capital*100:0,weightPct:capital?qty*entry/capital*100:0};});
  const total=rows.reduce((a,r)=>a+r.value,0),totalRisk=rows.reduce((a,r)=>a+r.risk,0);return{rows,capital,total,cash:Math.max(0,capital-total),totalRisk,eachRiskPct,totalRiskLimit};
}

function renderBasket(){
  const box=document.getElementById('opsBasket');if(!box)return;const p=basketPlan();
  box.innerHTML=`<div class="ops-head"><div><h3>سلة المرشحين</h3><p>Equal-risk local planner؛ لا يرسل أوامر ولا يغير Rank.</p></div><span class="ops-pill neutral">محلي فقط</span></div>${p.rows.length?`<div class="ops-metrics"><div class="ops-metric"><small>التعرض المقترح</small><b>${pct(p.capital?p.total/p.capital*100:0)}</b></div><div class="ops-metric"><small>Cash Reserve</small><b>${pct(p.capital?p.cash/p.capital*100:0)}</b></div><div class="ops-metric"><small>Open Risk</small><b>${pct(p.capital?p.totalRisk/p.capital*100:0)}</b></div><div class="ops-metric"><small>Risk / سهم</small><b>${pct(p.eachRiskPct)}</b></div></div><div class="ops-list">${p.rows.map(r=>`<div class="ops-row"><b>${esc(r.ticker)}</b><small>${fmt(r.qty,0)} سهم · وزن ${pct(r.weightPct)} · خطر ${pct(r.riskPct)}</small></div>`).join('')}</div>`:'<div class="ops-note warn">لا توجد إشارات مجمدة لبناء السلة.</div>'}`;
}

function alertMeta(r){
  const map={ENTRY_ZONE_TOUCHED:['منطقة الدخول','دخل/لامس منطقة الدخول','good'],POSITION_OPEN:['تفعيل دخول','تم تفعيل الدخول وفق الخطة المجمدة','good'],TARGET1_REACHED:['تحقق T1','تم رصد تحقق الهدف الأول','good'],TARGET2_REACHED:['تحقق T2','تم رصد تحقق الهدف الثاني','good'],STOP:['تحقق Stop','تم رصد الوقف','bad'],STOP_SAME_BAR:['Stop First','الهدف والوقف داخل نفس الجلسة؛ طُبق STOP_FIRST','bad'],ENTRY_EXPIRED:['انتهاء الدخول','انتهت مهلة الدخول 3 جلسات','warn'],STALE_INTRADAY:['مصدر قديم','بيانات المتابعة متأخرة داخل الجلسة','bad']};
  if(map[r.state])return map[r.state];if(r.freshness?.state==='STALE_INTRADAY'||r.freshness?.state==='STALE_SESSION')return['تحذير حداثة',r.freshness.labelAr||'بيانات قديمة','bad'];return null;
}
function addAlerts(detail){
  const notified=new Set(load(KEYS.notified,[]));let changed=false;
  for(const r of detail?.results||[]){const meta=alertMeta(r);if(!meta)continue;const id=`${r.signalDate}|${r.ticker}|${r.state}|${r.freshness?.state||''}`;if(notified.has(id))continue;notified.add(id);const a={id,createdAt:new Date().toISOString(),ticker:r.ticker,title:`${r.ticker} — ${meta[0]}`,message:meta[1],severity:meta[2],state:r.state,signalDate:r.signalDate};state.alerts.unshift(a);changed=true;notifyBrowser(a);}
  state.alerts=state.alerts.slice(0,100);if(changed){save(KEYS.alerts,state.alerts);save(KEYS.notified,[...notified].slice(-300));}renderAlerts();
}
function notifyBrowser(a){if(!('Notification'in window)||Notification.permission!=='granted')return;try{new Notification(a.title,{body:a.message,tag:a.id})}catch{}}
function renderAlerts(){
  const list=document.getElementById('opsAlertsList');const count=document.getElementById('opsAlertsCount');const read=new Set(load(KEYS.readAlerts,[]));const unread=state.alerts.filter(a=>!read.has(a.id)).length;if(count){count.textContent=String(unread);count.style.display=unread?'inline-grid':'none'}if(list)list.innerHTML=state.alerts.length?state.alerts.map(a=>`<article class="ops-alert ${a.severity}"><h4>${esc(a.title)}</h4><p>${esc(a.message)}<br><small>${esc(new Date(a.createdAt).toLocaleString('ar-EG'))}</small></p></article>`).join(''):'<div class="ops-note">لا توجد انتقالات حالة تستحق التنبيه حتى الآن.</div>';
}

function returnsByDate(bars){const out=new Map();for(let i=1;i<bars.length;i++){const p=n(bars[i-1]?.close),c=n(bars[i]?.close);if(p>0&&c>0)out.set(bars[i].date,(c/p)-1)}return out}
function pearson(a,b){const keys=[...a.keys()].filter(k=>b.has(k));if(keys.length<20)return null;const xs=keys.map(k=>a.get(k)),ys=keys.map(k=>b.get(k)),mx=xs.reduce((s,x)=>s+x,0)/xs.length,my=ys.reduce((s,x)=>s+x,0)/ys.length;let num=0,dx=0,dy=0;for(let i=0;i<xs.length;i++){const x=xs[i]-mx,y=ys[i]-my;num+=x*y;dx+=x*x;dy+=y*y}return dx>0&&dy>0?num/Math.sqrt(dx*dy):null}

async function correlationModel(force=false){
  const pf=load(KEYS.portfolio,[]);const tickers=[...new Set(pf.map(x=>x.ticker).filter(Boolean))];if(tickers.length<2)return{tickers,pairs:[]};if(!force&&state.corrCache&&Date.now()-state.corrCacheAt<300000)return state.corrCache;
  const loaded=await Promise.all(tickers.map(async t=>[t,returnsByDate(await history(t,80))]));const maps=new Map(loaded);const pairs=[];for(let i=0;i<tickers.length;i++)for(let j=i+1;j<tickers.length;j++){const c=pearson(maps.get(tickers[i]),maps.get(tickers[j]));if(c!==null)pairs.push({a:tickers[i],b:tickers[j],corr:c})}pairs.sort((x,y)=>Math.abs(y.corr)-Math.abs(x.corr));state.corrCache={tickers,pairs};state.corrCacheAt=Date.now();return state.corrCache;
}

async function renderPortfolioRisk(force=false){
  const corrBox=document.getElementById('opsCorrelationBody'),stress=document.getElementById('opsStressBody');if(!corrBox||!stress)return;const pf=load(KEYS.portfolio,[]);const totalValue=pf.reduce((s,x)=>s+(n(x.value)||0),0),stopRisk=pf.reduce((s,x)=>s+(n(x.risk)||0),0);stress.innerHTML=`<div class="ops-metrics"><div class="ops-metric"><small>Market -3%</small><b class="red">-${money(totalValue*.03)}</b></div><div class="ops-metric"><small>Market -5%</small><b class="red">-${money(totalValue*.05)}</b></div><div class="ops-metric"><small>كل Stops</small><b class="red">-${money(stopRisk)}</b></div><div class="ops-metric"><small>إجمالي التعرض</small><b>${money(totalValue)}</b></div></div><div class="ops-note">Stress حساب محلي خطي، وليس توقعًا للسوق ولا تنفيذًا.</div>`;
  if(pf.length<2){corrBox.innerHTML='<div class="ops-note warn">أضف مركزين تجريبيين على الأقل لحساب الارتباط.</div>';return}corrBox.innerHTML='<div class="ops-note">جارٍ حساب correlation من آخر الجلسات المشتركة…</div>';try{const m=await correlationModel(force);const high=m.pairs.filter(x=>x.corr>=.7);const avg=m.pairs.length?m.pairs.reduce((s,x)=>s+x.corr,0)/m.pairs.length:null;corrBox.innerHTML=`<div class="ops-metrics"><div class="ops-metric"><small>أعلى ارتباط</small><b>${m.pairs[0]?`${m.pairs[0].a}/${m.pairs[0].b} ${fmt(m.pairs[0].corr,2)}`:'—'}</b></div><div class="ops-metric"><small>متوسط الأزواج</small><b>${fmt(avg,2)}</b></div><div class="ops-metric"><small>أزواج ≥ 0.70</small><b>${high.length}</b></div><div class="ops-metric"><small>مراكز فريدة</small><b>${m.tickers.length}</b></div></div>${high.length?`<div class="ops-note warn">تركيز محتمل: ${high.slice(0,4).map(x=>`${x.a}/${x.b}=${fmt(x.corr,2)}`).join(' · ')}</div>`:'<div class="ops-note">لا يوجد زوج بارتباط ≥ 0.70 في العينة المتاحة.</div>'}`;}catch(e){corrBox.innerHTML=`<div class="ops-note bad">تعذر حساب الارتباط: ${esc(e.message)}</div>`}
}

function renderRegime(){
  const box=document.getElementById('opsRegimeBody');if(!box)return;const phase=marketPhase();box.innerHTML=`<div class="ops-grid"><div class="ops-card"><h3>BULL</h3><p>يُعرض فقط إذا أنتج Sidecar الدليل المستقل تصنيفًا صالحًا من Benchmark/Breadth تاريخي كافٍ.</p></div><div class="ops-card"><h3>SIDEWAYS</h3><p>تصنيف evidence-only؛ لا يخفض أو يرفع Risk% تلقائيًا.</p></div><div class="ops-card"><h3>BEAR</h3><p>حتى لو ثبت لاحقًا، يظل إشارة مراجعة بشرية ولا يغير Alpha.</p></div></div><div class="ops-note warn"><b>الحالة الحالية: PENDING VERIFIED BENCHMARK FEED.</b><br>إطار Regime موجود ومختبر Offline، لكن لا يوجد Feed مؤشر/اتساع سوق موثق وحديث بما يكفي لتسمية جلسة ${esc(phase.date)} Bull/Bear/Sideways دون تخمين. آخر ملف V16.2 معروف قديم ولا يتم إعادة استخدامه كحالة حالية.</div>`;
}

function bind(){
  document.getElementById('opsAlertsButton')?.addEventListener('click',()=>{document.getElementById('opsAlertDrawer')?.classList.add('open');document.getElementById('opsAlertDrawer')?.setAttribute('aria-hidden','false')});
  const close=()=>{document.getElementById('opsAlertDrawer')?.classList.remove('open');document.getElementById('opsAlertDrawer')?.setAttribute('aria-hidden','true')};document.getElementById('opsCloseAlerts')?.addEventListener('click',close);document.getElementById('opsAlertsBackdrop')?.addEventListener('click',close);
  document.getElementById('opsEnableNotifications')?.addEventListener('click',async()=>{if(!('Notification'in window))return alert('المتصفح لا يدعم الإشعارات المحلية.');const p=await Notification.requestPermission();if(p==='granted')alert('تم تفعيل إشعارات انتقالات حالة المرشحين.');});
  document.getElementById('opsMarkRead')?.addEventListener('click',()=>{save(KEYS.readAlerts,state.alerts.map(a=>a.id));renderAlerts()});
  document.getElementById('opsRefreshRisk')?.addEventListener('click',()=>renderPortfolioRisk(true));
  document.querySelector('.tab[data-view="portfolio"]')?.addEventListener('click',()=>setTimeout(()=>renderPortfolioRisk(false),30));
  document.querySelector('.tab[data-view="evidence"]')?.addEventListener('click',()=>setTimeout(renderRegime,30));
  ['capitalInput','riskPctInput','maxWeightInput'].forEach(id=>document.getElementById(id)?.addEventListener('input',renderBasket));
  window.addEventListener('storage',e=>{if([KEYS.archive,KEYS.portfolio,KEYS.settings].includes(e.key)){renderFreshness();renderMorning();renderBasket();renderPortfolioRisk(true)}});
  window.addEventListener('rc2:session-monitor',e=>{state.monitor=e.detail;renderFreshness();renderMorning();renderBasket();addAlerts(e.detail)});
}

function start(){ensureShell();bind();renderFreshness();renderMorning();renderBasket();renderAlerts();renderPortfolioRisk(false);renderRegime();if(window.__RC2_SESSION_MONITOR_LAST__){state.monitor=window.__RC2_SESSION_MONITOR_LAST__;addAlerts(state.monitor);renderMorning();}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
