(()=>{'use strict';
const $=id=>document.getElementById(id),base='../data/',fmt=(n,d=2)=>Number.isFinite(Number(n))?Number(n).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const state={snapshot:null,rows:[],selected:null,cache:new Map()};
const status=(s)=>{$('status').textContent=s};
const isDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'');
async function get(url){const r=await fetch(url+(url.includes('?')?'&':'?')+'t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status+' '+url);return r.json()}
function safeText(x){return String(x??'—')}
function tag(text,warn=false){const e=document.createElement('span');e.className='tag'+(warn?' warn':' good');e.textContent=text;return e}
function createCard(r){const b=document.createElement('button');b.type='button';b.className='stock';b.setAttribute('aria-selected',r.ticker===state.selected?'true':'false');b.addEventListener('click',()=>select(r.ticker));
 const a=document.createElement('div');a.className='head';const t=document.createElement('strong');t.textContent=r.ticker+' · '+(r.rank||'—');const s=document.createElement('span');s.textContent=fmt(r.relativeResearchScore,1)+'/100';a.append(t,s);b.append(a);
 const n=document.createElement('p');n.className='sub tiny';n.textContent=r.note||'مراقبة بحثية';b.append(n);
 const f=document.createElement('div');f.className='stat';const p=document.createElement('span');p.textContent=fmt(r.close)+' ج';const ch=document.createElement('span');ch.textContent=(r.changePct>=0?'+':'')+fmt(r.changePct)+'%';f.append(p,ch);b.append(f);
 const bar=document.createElement('div');bar.className='bar';const fill=document.createElement('span');fill.style.width=Math.max(0,Math.min(100,r.relativeResearchScore||0))+'%';bar.append(fill);b.append(bar);
 const e=document.createElement('div');e.style.marginTop='8px';e.append(tag(r.scenarios?.some(x=>x.status==='PAPER_CONDITIONAL')?'سيناريو ورقي مشروط':'انتظار تأكيد',true));b.append(e);return b;}
function drawList(){let rows=[...state.rows],q=$('q').value.trim().toUpperCase(),sort=$('sort').value;rows=rows.filter(x=>x.ticker.includes(q));rows.sort((a,b)=>sort==='volume'?b.volumeRatio20-a.volumeRatio20:sort==='change'?b.changePct-a.changePct:b.relativeResearchScore-a.relativeResearchScore);$('list').replaceChildren(...rows.map(createCard))}
function svgChart(el,points,ref){el.replaceChildren();const W=780,H=320,pad={l:52,r:12,t:18,b:38};const plotW=W-pad.l-pad.r,plotH=H-pad.t-pad.b;
 const valid=points.filter(x=>isDate(x.date)&&Number(x.close)>0).slice(-100);if(valid.length<8){el.textContent='لا توجد جلسات تاريخية كافية لرسم الشارت';return;}
 const close=valid.map(x=>Number(x.close)),res=Number(ref.resistance20),lo=Math.min(...close,res||Infinity)*.965,hi=Math.max(...close,res||0)*1.035;
 const x=i=>pad.l+i*plotW/(valid.length-1),y=v=>pad.t+(hi-v)*plotH/(hi-lo);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('role','img');svg.setAttribute('aria-label','الشارت التاريخي للأسعار، مع خط مقاومة سابق');const add=(name,attr,text)=>{const e=document.createElementNS(ns,name);for(const [k,v]of Object.entries(attr))e.setAttribute(k,String(v));if(text!=null)e.textContent=text;svg.append(e);return e};
 for(let k=0;k<=4;k++){const price=lo+(hi-lo)*k/4,yy=y(price);add('line',{x1:pad.l,y1:yy,x2:W-pad.r,y2:yy,stroke:'#29435b','stroke-width':1});add('text',{x:pad.l-8,y:yy+4,fill:'#a3bfd7','font-size':12,'text-anchor':'end'},fmt(price,2))}
 const line=arr=>arr.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(p).toFixed(1)).join(' ');
 add('path',{d:line(close),fill:'none',stroke:'#7dd4fa','stroke-width':2.7,'stroke-linejoin':'round'});
 const ma=valid.map((_,i)=>i<19?null:close.slice(i-19,i+1).reduce((a,b)=>a+b,0)/20);const maStart=ma.findIndex(x=>x!==null);
 if(maStart>=0)add('path',{d:ma.slice(maStart).map((v,i)=>(i?'L':'M')+x(i+maStart).toFixed(1)+','+y(v).toFixed(1)).join(' '),fill:'none',stroke:'#efc77d','stroke-width':1.8});
 if(Number.isFinite(res)&&res>0&&res>=lo&&res<=hi){const yy=y(res);add('line',{x1:pad.l,y1:yy,x2:W-pad.r,y2:yy,stroke:'#ecab69','stroke-dasharray':'7 6','stroke-width':1.4});add('text',{x:W-pad.r-8,y:yy-7,fill:'#f8c68e','text-anchor':'end','font-size':12},'مقاومة '+fmt(res))}
 for(const index of [0,Math.floor((valid.length-1)/2),valid.length-1])add('text',{x:x(index),y:H-10,fill:'#a3bfd7','font-size':12,'text-anchor':index===0?'start':index===valid.length-1?'end':'middle'},valid[index].date);
 el.append(svg);
}
async function select(t){state.selected=t;drawList();const r=state.rows.find(x=>x.ticker===t);if(!r)return;
 const d=$('detail');d.replaceChildren();const head=document.createElement('div');head.className='head';const title=document.createElement('h2');title.textContent=r.ticker+' — تحليل الفرصة البحثية';head.append(title,tag('لا توجد توصية شراء معتمدة',true));d.append(head);
 const summary=document.createElement('p');summary.className='sub';summary.textContent='جلسة الترتيب '+state.snapshot.session+' | نموذج اختراق سعري بحثي | التقييم '+fmt(r.relativeResearchScore,1)+'/100';d.append(summary);
 const facts=document.createElement('div');facts.className='facts';const entries=[['آخر إغلاق من مصدر '+(r.priceSource==='SECONDARY_PUBLIC'?'ثانوي':'غير مؤكد'),fmt(r.close)+' جنيه'],['تغير الجلسة',(r.changePct>=0?'+':'')+fmt(r.changePct)+'%'],['المقاومة السابقة',fmt(r.resistance20)+' جنيه'],['عتبة مراقبة الاختراق',fmt(r.indicativeTrigger,3)+' جنيه'],['حجم التداول / متوسطه',fmt(r.volumeRatio20)+'×'],['القرار','مراقبة مشروطة']];
 for(const [label,v]of entries){const box=document.createElement('div');box.className='fact';const s=document.createElement('small');s.className='sub';s.textContent=label;const b=document.createElement('b');b.textContent=v;box.append(s,b);facts.append(box)}d.append(facts);
 const plans=document.createElement('section');plans.style.margin='16px 0';const planTitle=document.createElement('h2');planTitle.textContent='خطط التداول الورقي المشروطة — دخول ووقف وأهداف';plans.append(planTitle);
 const intro=document.createElement('p');intro.className='sub tiny';intro.textContent='هذه مستويات سيناريو افتراضية مشتقة من المقاومة/الدعم وATR. ليست أوامر شراء، ولا نسبة نجاح مُثبتة. تفعيلها يتطلب جلسة جديدة تؤكد الشروط، واعتماد مصدر السعر والهوية والتكاليف.';plans.append(intro);
 const scenarioNames={BREAKOUT:'دخول باختراق مقاومة',SUPPORT_BOUNCE:'دخول بارتداد من دعم'};
 if(!Array.isArray(r.scenarios)||r.scenarios.length===0){
   const no=document.createElement('div');no.className='notice';no.textContent='خطط الدخول والوقف والأهداف غير متاحة في ملف الترتيب المعروض، أو رفضت بسبب مخاطر غير ملائمة. تحقق من تحديث نشر البيانات.';plans.append(no);
 }else for(const sc of r.scenarios){
  const panel=document.createElement('div');panel.className='notice';panel.style.margin='10px 0';
  const heading=document.createElement('strong');heading.textContent=(scenarioNames[sc.strategy]||sc.strategy)+' — '+(sc.status==='PAPER_CONDITIONAL'?'مستوفٍ لشروط بحثية أولية؛ لم يُعتمد':'بانتظار تحقق الشروط');panel.append(heading);
  if(sc.entry!=null&&sc.stop!=null&&sc.target1!=null){
   const cells=document.createElement('div');cells.className='facts';cells.style.marginTop='10px';
   for(const [label,value] of [['الدخول الافتراضي',fmt(sc.entry,4)+' ج'],['وقف الخسارة',fmt(sc.stop,4)+' ج'],['الهدف الأول',fmt(sc.target1,4)+' ج'],['الهدف الثاني',fmt(sc.target2,4)+' ج'],['مخاطرة السعر',fmt(sc.riskPct)+'%'],['العائد / المخاطرة','1:'+fmt(sc.rewardRisk1,1)+' / 1:'+fmt(sc.rewardRisk2,1)]]){
    const c=document.createElement('div');c.className='fact';const t=document.createElement('small');t.className='sub';t.textContent=label;const v=document.createElement('b');v.textContent=value;c.append(t,v);cells.append(c);
   }panel.append(cells);
  }
  const desc=document.createElement('p');desc.className='tiny sub';desc.textContent='شرط التفعيل: '+(sc.trigger||'غير محدد')+' | سبب الحالة: '+sc.reason+(sc.status==='REJECTED_RISK'?' | مرفوض لتجاوز ضوابط المخاطرة':'');panel.append(desc);plans.append(panel);
 }
 d.append(plans);
 const chart=document.createElement('div');chart.className='chart-wrap';chart.textContent='جارٍ تحميل التاريخ السعري...';d.append(chart);
 const legend=document.createElement('p');legend.className='sub tiny';legend.textContent='الشارت: خط أزرق للإغلاقات المخزنة، أصفر SMA20، برتقالي للمقاومة السابقة. مصدر التاريخ قد يكون غير رسمي ويختلف عن إغلاق التقرير الرسمي.';d.append(legend);
 const why=document.createElement('h2');why.textContent='أسباب الترتيب والقرار';d.append(why);
 const ul=document.createElement('ul');ul.className='reasons';const reasons=[
 'درجة فنية بحثية نسبية: '+fmt(r.relativeResearchScore,1)+' من 100، وليست احتمال ربح.',
 'القرب من مقاومة 20 جلسة: '+fmt((r.resistance20/r.close-1)*100,2)+'%؛ الاختراق لم يُؤكَّد.',
 'قوة الحجم: '+fmt(r.volumeRatio20)+' مرة من متوسط 20 جلسة؛ '+(r.volumeRatio20>=1.2?'حجم داعم نسبيًا.':'الحجم غير كافٍ وحده لتأكيد الاختراق.'),
 r.abovePriorSMA20?'الإغلاق أعلى من المتوسط المتحرك السابق SMA20.':'الإغلاق دون المتوسط المتحرك السابق SMA20.',
 r.note||'لا ملاحظات إضافية','الأهداف والوقف المعروضة افتراضية مبنية على وحدات المخاطرة، ولا تكون أوامر قابلة للتنفيذ دون قبول البيانات.'
 ];for(const reason of reasons){const li=document.createElement('li');li.textContent=reason;ul.append(li)}d.append(ul);
 const evidence=document.createElement('div');evidence.className='notice';evidence.textContent='جارٍ مقارنة بيانات الشارت مع مرجع الجلسة...';d.append(evidence);
 const foot=document.createElement('p');foot.className='tiny sub';foot.textContent='التحديث اليومي لا يعدّل إشارة قديمة بأثر رجعي. الدخول الافتراضي مشروط بتأكيد الجلسة والسيولة والهوية والرسوم وانضباط المخاطرة.';d.append(foot);
 try{let h=state.cache.get(t);if(!h){h=await get(base+'history/'+encodeURIComponent(t)+'.json');state.cache.set(t,h)}
 if(t!==state.selected)return;const bars=(h.sessions||[]).filter(x=>x.date<=state.snapshot.session&&x.close>0).sort((a,b)=>a.date.localeCompare(b.date));svgChart(chart,bars,r);
 const last=bars.findLast(x=>x.date===state.snapshot.session);
 const mismatch=last&&Math.abs(last.close-r.close)>Math.max(.005,r.close*.001);
 evidence.textContent=!last?'الشارت لا يحتوي على جلسة الترتيب؛ المرجع الرسمي محفوظ منفصلًا. غير مؤهل للتداول.':mismatch?'تعارض أسعار: إغلاق التقرير المرجعي '+fmt(r.close)+' مقابل تاريخ المستودع '+fmt(last.close)+' لنفس الجلسة. ممنوع اعتماد إشارة حتى حل التعارض.':'السعر المخزن متفق حسابيًا مع مرجع التقرير لهذه الجلسة، لكن هوية ISIN واعتماد الاستراتيجية لا يزالان مطلوبين.';
 evidence.style.borderColor=mismatch?'#c97954':'#907338';
 }catch(e){chart.textContent='تعذر تحميل التاريخ السعري: '+e.message;evidence.textContent='الشارت غير متاح؛ لا يتم توليد توصية في غياب التاريخ الموثوق.'}
}
async function init(){try{
 const d=await get('./latest-ranking.json')
 if(!Array.isArray(d.rows)||!isDate(d.session))throw Error('تقرير ترتيب غير صالح');
 state.snapshot=d;state.rows=d.rows;$('session').textContent=d.session;$('count').textContent=d.rows.length;$('qualified').textContent=d.qualifiedTradeCount||0;$('mode').textContent='بحثي — مشروط';
 const age=(Date.now()-Date.parse(d.session+'T15:00:00+02:00'))/86400000;
 status((age>2?'تنبيه: بيانات الترتيب قديمة. ':'')+'جلسة '+d.session+' — '+d.rows.length+' أسهم مرتبة للبحث. الشارت من التاريخ المخزن؛ اختلاف مصادر الأسعار يُحجب معه قرار الشراء. لا توصيات شراء معتمدة.');
 drawList();await select(state.rows[0]?.ticker);
 }catch(e){status('فشل تحميل الترتيب: '+e.message+' — لا يجوز استخدام ترتيب قديم كأنه تحديث جديد.');$('list').textContent='لا توجد بيانات جاهزة للتقييم.'}}
$('sort').addEventListener('change',drawList);$('q').addEventListener('input',drawList);$('reload').addEventListener('click',init);init();
})();