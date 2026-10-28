/* V18 legacy evidence comparison. Read-only; does not change Astra or ELITE certification. */
(()=>{'use strict';
const url='https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/v18-global-strategy-ensemble-20260906/data/stable/v18-forward-ledger.json';
const quantUrl='https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/quant/daily-recommendations.json';
const e=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>Number.isFinite(+x)?Number(x).toLocaleString('ar-EG',{maximumFractionDigits:2}):'—';
function mount(){let host=document.getElementById('v18-evidence');if(host)return host;host=document.createElement('section');host.id='v18-evidence';host.className='panel';host.innerHTML='<h2>مقارنة الأدلة من V18 مع Quant</h2><p>جارٍ فحص الأرشيف…</p>';document.querySelector('#table')?.after(host);return host}
async function fetchJson(u){const r=await fetch(u+'?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return r.json()}
async function load(){const host=mount();try{
const [legacy,quant]=await Promise.all([fetchJson(url),fetchJson(quantUrl)]);
if(!Array.isArray(legacy.entries))throw Error('V18 entries missing');
const latest=new Map();for(const x of legacy.entries){const p=x?.issued;if(!p?.ticker||!/^\d{4}-\d{2}-\d{2}$/.test(p.sessionId||''))continue;const prior=latest.get(p.ticker);if(!prior||p.sessionId>prior.sessionId)latest.set(p.ticker,{...p,evaluation:x.evaluation,futurePerformance:x.futurePerformance})}
const candidates=[...(quant.paperCandidates||[]),...(quant.watchCandidates||[])],joined=candidates.map(x=>({q:x,v:latest.get(x.ticker)})).filter(x=>x.v);
const mostRecent=[...latest.values()].reduce((m,x)=>x.sessionId>m?x.sessionId:m,'');
const old=mostRecent!==quant.sessionId;
host.innerHTML='<h2>V18 — مقارنة تاريخية مع فرص Quant الحالية</h2><p>إشارات V18 المسجلة: '+legacy.entries.length+' | أسهم مختلفة في السجل: '+latest.size+' | أحدث إشارة: '+e(mostRecent)+' | جلسة Quant: '+e(quant.sessionId)+' | تقاطع الأسهم: '+joined.length+'</p>'+
(old?'<p style="color:#ffd38c">بيانات V18 أقدم من Quant؛ لا تُستخدم لتأكيد دخول الجلسة القادمة أو إصدار إشارة شراء.</p>':'<p>توافق التاريخ لا يثبت مطابقة البيانات أو صلاحية التنفيذ.</p>')+
'<div style="overflow-x:auto"><table><thead><tr><th>السهم</th><th>Quant الحالي</th><th>V18 التاريخي</th><th>عائلات استراتيجية V18</th><th>حالة التقييم V18</th><th>ملاحظة</th></tr></thead><tbody>'+
joined.map(({q,v})=>'<tr><td>'+e(q.ticker)+'</td><td>'+e(q.signalDate)+'</td><td>'+e(v.sessionId)+'</td><td>'+e((v.strategyFamilies||[]).join('، '))+'</td><td>'+e(v.evaluation?.status)+'</td><td>'+e(v.futurePerformance?.status)+' — دليل تاريخي فقط</td></tr>').join('')+'</tbody></table></div>'+
'<p>قاعدة الاستفادة: دمج خصائص الاستراتيجية أو البيانات فقط بعد توثيق مصدرها، ثم اختبارها من جديد خارج العينة. سجل V18 لا يثبت بذاته أداء تنفيذ حي أو احتمال نجاح معاير.</p>';
}catch(err){host.innerHTML='<h2>مقارنة V18</h2><p>تعذر استرجاع السجل الأصلي: '+e(err.message)+'</p>'}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
})();