(()=>{'use strict';
const $=id=>document.getElementById(id);
const key='egx-v4-official-import-v1';
const base='https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/paper-v4/official-session-latest.json';
const money=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:3}):'—';
const sampleMap=new Map([['1','COMI'],['8','TMGH'],['11','ETEL'],['12','FWRY'],['13','AUTO'],['18','EMFD'],['21','ADIB'],['29','ABUK'],['45','SKPC'],['52','SWDY'],['55','HRHO'],['64','EAST'],['91','JUFO'],['113','AJWA'],['140','MMAT'],['185','CPCI']]);
const readLocal=()=>{try{const d=JSON.parse(localStorage.getItem(key)||'null');return d&&/^\d{4}-\d{2}-\d{2}$/.test(d.session)&&Array.isArray(d.rows)&&d.rows.length>=80?d:null}catch{return null}};
async function readPublished(){
 for(const url of [base,'./official-session-latest.json']){
  try{const r=await fetch(url+'?t='+Date.now(),{cache:'no-store'});if(!r.ok)continue;const d=await r.json();if(d.session&&Array.isArray(d.quotes)&&d.quotes.length)return d}catch(_){}
 }
 return null;
}
const cell=(label,value)=>{const wrap=document.createElement('div');wrap.style.cssText='padding:10px;background:#102941;border-radius:9px';const a=document.createElement('small');a.className='sub';a.textContent=label;const b=document.createElement('div');b.style.cssText='font-size:18px;font-weight:700';b.textContent=value;wrap.append(a,b);return wrap};
function render(quotes,session,label,extra){
 const root=$('official-quotes');root.replaceChildren();
 const heading=document.createElement('div');heading.style.cssText='display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap';
 const h=document.createElement('h2');h.textContent='أسعار إغلاق البورصة الرسمية — '+session;h.style.margin='0';
 const source=document.createElement('span');source.className='tag warn';source.textContent=label;heading.append(h,source);root.append(heading);
 const note=document.createElement('p');note.className='sub';note.textContent='هذه أسعار إغلاق واردة بتقرير الجلسة؛ ليست توصيات جديدة. لا يتم اعتماد OHLC أو مستويات الدخول والوقف إذا اختلفت القيم أو لم تُراجع هوية السهم. '+extra;root.append(note);
 const box=document.createElement('div');box.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:9px';
 for(const q of quotes){
  if(!(Number(q.close)>0))continue;
  const tile=document.createElement('div');tile.style.cssText='border:1px solid #34536e;border-radius:9px;padding:12px;background:#0e2034';
  const title=document.createElement('strong');title.style.cssText='display:block;font-size:17px';title.textContent=(q.ticker||('صف '+q.rowNumber));
  const name=document.createElement('div');name.className='sub tiny';name.textContent=q.company||q.name||'';
  const value=document.createElement('div');value.style.cssText='font-size:24px;font-weight:bold';value.textContent=money(q.close)+' '+(q.currency||'EGP');
  const ch=document.createElement('div');ch.textContent=Number.isFinite(Number(q.changePct))?(q.changePct>=0?'+':'')+money(q.changePct)+'%':'';
  const qual=document.createElement('small');qual.style.color='#edcd87';qual.textContent=(q.ohlcStatus||q.quality)==='PASS_OHLC' ||(q.ohlcStatus||q.quality)==='PASS_OHLCV'?'OHLC اجتاز الفحص الحسابي':'إغلاق متاح · OHLC يحتاج مراجعة';
  tile.append(title,name,value,ch,qual);box.append(tile);
 }
 root.append(box);
 const footer=document.createElement('p');footer.className='sub tiny';footer.textContent='الترتيب الفني والخطط الظاهرة في الجزء التالي قد تعود لجلسة سابقة؛ لا تستخدم أي مستويات دخول قديمة لتداول اليوم.';root.append(footer);
}
(async()=>{
 const local=readLocal(),published=await readPublished();
 // A locally imported report is visible immediately in the same browser, but never claimed to be centrally published.
 if(local&&(!published||local.session>published.session)){
  const quotes=local.rows.filter(x=>Number(x.close)>0&&x.currency==='EGP').sort((a,b)=>(b.volume||0)-(a.volume||0)).slice(0,24).map(x=>({...x,ticker:local.session==='2026-11-04'?sampleMap.get(String(x.rowNumber)):null}));
  render(quotes,local.session,'استيرادك المحلي — غير منشور مركزيًا','تم قراءة '+local.rows.length+' صف إغلاق محليًا؛ '+(local.validOhlcvCount??'؟')+' OHLC اجتاز الفحص.');
 }else if(published){
  render(published.quotes,published.session,'ملف إغلاقات مؤرخ — مراجعة بحثية','الأسهم المعروضة عينة '+published.quotes.length+' سهمًا من التقرير؛ ملف التغطية الكاملة قيد التدقيق.');
 }else if(local){
  render(local.rows.filter(x=>x.close>0).slice(0,24),local.session,'نتيجة الاستيراد المحلي','لا يوجد ملف منشور أحدث.');
 }else{
  $('official-quotes').textContent='لم تتوفر إغلاقات رسمية منشورة أو مستوردة محليًا حتى الآن.';
 }
})();
})();
