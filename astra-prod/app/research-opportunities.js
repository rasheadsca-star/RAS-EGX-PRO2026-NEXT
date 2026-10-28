/* EGX PRO research opportunities: independent read-only lens, never changes Astra certified decisions. */
(()=>{'use strict';
const node=document.createElement('section');node.id='egx-conditional-opportunities';node.className='panel';node.style.cssText='padding:16px;margin:16px 0;border:1px solid #34546d;border-radius:12px';
const safe=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>Number.isFinite(+x)?Number(x).toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
function nextMarketDate(s){const d=new Date(s+'T12:00:00Z');if(!Number.isFinite(d.getTime()))return '';for(let i=0;i<7;i++){d.setUTCDate(d.getUTCDate()+1);if(![5,6].includes(d.getUTCDay()))return d.toISOString().slice(0,10)}return ''}
function attach(){const target=document.getElementById('view-recommendations');if(target&&!target.contains(node))target.prepend(node)}
function showError(e){node.innerHTML='<h2>الفرص الفنية للجلسة القادمة</h2><p>بيانات البحث غير متاحة: '+safe(e.message)+'</p>';attach()}
async function refresh(){attach();try{
const res=await fetch('../../data/quant/daily-recommendations.json?cb='+Date.now(),{cache:'no-store'});if(!res.ok)throw new Error('HTTP '+res.status);
const d=await res.json();if(!/^\d{4}-\d{2}-\d{2}$/.test(d.sessionId||''))throw new Error('تاريخ غير صالح');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const next=nextMarketDate(d.sessionId), fresh=today===d.sessionId||today===next;
const xs=Array.isArray(d.watchCandidates)?d.watchCandidates:[],ready=xs.filter(x=>(x.failedConditions||[]).length===0);
node.innerHTML='<h2>فرص الجلسة القادمة — بحثية، مستقلة عن قرار Astra</h2>'+
'<p>تاريخ الأسعار: '+safe(d.sessionId)+' | الجلسة التالية المتوقعة: '+safe(next)+' | الحالة: <b>'+(fresh?'مراقبة مشروطة':'منتهية الصلاحية — أرشيف فقط')+'</b></p>'+
'<p>فرص فنية مكتملة: <b>'+ready.length+'</b> | فرص متابعة: <b>'+xs.length+'</b> | توصيات معتمدة: <b>'+(Array.isArray(d.paperCandidates)?d.paperCandidates.length:0)+'</b> | نظام السوق: '+safe(d.marketRegime?.labelAr)+'</p>'+
'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">'+xs.map(x=>{const p=x.plan||{},complete=(x.failedConditions||[]).length===0;return '<div style="background:#102b45;border:1px solid #34546d;border-radius:10px;padding:12px"><b>'+safe(x.ticker)+' — '+safe(x.companyNameAr||x.companyNameEn)+'</b><p>'+(complete?'مكتملة فنيًا':'شروط غير مكتملة')+' · '+safe(x.strategyValidationStatus)+'</p><p>الدخول: '+money(p.entryLow)+'–'+money(p.entryHigh)+'</p><p>الهدف 1: '+money(p.target1)+' | الهدف 2: '+money(p.target2)+'</p><p>الوقف: '+money(p.stopLoss)+' | التقييم: '+money(x.recommendationScore)+'</p>'+(x.failedConditions?.length?'<small>نواقص: '+safe(x.failedConditions.join('، '))+'</small>':'')+'</div>'}).join('')+'</div>'+
'<p style="margin-top:12px;color:#ffc857">لا تنفيذ آلي ولا شراء مؤكد. حالة RESEARCH_ONLY تعني فشل اعتماد الأداء المستقل. الفرص القديمة للعرض التاريخي فقط؛ عدم تحديث البيانات لا يمدد صلاحيتها.</p><p><a href="../../tomorrow.html">لوحة الفرص التفصيلية</a></p>';
attach();
}catch(e){showError(e)}}
const observer=new MutationObserver(()=>attach());
function init(){attach();observer.observe(document.body,{childList:true,subtree:true});refresh()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
