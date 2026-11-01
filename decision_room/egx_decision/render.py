"""Static Arabic RTL page. All dynamic text via textContent (no innerHTML). Fail-closed on stale/invalid payload."""
import json
from . import config as K
TEMPLATE=r'''<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EGX PRO — غرفة القرار</title><style>
:root{color-scheme:dark;font-family:Tahoma,Arial,sans-serif;--bg:#081220;--panel:#14243a;--bd:#314866;--fg:#ecf4ff;--mut:#a8bbd4;--acc:#85baff;--warn:#ffd299;--bad:#ff9e9e;--ok:#80e4b4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);line-height:1.7}header{padding:18px 16px;border-bottom:1px solid var(--bd);background:#101e33}h1{margin:0;font-size:22px}h2{font-size:17px;margin:0 0 8px}h3{font-size:15px;margin:10px 0 6px}main{max-width:1300px;margin:auto;padding:14px 16px}
.banner{padding:12px;border-radius:10px;margin:10px 0;border:1px solid}.warn{background:#31291b;border-color:#8a713b;color:#ffe3a9}.stale{background:#3a1a1a;border-color:#b85454;color:#ffc9c9}.okb{background:#12301f;border-color:#2f7a52;color:#bff0d6}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:14px}.big{font-size:22px;font-weight:700;margin:4px 0}.mut,small{color:var(--mut)}
.cols{display:grid;grid-template-columns:320px 1fr;gap:12px;margin-top:12px}.list{max-height:520px;overflow:auto}
.btn{display:block;width:100%;text-align:right;cursor:pointer;border:1px solid #385170;border-radius:9px;padding:10px;background:#1c324e;color:#fff;margin-top:7px;font:inherit}.btn.active{background:#295480;border-color:var(--acc)}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.m{background:#0c1a2c;padding:10px;border-radius:9px}.m small{display:block}.lab{font-size:18px;font-weight:700}
canvas{width:100%;height:240px;background:#0c1a2c;border-radius:9px}table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid var(--bd);padding:6px;text-align:right;vertical-align:top}
select,input{padding:8px;background:#1c324e;color:#fff;border:1px solid #58718f;border-radius:8px;font:inherit}.ltr{direction:ltr;unicode-bidi:isolate;display:inline-block}ul{margin:4px 0;padding-inline-start:20px}footer{padding:16px;font-size:12px;color:var(--mut)}
@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}.cols{grid-template-columns:1fr}}@media(max-width:520px){.cards,.grid3{grid-template-columns:1fr}}
</style></head><body><header><h1>EGX PRO — غرفة القرار</h1><small class="mut">بحثية فقط · لا أوامر تداول · لا استراتيجية معتمدة</small></header><main id="app">
<div id="fresh"></div>
<div class="banner warn"><b>لا توجد استراتيجية معتمدة (NO_STRATEGY_APPROVED).</b> ما يظهر هنا قراءة بحثية بعد الإغلاق، وليس توصية شراء أو بيع. مستويات الدخول والوقف والأهداف غير معتمدة ومحجوبة.</div>
<section class="cards"><div class="card"><small>حالة السوق (H1 تجريبي)</small><div class="big" id="mk">—</div><small id="mkwhy"></small></div>
<div class="card"><small>مستوى التعرض</small><div class="big" id="expo">—</div><small id="expowhy"></small></div>
<div class="card"><small>آخر جلسة موثقة</small><div class="big ltr" id="sess">—</div><small id="upd"></small></div>
<div class="card"><small>أسهم مرّت من بوابات الجودة</small><div class="big" id="cov">—</div><small id="cov2"></small></div></section>
<div id="body"></div>
<footer id="foot"></footer></main>
<script id="payload" type="application/json">__PAYLOAD__</script><script>
const $=s=>document.querySelector(s);const T=(el,t)=>{el.textContent=t;return el};
const E=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e};
let D=null;try{D=JSON.parse(document.getElementById('payload').textContent);if(!D||!D.source_session||!Array.isArray(D.ranked))throw 0}catch(e){D=null}
const STALE=__STALE__;
function main(){
 if(!D){const b=E('div','banner stale','تعذر تحميل بيانات القرار أو أنها غير صالحة. لا تُعرض أي فرص (إغلاق آمن).');$('#fresh').append(b);return}
 const now=new Date(),sess=new Date(D.source_session+'T00:00:00Z'),age=Math.floor((now-sess)/864e5);
 const stale=age>STALE;
 $('#fresh').append(E('div','banner '+(stale?'stale':'okb'),stale?`بيانات قديمة: آخر جلسة ${D.source_session} (قبل ${age} يوم). لا تُعرض فرص ولا قراءة سوق حتى التحديث.`:`البيانات حديثة: آخر جلسة ${D.source_session}، وقت البناء ${D.generated_utc.slice(0,16).replace('T',' ')} UTC.`));
 const m=D.market||{};
 T($('#sess'),D.source_session);$('#upd').className='ltr';T($('#upd'),'built '+D.generated_utc.slice(0,16).replace('T',' ')+' UTC');
 T($('#cov'),`${D.counts.passed} / ${D.counts.with_bars}`);T($('#cov2'),`من ${D.counts.registry_symbols} رمزًا مسجلًا (${D.counts.without_any_bar} بلا أي شمعة) — محجوب: ${D.counts.blocked}`);
 if(stale||m.state==='UNKNOWN'){T($('#mk'),stale?'غير متاح (بيانات قديمة)':'غير معروف');T($('#mkwhy'),m.reason||'لا قراءة سوقية');T($('#expo'),'لا توصية');T($('#expowhy'),m.guidance||'')}
 else{T($('#mk'),m.state==='CASH'?'ضعيف — خارج السوق (قراءة H1)':'داعم — داخل السوق (قراءة H1)');
  T($('#mkwhy'),`المؤشر ${m.index_level} مقابل SMA100 ${m.sma100} · كون ${m.eligible_universe} سهمًا · فلتر قيد الاختبار الأمامي، غير معتمد`);
  T($('#expo'),'لا توصية تعرّض');T($('#expowhy'),'لا توجد استراتيجية مثبتة ولا بيانات مراكزك؛ H1 لم يتفوق في الفترة الأخيرة (عائد +51.2% مقابل +105.3% للسوق).')}
 const body=$('#body');
 if(stale){body.append(E('div','card','لا قائمة فرص: البيانات قديمة. تفاصيل الحجب متاحة في «صحة البيانات» أدناه.'))}
 else{
  const cols=E('section','cols');const side=E('aside','card');const main=E('div');cols.append(side,main);body.append(cols);
  side.append(E('h2',null,'الفرص (اتجاه صاعد + اجتاز البوابات)'));
  const lr=E('div','list');side.append(lr);
  const wl=E('h3',null,'قائمة المراقبة (اجتازت البوابات، بلا اتجاه صاعد — غير مرتبة)');
  const all=[...D.ranked,...D.watchlist];
  const det=E('div','card');main.append(det);
  function show(t){const r=all.find(x=>x.ticker===t);if(!r)return;det.replaceChildren();
   det.append(E('h2',null,`${r.ticker} — ${r.name||''} · إغلاق ${r.last} جنيه`));
   det.append(E('small','mut',`${r.source} · ${r.date}`));
   const ul=E('ul');r.reasons.forEach(x=>ul.append(E('li',null,x)));det.append(E('h3',null,'لماذا؟'),ul);
   const g=E('div','grid3');[['درجة الفرز (وصفية، ليست احتمال نجاح)',r.score+'/100'],['MA20',r.ma20],['MA50',r.ma50],['زخم 20 جلسة',r.momentum20+'%'],['حجم نسبي',r.relativeVolume+'×'],['أقصى أمر (1% من ADV20)',Math.round(r.max_order_egp).toLocaleString('en')+' جنيه']].forEach(([a,b])=>{const d=E('div','m');d.append(E('small',null,a),E('div','lab',String(b)));g.append(d)});det.append(g);
   const lv=E('div','banner warn');lv.append(E('b',null,'الدخول / الوقف / الأهداف: '),document.createTextNode(r.levels.note));det.append(lv);
   const c=E('canvas');c.width=900;c.height=240;det.append(E('h3',null,'تاريخ الإغلاق (آخر 75 جلسة)'),c);draw(c,r.history);
   if(r.warnings.length)det.append(E('small','mut','تنبيهات: '+r.warnings.join('؛ ')));
   document.querySelectorAll('.sym').forEach(b=>b.classList.toggle('active',b.dataset.t===t))}
  function add(list,rankTxt){list.forEach((r,i)=>{const b=E('button','btn sym',(rankTxt?`${r.rank}. `:'')+`${r.ticker} — ${r.score}/100`);b.dataset.t=r.ticker;b.onclick=()=>show(r.ticker);lr.append(b)})}
  if(D.ranked.length){add(D.ranked,true)}else{lr.append(E('div','banner warn','لا فرص اليوم: لا يوجد سهم اجتاز الجودة والسيولة ويظهر اتجاهًا صاعدًا.'))}
  lr.append(wl);add(D.watchlist,false);
  if(all.length)show(all[0].ticker);else det.append(E('div',null,'لا أسهم اجتازت بوابات الجودة اليوم. راجع أسباب الحجب في «صحة البيانات».'))}
 // data health
 const h=E('section','card');h.style.marginTop='12px';h.append(E('h2',null,'صحة البيانات — لماذا حُجب الآخرون؟'));
 const wf=D.counts.first_blocking_reason||{};const t=E('table');const trh=E('tr');['السبب (أول بوابة)','عدد الرموز'].forEach(x=>trh.append(E('th',null,x)));t.append(trh);
 const names={STALE:'آخر شمعة قديمة',CALENDAR_GAP:'فجوات في الجلسات',HISTORY:'تاريخ قصير',NO_TRADING:'لا تداول',FLAT_PRICE:'سعر ثابت',LIQUIDITY:'سيولة أقل من مليون جنيه',OHLC:'شمعة غير متسقة',CONFLICT:'تعارض أسعار',CORPORATE_ACTION:'حدث شركات',JUMP:'حركة >11% غير محسومة'};
 Object.keys(wf).forEach(k=>{if(wf[k]){const r=E('tr');r.append(E('td',null,names[k]||k),E('td',null,String(wf[k])));t.append(r)}});h.append(t);
 const f=E('input');f.placeholder='ابحث برمز محجوب…';f.style.margin='8px 0';h.append(f);
 const bt=E('table');h.append(bt);
 function rb(q){bt.replaceChildren();const th=E('tr');['الرمز','آخر شمعة','أسباب الحجب'].forEach(x=>th.append(E('th',null,x)));bt.append(th);
  D.blocked.filter(b=>!q||b.ticker.includes(q.toUpperCase())).slice(0,200).forEach(b=>{const r=E('tr');r.append(E('td',null,b.ticker),E('td','ltr',b.last_date||'—'),E('td',null,b.reasons.join(' | ')));bt.append(r)})}
 f.oninput=()=>rb(f.value);rb('');body.append(h);
 T($('#foot'),`المخطط ${D.schema} · SHA ${D.content_sha256.slice(0,12)} · مصدر الأسعار: قاعدة SQLite المركزية (RAW، للقراءة فقط). لا تحديث مباشر ولا أوامر مالية من هذه الصفحة.`)}
function draw(c,hist){const x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);if(!hist.length)return;const a=hist.map(p=>p.close),lo=Math.min(...a),hi=Math.max(...a),pad=34;
 x.direction='ltr';x.textAlign='left';x.fillStyle='#a8bbd4';x.font='12px sans-serif';x.fillText(hi.toFixed(3),2,14);x.fillText(lo.toFixed(3),2,c.height-14);x.fillText(hist[0].date,c.width-80,c.height-2);x.fillText(hist[hist.length-1].date,pad+2,c.height-2);
 x.strokeStyle='#75baff';x.lineWidth=2;x.beginPath();a.forEach((v,i)=>{const X=pad+(hist.length-1-i)/(Math.max(1,a.length-1))*(c.width-pad-10),Y=18+(hi-v)/((hi-lo)||1)*(c.height-44);i?x.lineTo(X,Y):x.moveTo(X,Y)});x.stroke()}
main();
</script></body></html>'''
def page(snapshot):
    j=json.dumps(snapshot,ensure_ascii=False,separators=(",",":"),allow_nan=False).replace("</","<\\/")
    return TEMPLATE.replace("__PAYLOAD__",j).replace("__STALE__",str(K.STALE_SESSION_DAYS))
