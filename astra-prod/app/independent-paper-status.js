/* Read-only independent paper engine status; never promotes observation to a recommendation. */
(()=>{'use strict';
const BASE='https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/unified-console/independent-paper.json';
const escape=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function render(){let host=document.getElementById('independent-paper-state');if(!host){host=document.createElement('section');host.id='independent-paper-state';host.className='panel';host.innerHTML='<h2>المحرك المستقل — حالة الجلسة</h2>';document.querySelector('#summary')?.before(host)}if(!host)return;
try{const res=await fetch(BASE+'?t='+Date.now(),{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);const d=await res.json();
const entries=Array.isArray(d.datedPriceObservations)?d.datedPriceObservations:[],rec=Array.isArray(d.recommendations)?d.recommendations:[],blocked=d.executable!==true||d.status!=='CERTIFIED_PAPER_READY';
host.innerHTML='<h2>EGX Independent Paper — '+escape(d.session)+'</h2><p>الحالة: <strong>'+escape(d.status)+'</strong> | مشاهدات سعرية مؤرخة: '+entries.length+' | توصيات: '+rec.length+'</p>'+
'<p style="color:#ffd38c">'+(blocked?'غير مؤهل لتوصيات تداول؛ الأسعار المعروضة مشاهدات وليست إشارات شراء.':'حالة الاعتماد الواردة من المصدر تحتاج مراجعة مستقلة قبل التنفيذ.')+'</p>'+
'<p>موانع الاعتماد: '+escape((d.blockers||[]).join('، ')||'غير محددة')+'</p>'+
'<div style="overflow-x:auto"><table><thead><tr><th>السهم</th><th>سعر المصدر</th><th>جلسة المصدر</th><th>الشموع النظيفة / المطلوبة</th><th>سبب الاستبعاد</th></tr></thead><tbody>'+
entries.map(x=>'<tr><td>'+escape(x.ticker)+'</td><td>'+escape(x.close)+'</td><td>'+escape(x.session)+'</td><td>'+escape(x.cleanLookbackBars)+' / '+escape(x.lookbackBars)+'</td><td>'+escape((x.indicatorBlockers||[]).join('، '))+'</td></tr>').join('')+'</tbody></table></div>';
}catch(e){host.innerHTML='<h2>المحرك المستقل</h2><p>تعذر قراءة الحالة: '+escape(e.message)+'</p>'}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render,{once:true});else render();
})();
