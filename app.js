(() => {
'use strict';
const BUILD='V15.3-SR-TRUTH';
let deferredInstall=null;
const state={decision:null,ranking:null,market:null,health:null,query:'',filter:'ALL'};
const $=id=>document.getElementById(id);
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const fmt=(v,d=2)=>num(v)===null?'--':Number(v).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:0});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validSR=r=>num(r?.support1)>0&&num(r?.resistance1)>0&&num(r.support1)<num(r.resistance1);
const clean=s=>String(s||'').replace(/\s+/g,' ').split(/End 1\s*-->/i).pop().replace(/-->/g,'').replace(/^[\d,\[\]\s:'"#]+/,'').trim();
const price=r=>num(r?.price)??num(r?.lastPrice)??num(r?.currentPrice);
const stateLabel=s=>s==='EXECUTABLE'?'تنفيذ مشروط':s==='CONDITIONAL_WATCH'?'مراقبة مشروطة':'مستبعد';
const stateClass=s=>s==='EXECUTABLE'?'exec':s==='CONDITIONAL_WATCH'?'watch':'block';

async function jsonFile(path,fallback){
  try{
    const r=await fetch(`${path}?v=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){return {...fallback,loadError:e.message};}
}
async function refreshWorker(){
  try{
    if('serviceWorker' in navigator){
      const reg=await navigator.serviceWorker.register(`service-worker.js?v=15301`,{scope:'./',updateViaCache:'none'});
      await reg.update();
      if(reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'});
    }
  }catch(e){console.warn(e);}
}
function rows(){
  const d=state.decision;
  if(Array.isArray(d?.rankedOpportunities)&&d.rankedOpportunities.length)return d.rankedOpportunities;
  if(Array.isArray(state.ranking?.rows))return state.ranking.rows.map((r,i)=>({
    ...r,rank:i+1,
    opportunityState:r.executionAllowed?'EXECUTABLE':r.grade==='Blocked'?'BLOCKED':'CONDITIONAL_WATCH',
    label:r.executionAllowed?'تنفيذ مشروط':r.grade==='Blocked'?'مستبعد':'مراقبة مشروطة',
    confidence:num(r.targetProbability)??num(r.finalScore)??num(r.confidence)??0,
    entryFrom:num(r.entryFrom),entryTo:num(r.entryTo),target1:num(r.target1),stopLoss:num(r.stopLoss),
    provisionalPlan:!r.executionAllowed
  }));
  return [];
}
function visibleRows(){
  const q=state.query.trim().toUpperCase();
  return rows().filter(r=>{
    const hit=!q||String(r.symbol||'').toUpperCase().includes(q)||clean(r.name||r.name_ar||r.name_en).toUpperCase().includes(q);
    const layer=state.filter==='ALL'||r.opportunityState===state.filter;
    return hit&&layer;
  });
}
function card(r){
  const st=r.opportunityState||'CONDITIONAL_WATCH';
  const cls=stateClass(st);
  const planType=r.provisionalPlan?'خطة تجريبية':'مستويات موثقة';
  return `<article class="card ${cls}">
    <div class="card-top">
      <div><span class="symbol">${esc(r.symbol)}</span> — <span class="name">${esc(clean(r.name||r.name_ar||r.name_en)||r.symbol)}</span></div>
      <span class="status ${cls}">${stateLabel(st)}</span>
    </div>
    <div class="tags">
      <span class="tag ${r.provisionalPlan?'warn':'good'}">${planType}</span>
      <span class="tag">${fmt(r.confidence??r.targetProbability??r.finalScore,0)}% ثقة تحليلية</span>
      <span class="tag ${r.srVerified?'good':'warn'}">${r.srVerified?'دعم/مقاومة موثقان':'الدعم/المقاومة غير موثقين'}</span>
      <span class="tag ${st==='EXECUTABLE'?'good':st==='BLOCKED'?'bad':'warn'}">${st==='EXECUTABLE'?'بوابة التنفيذ ناجحة':'ليست أمر شراء'}</span>
    </div>
    <div class="metrics">
      <div class="metric"><span>السعر</span><b>${fmt(r.price,3)}</b></div>
      <div class="metric"><span>الدخول من</span><b>${fmt(r.entryFrom,3)}</b></div>
      <div class="metric"><span>الدخول إلى</span><b>${fmt(r.entryTo,3)}</b></div>
      <div class="metric"><span>هدف 1</span><b>${fmt(r.target1,3)}</b></div>
      <div class="metric"><span>الوقف</span><b>${fmt(r.stopLoss,3)}</b></div>
      <div class="metric"><span>R/R</span><b>${fmt(r.rr??r.riskReward,2)}</b></div>
      <div class="metric"><span>الترتيب</span><b>#${fmt(r.rank,0)}</b></div>
    </div>
    <p class="why">${esc(r.why||r.reason||r.executionBlockReason||'فرصة متابعة مرتبة تحتاج تحققًا قبل أي تنفيذ.')}</p>
  </article>`;
}
function render(){
  const list=visibleRows();
  const all=rows();
  const summary=state.decision?.summary||{};
  const exec=all.filter(r=>r.opportunityState==='EXECUTABLE').length;
  const watch=all.filter(r=>r.opportunityState==='CONDITIONAL_WATCH').length;
  const blocked=all.filter(r=>r.opportunityState==='BLOCKED').length;
  const marketRows=Array.isArray(state.market?.rows)?state.market.rows:[];
  const srCount=marketRows.filter(validSR).length;
  const srPct=marketRows.length?srCount/marketRows.length*100:0;
  const updated=state.market?.updatedAt||state.market?.generatedAt||state.decision?.generatedAt;
  const rankedCount=all.length;

  $('rankedCount').textContent=rankedCount;
  $('executionCount').textContent=exec;
  $('watchCount').textContent=watch;
  $('blockedCount').textContent=blocked;
  $('rankedStrip').textContent=rankedCount;
  $('executionStrip').textContent=exec;
  $('srStrip').textContent=`${srCount}/${marketRows.length} — ${srPct.toFixed(1)}%`;
  $('marketTime').textContent=updated?new Date(updated).toLocaleString('ar-EG'):'--';

  const msg=$('message');
  if(exec>0){
    msg.className='message good';
    msg.innerHTML=`يوجد <b>${exec}</b> فرصة اجتازت بوابة التنفيذ، مع بقاء القرار مشروطًا بالسعر والسيولة ووقف الخسارة.`;
    $('sideDot').style.background='#16c37b';$('sideTitle').textContent='فرص تنفيذية مشروطة';
  }else if(rankedCount>0){
    msg.className='message warn';
    msg.innerHTML=`يوجد <b>${rankedCount}</b> فرصة مرتبة للمتابعة، لكن <b>0 توصية تنفيذية آمنة</b>. هذه ليست شاشة فارغة: نعرض الترتيب والخطة التجريبية مع قفل التنفيذ.`;
    $('sideDot').style.background='#efad20';$('sideTitle').textContent='فرص متابعة — التنفيذ مقفول';
  }else{
    msg.className='message bad';
    msg.textContent='لم يتم توليد أي ترتيب تحليلي. شغّل Update EGX Market Data.';
    $('sideDot').style.background='#ef526a';$('sideTitle').textContent='لا يوجد ترتيب';
  }

  $('decisionSubtitle').textContent=exec
    ?`يوجد ${exec} تنفيذ مشروط و${watch} فرصة متابعة.`
    :`أفضل ${Math.min(30,rankedCount)} فرصة للمتابعة؛ عدد التنفيذ الآمن يظل صفرًا حتى اكتمال البوابات.`;
  $('topCards').innerHTML=list.slice(0,30).map(card).join('')||'<div class="empty">لا توجد نتائج مطابقة.</div>';

  $('rankingRows').innerHTML=list.map((r,i)=>{
    const st=r.opportunityState||'CONDITIONAL_WATCH',cls=stateClass(st);
    return `<tr><td>${i+1}</td><td dir="ltr"><b>${esc(r.symbol)}</b></td><td>${esc(clean(r.name||r.name_ar||r.name_en)||r.symbol)}</td>
      <td>${fmt(r.price,3)}</td><td>${fmt(r.entryFrom,3)} – ${fmt(r.entryTo,3)}</td><td>${fmt(r.target1,3)}</td><td>${fmt(r.stopLoss,3)}</td>
      <td>${fmt(r.confidence??r.targetProbability??r.finalScore,0)}%</td><td>${fmt(r.rr??r.riskReward,2)}</td><td class="state-${cls}">${stateLabel(st)}</td></tr>`;
  }).join('')||'<tr><td colspan="10" class="empty">لا يوجد ترتيب.</td></tr>';

  const support=marketRows.filter(validSR);
  $('supportRows').innerHTML=support.map(r=>`<tr><td dir="ltr"><b>${esc(r.symbol)}</b></td><td>${fmt(price(r),3)}</td>
    <td>${fmt(r.pivot??r.pivotPoint,3)}</td><td>${fmt(r.support1,3)}</td><td>${fmt(r.support2,3)}</td>
    <td>${fmt(r.resistance1,3)}</td><td>${fmt(r.resistance2,3)}</td><td>${esc(r.supportResistanceSource||r.sources?.mubasherRendered?.source||'market.json')}</td></tr>`
  ).join('')||'<tr><td colspan="8" class="empty">لا توجد مستويات موثقة في ملف السوق الحالي.</td></tr>';

  const notes=[
    rankedCount>0?`الترتيب التحليلي متاح لعدد ${rankedCount} سهم/فرصة.`:'ملف الترتيب التحليلي فارغ.',
    exec===0?'صفر تنفيذ لا يعني صفر فرص؛ يعني أن بوابة التنفيذ لم تكتمل.':`هناك ${exec} فرصة اجتازت بوابة التنفيذ.`,
    `تغطية الدعم والمقاومة الموثقة في market.json هي ${srPct.toFixed(1)}%.`,
    'مناطق الدخول والأهداف الظاهرة كـ«خطة تجريبية» مأخوذة من محرك الترتيب وليست بديلًا عن مستويات مباشر الموثقة.',
    'الأيقونة واللينك يجب أن يعرضا Build V15.3 بعد فتح صفحة reset مرة واحدة.'
  ];
  $('healthNotes').innerHTML=notes.map(n=>`<li>${esc(n)}</li>`).join('');
  $('healthGrid').innerHTML=[
    ['Build',BUILD,'نسخة موحدة'],
    ['Market rows',marketRows.length,'أسهم السوق'],
    ['Ranked opportunities',rankedCount,'فرص المتابعة'],
    ['Executable',exec,'تنفيذ مشروط'],
    ['Conditional watch',watch,'مراقبة'],
    ['Blocked',blocked,'محجوب'],
    ['Verified S/R',`${srPct.toFixed(1)}%`,`${srCount}/${marketRows.length}`],
    ['Decision engine',state.decision?.engine||'--','مصدر القرار']
  ].map(x=>`<article class="health-card"><span>${esc(x[0])}</span><b>${esc(x[1])}</b><small>${esc(x[2])}</small></article>`).join('');
}
async function load(){
  $('loading').classList.remove('done');
  const [decision,ranking,market,health]=await Promise.all([
    jsonFile('data/today-decision-center.json',{ok:false,rankedOpportunities:[]}),
    jsonFile('data/final-opportunity-ranking.json',{ok:false,rows:[]}),
    jsonFile('data/market.json',{ok:false,rows:[]}),
    jsonFile('data/source-health.json',{ok:false})
  ]);
  Object.assign(state,{decision,ranking,market,health});
  render();
  $('loading').classList.add('done');
}
document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x===b));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.view));
}));
$('search').addEventListener('input',e=>{state.query=e.target.value;render();});
$('decisionFilter').addEventListener('change',e=>{state.filter=e.target.value;render();});
$('reload').addEventListener('click',load);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('install').classList.remove('hidden');});
$('install').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('install').classList.add('hidden');});
navigator.serviceWorker?.addEventListener('controllerchange',()=>{if(sessionStorage.getItem('v152reload'))return;sessionStorage.setItem('v152reload','1');location.reload();});
(async()=>{await refreshWorker();await load();setInterval(load,120000);})();
})();