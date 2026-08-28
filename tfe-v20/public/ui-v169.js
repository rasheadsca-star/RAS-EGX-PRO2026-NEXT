'use strict';

const API='/api/index';
const K={
  portfolio:'egx-tfe-rc2-v169-portfolio',
  fundamentals:'egx-tfe-rc2-v169-fundamentals',
  settings:'egx-tfe-rc2-v169-risk-settings',
  archive:'egx-tfe-rc2-v169-forward-archive'
};
const $=id=>document.getElementById(id);
const A=x=>Array.isArray(x)?x:[];
const N=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const F=(x,d=2)=>N(x)===null?'—':Number(x).toLocaleString('en-GB',{maximumFractionDigits:d});
const P=x=>N(x)===null?'—':F(x,1)+'%';
const M=x=>N(x)===null?'—':Number(x).toLocaleString('en-GB',{maximumFractionDigits:0})+' ج.م';
const C=(x,a=0,b=100)=>Math.max(a,Math.min(b,Number(x)||0));
const E=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const load=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}};
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const norm=x=>String(x||'').toLowerCase().normalize('NFKD').replace(/[\u064b-\u065f\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[^a-z0-9\u0600-\u06ff]+/g,' ').replace(/\s+/g,' ').trim();

const S={
  health:null,scan:null,market:null,sim:null,decisionLog:null,ablation:null,
  selected:null,selectedHistory:null,withheld:[],loadingEvidence:false,
  pf:load(K.portfolio,[]),
  f:load(K.fundamentals,{}),
  settings:load(K.settings,{portfolioRiskLimit:2,portfolioPositionLimit:5,strategyExposureLimit:40}),
  archive:load(K.archive,[])
};

function toast(t){const e=$('toast');if(!e)return;e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)}
async function api(route,params={}){
  const q=new URLSearchParams({route,...Object.fromEntries(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&v!==''))});
  const r=await fetch(`${API}?${q.toString()}&t=${Date.now()}`,{cache:'no-store'});
  const d=await r.json();
  if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);
  return d;
}
function row(a,b,c=''){return `<div class="detail-row"><span>${E(a)}</span><b class="${c}">${E(b)}</b></div>`}
function qualityCls(q){return q==='TRUSTED'?'good':q==='REVIEW'?'warn':'bad'}
function recPresentation(x){
  if(x.publicationState==='PRICE_RECONCILIATION_REQUIRED'||x.publicationEligible===false)return{status:'blocked',label:'موقوفة/محجوبة',cls:'bad'};
  if(x.decision==='RESEARCH_BUY_ZONE'&&x.quality?.state==='TRUSTED')return{status:'eligible',label:'جاهزة للمراجعة',cls:'good'};
  return{status:'caution',label:'Pending / متابعة',cls:'warn'};
}
function byTicker(t){return A(S.scan?.recommendations).find(x=>x.ticker===t)||S.withheld.find(x=>x.ticker===t)||null}
function marketMeta(t){return A(S.market?.symbols).find(x=>x.ticker===t)||null}
function effectiveSessionDate(){
  const dates=[S.scan?.universe?.sessionDate,S.market?.sessionDate,...A(S.scan?.recommendations).map(x=>x?.sessionDate),...S.withheld.map(x=>x?.sessionDate)].filter(Boolean).sort();
  return dates.at(-1)||null;
}
let lastRefreshAt=0;

function archiveCurrentScan(){
  if(!S.scan)return;
  const existing=new Set(S.archive.map(x=>`${x.sessionDate}|${x.ticker}`));
  const universeDate=S.scan?.universe?.sessionDate||null;
  let changed=false;
  for(const x of A(S.scan.recommendations)){
    const sessionDate=x.sessionDate||universeDate;if(!sessionDate)continue;
    const key=`${sessionDate}|${x.ticker}`;
    if(universeDate&&sessionDate!==universeDate&&!existing.has(key)){
      const wrong=S.archive.find(r=>r.ticker===x.ticker&&r.sessionDate===universeDate&&r.sourceCommit==null&&(r.outcome==='OPEN'||!r.outcome)&&N(r.entryLow)===N(x.tradePlan?.entryLow)&&N(r.entryHigh)===N(x.tradePlan?.entryHigh)&&N(r.stop)===N(x.tradePlan?.stop)&&N(r.target1)===N(x.tradePlan?.target1));
      if(wrong){existing.delete(`${wrong.sessionDate}|${wrong.ticker}`);wrong.sessionDate=sessionDate;existing.add(key);changed=true;continue}
    }
    if(existing.has(key))continue;
    S.archive.push({
      sessionDate,
      firstSeenAt:S.scan.generatedAt||new Date().toISOString(),
      ticker:x.ticker,
      decision:x.decision,
      publicationState:x.publicationState,
      price:x.price,
      entryLow:x.tradePlan?.entryLow,
      entryHigh:x.tradePlan?.entryHigh,
      stop:x.tradePlan?.stop,
      target1:x.tradePlan?.target1,
      target2:x.tradePlan?.target2,
      fusionRank:x.scores?.fusionRank,
      wilson:x.historicalConfidence?.confidenceWilsonLower95Pct,
      sourceCommit:null,
      outcome:'OPEN'
    });
    existing.add(key);changed=true;
  }
  if(changed){S.archive.sort((a,b)=>String(b.sessionDate).localeCompare(String(a.sessionDate))||String(a.ticker).localeCompare(String(b.ticker)));save(K.archive,S.archive)}
}

function readiness(){
  const s=S.scan?.summary||{};
  const uni=S.scan?.universe||{};
  const safe=S.health?.policy?.permissions||{};
  const currentSession=effectiveSessionDate();const freshness=currentSession&&S.market?.sessionDate&&currentSession===S.market.sessionDate?100:70;
  const breadth=s.scanned&&uni.currentVerifiedCandidates?C(s.scanned/uni.currentVerifiedCandidates*100):0;
  const safety=safe.executionAllowed===false&&safe.automaticOrders===false&&safe.productionAllocation===false?100:0;
  const evidence=S.sim?.summary?C((N(S.sim.summary.wilson95LowerTarget1Pct)||0)*1.25):45;
  const transparency=S.health?.technicalCore==='ORIGINAL_SCOREBARS_PRESERVED'&&S.scan?.ranking?.hardGatesBeforeHistoricalConfidence?100:70;
  const score=Math.round(freshness*.25+breadth*.20+safety*.20+evidence*.20+transparency*.15);
  return{score,axes:[['حداثة جلسة السوق',freshness],['تغطية الكون الحالي',breadth],['قفل التنفيذ والحوكمة',safety],['قوة الدليل التاريخي',evidence],['شفافية المنهج',transparency]]};
}
function renderReady(){
  if(!S.scan||!S.health)return;
  const r=readiness(),g=$('readinessGauge');
  const color=r.score>=80?'var(--green)':r.score>=60?'var(--amber)':'var(--red)';
  g.style.background=`conic-gradient(${color} ${r.score*3.6}deg,#17344a 0)`;
  g.innerHTML=`<strong>${r.score}</strong><span>من 100</span>`;
  $('readinessBreakdown').innerHTML=r.axes.map(x=>`<div class="breakdown-row"><span>${E(x[0])}</span><div class="bar"><i style="width:${C(x[1])}%"></i></div><b>${Math.round(x[1])}</b></div>`).join('');
  const stage='Research / Shadow RC2';
  $('productStage').textContent=stage;$('productStage').className='badge warn';
  $('professionalVerdict').className='professional-verdict warn';
  $('professionalVerdict').innerHTML=`<b>${stage}</b><br>الواجهة تقيس جاهزية البحث والحوكمة فقط. <b>لا تغيّر Alpha أو Fusion Rank</b>، والتنفيذ الآلي مقفول من المحرك نفسه.`;
}
function renderTruth(){
  if(!S.scan)return;
  const s=S.scan.summary||{},uni=S.scan.universe||{},sim=S.sim?.summary||{};
  const cards=[
    ['آخر جلسة بيانات فعلية',effectiveSessionDate()||uni.sessionDate||'—',`${s.scanned||0} سهم تم فحصه${effectiveSessionDate()&&uni.sessionDate&&effectiveSessionDate()!==uni.sessionDate?` · Universe summary ${uni.sessionDate}`:''}`],
    ['مرشحو RC2 المنشورون',F(s.publicationEligibleTotal,0),`${F(s.technicalEligibleTotal,0)} مؤهلين فنيًا · ${F(s.withheldForPriceReconciliation,0)} موقوف للمصالحة`],
    ['T1 Historical',sim.target1Pct==null?'جارٍ القياس':P(sim.target1Pct),sim.entered?`${F(sim.entered,0)} صفقة · PF ${F(sim.profitFactor,2)}`:'الدليل التاريخي منفصل عن التوصية الحالية'],
    ['صلاحية التنفيذ','BLOCKED','researchOnly=true · automaticOrders=false'],
    ['V20 Native Overlay',uni.v20NativeSessionDate||'—','Provenance فقط ولا يدخل كـ scoring input'],
    ['V17 Safety Overlay',S.scan.v17?.sessionDate||'—',S.scan.v17?.executionReady?'حتى لو READY لا يفتح تنفيذ TFE':'Execution override = false']
  ];
  $('truthGrid').innerHTML=cards.map(x=>`<div class="truth-card"><small>${E(x[0])}</small><b>${E(x[1])}</b><span>${E(x[2])}</span></div>`).join('');
}
function gateRows(x){
  const q=x.quality?.state,liq=x.liquidity||{},sr=x.supportResistance||{},tp=x.tradePlan||{};
  return [
    [q==='BLOCKED'?'fail':q==='REVIEW'?'warn':'pass',`جودة البيانات: ${q||'—'}`],
    [liq.eligible?'pass':'fail',`السيولة: ${F(liq.score,1)}/100`],
    [(N(sr.score)||0)>=55&&N(sr.methodCount)>=2?'pass':'fail',`S/R: ${F(sr.score,1)} · ${F(sr.methodCount,0)} methods`],
    [(N(tp.structuralNetRR)||0)>=.7?'pass':'fail',`Net R/R: ${F(tp.structuralNetRR,2)}`],
    [['IN_ENTRY_RANGE','NEAR_ENTRY_PULLBACK','PENDING_PULLBACK'].includes(tp.alignmentState)?'pass':'fail',`Alignment: ${tp.alignmentState||'—'}`],
    [x.historicalConfidence?.historicalTradeCount>0?'pass':'warn',x.historicalConfidence?.historicalTradeCount>0?`Wilson: ${P(x.historicalConfidence.confidenceWilsonLower95Pct)} / N=${x.historicalConfidence.historicalTradeCount}`:'Wilson: لا يوجد sample مطابق — وزن 0%']
  ];
}
function renderRecs(){
  const filter=$('recommendationFilter')?.value||'all';
  let rows=[...A(S.scan?.recommendations),...S.withheld].map(x=>[x,recPresentation(x)]).filter(([,p])=>filter==='all'||p.status===filter);
  $('recommendationGrid').innerHTML=rows.length?rows.map(([x,p])=>{
    const tp=x.tradePlan||{},hist=x.historicalConfidence||{};
    return `<article class="rec-card ${S.selected?.ticker===x.ticker?'selected':''}">
      <div class="rec-rank">${E(x.rank??'—')}</div><h3>${E(x.ticker)}</h3><div class="rec-name">${E(x.nameAr||marketMeta(x.ticker)?.companyNameAr||x.nameEn||'')}</div>
      <div class="tag-row"><span class="tag ${p.cls}">${E(p.label)}</span><span class="tag neutral">${E(x.decision||x.publicationState||'—')}</span></div>
      <div class="rec-metrics">
        <div class="mini">السعر<b>${F(x.price,3)}</b></div><div class="mini">الدخول<b>${F(tp.entryLow,3)}–${F(tp.entryHigh,3)}</b></div>
        <div class="mini">T1<b>${F(tp.target1,3)}</b></div><div class="mini">Stop<b>${F(tp.stop,3)}</b></div>
        <div class="mini">Tech<b>${F(x.scores?.core,1)}</b></div><div class="mini">Fusion<b>${F(x.scores?.fusionRank,1)}</b></div>
        <div class="mini">Wilson<b>${P(hist.confidenceWilsonLower95Pct)}</b></div><div class="mini">Hist N<b>${F(hist.historicalTradeCount,0)}</b></div>
      </div>
      <div class="gate-list">${gateRows(x).slice(0,5).map(g=>`<div class="gate ${g[0]}"><span>${E(g[1])}</span><b>${g[0]==='pass'?'✓':g[0]==='warn'?'!':'✕'}</b></div>`).join('')}</div>
      <div class="rec-verdict ${p.cls}">${p.status==='blocked'?'لا تُنشر قبل إزالة سبب الحجب/المصالحة.':p.status==='eligible'?'مرشح RC2 داخل منطقة مناسبة للمراجعة اليدوية.':'مرشح RC2 لكن التنفيذ ينتظر Pullback/تأكيد المنطقة.'}</div>
      <button class="btn" data-select="${E(x.ticker)}">تحليل كامل</button>
    </article>`
  }).join(''):'<div class="empty">لا توجد فرص في هذا الفلتر.</div>';
  $('recommendationGrid').querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>selectTicker(b.dataset.select));
}

function fundamentalScore(d,price){
  if(!d||!d.auditedData)return{score:0,label:'غير مكتمل',cls:'bad',notes:['لا توجد أرقام مالية موثقة ومدققة. هذا التقييم لا يؤثر على RC2.']};
  let s=0,n=[];const r=N(d.revenueGrowth),p=N(d.profitGrowth),roe=N(d.roe),de=N(d.debtEquity),pe=N(d.pe),fv=N(d.fairValue),cp=N(price);
  if(r!==null){s+=r>=15?15:r>0?8:0;n.push(r>0?'نمو الإيرادات موجب.':'الإيرادات لا تنمو.')}
  if(p!==null){s+=p>=20?20:p>0?10:0;n.push(p>0?'نمو الأرباح موجب.':'ضغط في الأرباح.')}
  if(roe!==null){s+=roe>=20?20:roe>=12?12:roe>0?5:0;n.push('ROE '+P(roe))}
  if(de!==null){s+=de<=.5?15:de<=1?9:de<=2?3:0;if(de>2)n.push('مديونية مرتفعة.')}
  if(pe!==null){s+=pe>0&&pe<=12?12:pe<=20?7:pe>0?2:0;n.push('P/E '+F(pe,1))}
  if(d.positiveCfo){s+=10;n.push('التدفق التشغيلي موجب.')}else n.push('التدفق التشغيلي غير مؤكد.')
  if(fv!==null&&cp>0){const u=(fv/cp-1)*100;s+=u>=20?8:u>=8?4:0;n.push('هامش القيمة العادلة '+P(u))}
  s=C(s);return{score:s,label:s>=70?'قوي':s>=50?'مقبول':s>=30?'ضعيف':'غير كافٍ',cls:s>=70?'good':s>=50?'warn':'bad',notes:n};
}
function renderSelected(){
  const x=S.selected;if(!x){$('selectedTitle').textContent='تفاصيل السهم';return}
  const meta=marketMeta(x.ticker),tp=x.tradePlan||{},hist=x.historicalConfidence||{},p=recPresentation(x),fs=fundamentalScore(S.f[x.ticker],x.price);
  $('selectedTitle').textContent=`${x.ticker} — ${x.nameAr||meta?.companyNameAr||''}`;
  $('selectedSubtitle').textContent=`جلسة ${x.sessionDate||S.scan?.universe?.sessionDate||'—'} · ${x.publicationState||x.decision||'—'} · Fusion ${F(x.scores?.fusionRank,1)}`;
  $('selectedDecision').textContent=p.label;$('selectedDecision').className='badge '+p.cls;
  const breakdown=A(x.technical?.breakdown);
  $('technicalDetail').innerHTML=`<div class="technical-breakdown">${breakdown.map(c=>`<div class="component"><div class="component-head"><span>${E(c.component)}</span><b>${F(c.points,1)} / ${F(c.max,1)}</b></div><small>${E(c.detail)}</small></div>`).join('')}</div>`+
    row('Original Technical',F(x.scores?.core,1)+'/100',x.scores?.core>=70?'green':'red')+row('Research Score',F(x.scores?.research,1)+'/100')+row('Fusion Rank',F(x.scores?.fusionRank,1)+'/100','blue')+row('Historical Wilson',P(hist.confidenceWilsonLower95Pct))+row('Historical N',F(hist.historicalTradeCount,0));
  $('riskDetail').innerHTML=row('منطقة الدخول',`${F(tp.entryLow,3)} – ${F(tp.entryHigh,3)}`)+row('Stop',F(tp.stop,3),'red')+row('T1',F(tp.target1,3),'green')+row('T2',F(tp.target2,3),'blue')+row('Structural Net R/R',F(tp.structuralNetRR,2))+row('Alignment',tp.alignmentState||'—')+row('Liquidity',F(x.liquidity?.score,1)+'/100')+row('S/R',F(x.supportResistance?.score,1)+'/100')+row('Data Quality',x.quality?.state||'—',qualityCls(x.quality?.state))+`<div class="reason-list">${A(x.reasonCodes).map(r=>`<span class="reason-code">${E(r)}</span>`).join('')}</div>`;
  $('fundamentalDetail').innerHTML=row('الحالة','Supplemental Only','amber')+row('النتيجة المحلية',F(fs.score,0)+'/100',fs.cls==='good'?'green':fs.cls==='warn'?'amber':'red')+row('التقييم',fs.label)+`<div class="score-notes">${fs.notes.slice(0,4).map(n=>`<div class="score-note">${E(n)}</div>`).join('')}</div><div class="fundamental-disclaimer" style="margin:8px 0 0">لا تدخل هذه البيانات في RC2 ولا تعدل التوصية.</div>`;
  renderPosition();
}
async function selectTicker(t){
  t=String(t||'').trim().toUpperCase();if(!t)return;
  try{
    $('selectedTitle').textContent=`${t} — جارٍ التحليل…`;
    let x=byTicker(t);
    if(!x){const d=await api('analyze',{ticker:t});x=d.result}
    S.selected=x;renderRecs();renderSelected();
    const h=await api('history',{ticker:t,limit:120});S.selectedHistory=h;drawChart(h.bars,x.tradePlan);$('chartLegend').hidden=false;
    document.querySelector('.tab[data-view="dashboard"]')?.click();
    $('selectedPanel')?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){toast(`تعذر تحليل ${t}: ${e.message}`)}
}
function drawChart(bars,plan){
  bars=A(bars);if(!bars.length){$('chartBox').innerHTML='<div class="empty">لا يتوفر تاريخ كافٍ للرسم.</div>';return}
  const w=920,h=320,pad={l:55,r:20,t:20,b:36};const closes=bars.map(x=>N(x.close)).filter(x=>x!==null);let levels=[plan?.entryLow,plan?.entryHigh,plan?.stop,plan?.target1,plan?.target2].map(N).filter(x=>x!==null);const ymin=Math.min(...closes,...levels)*.985,ymax=Math.max(...closes,...levels)*1.015;const sx=i=>pad.l+i*(w-pad.l-pad.r)/Math.max(1,bars.length-1),sy=v=>pad.t+(ymax-v)/(ymax-ymin||1)*(h-pad.t-pad.b);const pts=bars.map((b,i)=>`${sx(i).toFixed(1)},${sy(b.close).toFixed(1)}`).join(' ');
  const grid=[0,.25,.5,.75,1].map(t=>{const y=pad.t+t*(h-pad.t-pad.b),v=ymax-t*(ymax-ymin);return `<line x1="${pad.l}" y1="${y}" x2="${w-pad.r}" y2="${y}" stroke="#17384c" stroke-width="1"/><text x="5" y="${y+4}" fill="#8fa9b8" font-size="10">${F(v,3)}</text>`}).join('');
  const line=(v,color,label)=>N(v)===null?'':`<line x1="${pad.l}" y1="${sy(v)}" x2="${w-pad.r}" y2="${sy(v)}" stroke="${color}" stroke-width="1.4" stroke-dasharray="6 5"/><text x="${w-pad.r-5}" y="${sy(v)-4}" fill="${color}" text-anchor="end" font-size="9">${label} ${F(v,3)}</text>`;
  const xlabels=[0,Math.floor((bars.length-1)/2),bars.length-1].map(i=>`<text x="${sx(i)}" y="${h-10}" fill="#8fa9b8" text-anchor="middle" font-size="9">${E(bars[i]?.date||'')}</text>`).join('');
  $('chartBox').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Price chart"><rect width="100%" height="100%" fill="#061521"/>${grid}<polyline points="${pts}" fill="none" stroke="#39bdf0" stroke-width="2.2"/>${line(plan?.entryLow,'#39bdf0','Entry L')}${line(plan?.entryHigh,'#39bdf0','Entry H')}${line(plan?.stop,'#ff7181','Stop')}${line(plan?.target1,'#3edb9a','T1')}${line(plan?.target2,'#b7a0ff','T2')}${xlabels}</svg>`;
}

function positionCalc(){
  const x=S.selected,tp=x?.tradePlan||{};const entry=N(tp.entryHigh),stop=N(tp.stop),capital=N($('capitalInput')?.value),riskPct=N($('riskPctInput')?.value),maxWeight=N($('maxWeightInput')?.value);
  if(!(entry>0&&stop>0&&entry>stop&&capital>0&&riskPct>0&&maxWeight>0))return null;
  const riskCash=capital*riskPct/100,riskPerShare=entry-stop,qtyRisk=Math.floor(riskCash/riskPerShare),qtyWeight=Math.floor((capital*maxWeight/100)/entry),qty=Math.max(0,Math.min(qtyRisk,qtyWeight));const value=qty*entry,risk=qty*riskPerShare;
  return{entry,stop,qty,value,risk,riskPctActual:capital?risk/capital*100:0,weightPct:capital?value/capital*100:0};
}
function renderPosition(){
  const c=positionCalc();if(!c){$('positionResult').innerHTML='<div class="empty">اختر سهمًا بخطة دخول صالحة.</div>';$('addPortfolioBtn').disabled=true;return}
  $('positionResult').innerHTML=`<div class="result-row"><span>الكمية القصوى</span><b>${F(c.qty,0)}</b></div><div class="result-row"><span>قيمة المركز</span><b>${M(c.value)}</b></div><div class="result-row"><span>الخطر النقدي</span><b>${M(c.risk)}</b></div><div class="result-row"><span>الخطر الفعلي</span><b>${P(c.riskPctActual)}</b></div><div class="result-row"><span>وزن المركز</span><b>${P(c.weightPct)}</b></div>`;$('addPortfolioBtn').disabled=c.qty<=0;
}
function addPortfolio(){
  const x=S.selected,c=positionCalc();if(!x||!c||c.qty<=0)return;
  S.pf.push({id:`${Date.now()}-${x.ticker}`,ticker:x.ticker,status:x.publicationState||x.decision,sessionDate:x.sessionDate,entry:c.entry,stop:c.stop,qty:c.qty,value:c.value,risk:c.risk,strategy:'TFE RC2'});save(K.portfolio,S.pf);renderPortfolio();toast('تمت الإضافة للمحفظة التجريبية')
}
function renderPortfolio(){
  const cap=N($('capitalInput')?.value)||100000,totalValue=S.pf.reduce((s,x)=>s+(N(x.value)||0),0),totalRisk=S.pf.reduce((s,x)=>s+(N(x.risk)||0),0),riskPct=cap?totalRisk/cap*100:0,expPct=cap?totalValue/cap*100:0;
  const limit=N(S.settings.portfolioRiskLimit)||2,posLimit=N(S.settings.portfolioPositionLimit)||5,strategyLimit=N(S.settings.strategyExposureLimit)||40;
  $('portfolioSummary').innerHTML=[['عدد المراكز',`${S.pf.length} / ${posLimit}`,S.pf.length>posLimit?'تجاوز حد المراكز':'ضمن الحد'],['الخطر المفتوح',P(riskPct),riskPct>limit?'تجاوز حد المخاطرة':'ضمن الحد'],['التعرض الكلي',P(expPct),expPct>strategyLimit?'تجاوز حد التعرض للاستراتيجية':'محلي / تجريبي']].map(x=>`<div class="summary-card"><small>${E(x[0])}</small><b>${E(x[1])}</b><span class="${x[2].includes('تجاوز')?'red':'green'}">${E(x[2])}</span></div>`).join('');
  $('portfolioRows').innerHTML=S.pf.length?S.pf.map(x=>`<tr><td>${E(x.ticker)}</td><td>${E(x.status)}</td><td>${F(x.entry,3)}</td><td>${F(x.stop,3)}</td><td>${F(x.qty,0)}</td><td>${M(x.value)}</td><td>${M(x.risk)}</td><td>${E(x.sessionDate||'—')}</td><td><button class="btn danger" data-rm="${E(x.id)}">حذف</button></td></tr>`).join(''):'<tr><td colspan="9"><div class="empty">لا توجد مراكز تجريبية.</div></td></tr>';
  $('portfolioRows').querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{S.pf=S.pf.filter(x=>x.id!==b.dataset.rm);save(K.portfolio,S.pf);renderPortfolio()});
}

function marketStatus(m){
  const rec=byTicker(m.ticker);if(rec?.publicationEligible)return{key:'recommended',label:'مرشح RC2'};if(rec?.publicationState==='PRICE_RECONCILIATION_REQUIRED')return{key:'datawarn',label:'مصالحة سعرية'};if(m.staleData||m.updateFailed||m.symbolVerified===false)return{key:'datawarn',label:'مراجعة بيانات'};return{key:'outside',label:'خارج توصيات اليوم'};
}
function renderMarket(){
  const q=norm($('marketSearch')?.value),scope=$('marketScope')?.value||'all';let rows=A(S.market?.symbols).filter(m=>{const st=marketStatus(m);if(scope!=='all'&&st.key!==scope)return false;return !q||norm(`${m.ticker} ${m.companyNameAr||''} ${m.companyNameEn||''}`).includes(q)}).slice(0,160);
  $('marketResults').innerHTML=rows.length?rows.map(m=>{const st=marketStatus(m),warning=A(m.warnings)[0]||'';return `<div class="market-row ${st.key==='datawarn'?'withheld-row':''}" data-market="${E(m.ticker)}"><b class="blue">${E(m.ticker)}</b><div><b>${E(m.companyNameAr||m.companyNameEn||'')}</b><br><small>${E(m.companyNameEn||'')}</small></div><div class="hide-mobile">${F(m.availableSessions,0)} جلسة</div><div class="hide-mobile">${F(m.averageConfidence,1)}%</div><div class="hide-tablet">${E(m.lastSession||'—')}</div><div class="hide-tablet"><span class="market-status ${st.key}">${E(st.label)}</span></div><div class="optional-col"><small>${E(warning||m.historyStatus||'')}</small></div></div>`}).join(''):'<div class="empty">لا توجد نتائج مطابقة.</div>';
  $('marketResults').querySelectorAll('[data-market]').forEach(r=>r.onclick=()=>selectTicker(r.dataset.market));
}

function populateFundamentalTickers(){
  const list=A(S.market?.symbols);$('fundamentalTicker').innerHTML=list.map(x=>`<option value="${E(x.ticker)}">${E(x.ticker)} — ${E(x.companyNameAr||x.companyNameEn||'')}</option>`).join('');
  if(S.selected?.ticker&&list.some(x=>x.ticker===S.selected.ticker))$('fundamentalTicker').value=S.selected.ticker;loadFundForm();
}
function fundFormData(){return{revenueGrowth:N($('revenueGrowth').value),profitGrowth:N($('profitGrowth').value),roe:N($('roe').value),debtEquity:N($('debtEquity').value),pe:N($('pe').value),fairValue:N($('fairValue').value),positiveCfo:$('positiveCfo').checked,auditedData:$('auditedData').checked,notes:$('fundamentalNotes').value.trim(),savedAt:new Date().toISOString()}}
function loadFundForm(){
  const t=$('fundamentalTicker').value,d=S.f[t]||{};['revenueGrowth','profitGrowth','roe','debtEquity','pe','fairValue'].forEach(k=>$(k).value=d[k]??'');$('positiveCfo').checked=Boolean(d.positiveCfo);$('auditedData').checked=Boolean(d.auditedData);$('fundamentalNotes').value=d.notes||'';renderFundScore();
}
function renderFundScore(){
  const t=$('fundamentalTicker')?.value;if(!t)return;const d=S.f[t]||fundFormData(),current=byTicker(t),score=fundamentalScore(d,current?.price);$('fundamentalScoreCard').innerHTML=`<div class="score-circle" style="background:conic-gradient(${score.score>=70?'var(--green)':score.score>=50?'var(--amber)':'var(--red)'} ${score.score*3.6}deg,#17364b 0)"><strong>${F(score.score,0)}</strong><span>Supplemental / 100</span></div><div class="tag-row"><span class="tag ${score.cls}">${E(score.label)}</span><span class="tag neutral">لا يؤثر على Fusion</span></div><div class="score-notes">${score.notes.map(n=>`<div class="score-note">${E(n)}</div>`).join('')}</div>`;
}
function saveFund(){const t=$('fundamentalTicker').value;if(!t)return;S.f[t]=fundFormData();save(K.fundamentals,S.f);renderFundScore();if(S.selected?.ticker===t)renderSelected();toast('تم حفظ التقييم المالي محليًا')}

async function loadEvidence(force=false){
  if(S.loadingEvidence)return;S.loadingEvidence=true;
  try{
    if(force||!S.sim)S.sim=await api('simulate',{scope:'market',symbols:220});
    if(force||!S.decisionLog)S.decisionLog=await api('decision-log',{format:'json',limit:50});
    if(force||!S.ablation){try{S.ablation=await api('ablation')}catch{S.ablation=null}}
    renderReady();renderTruth();renderEvidence();
  }catch(e){toast('تعذر تحديث الأدلة: '+e.message)}finally{S.loadingEvidence=false}
}
function renderEvidence(){
  const sim=S.sim?.summary||{},archive=S.archive||[],rows=A(S.decisionLog?.rows);
  $('liveEvidenceSummary').innerHTML=[['سجل محلي محفوظ',F(archive.length,0),'First-seen snapshots على هذا الجهاز'],['Decision Log الحالي',F(rows.length,0),S.decisionLog?.sessionDate||'—'],['Historical entered',F(sim.entered,0),'لا يُعتبر Forward Evidence']].map(x=>`<div class="summary-card"><small>${E(x[0])}</small><b>${E(x[1])}</b><span>${E(x[2])}</span></div>`).join('');
  const lower=N(sim.wilson95LowerTarget1Pct)||0,hit=N(sim.target1Pct)||0,n=N(sim.entered)||0;
  $('confidenceGate').innerHTML=`<div class="confidence-box"><b>Historical Evidence — ليس إثباتًا حيًا</b><div class="confidence-progress"><i style="width:${C(lower)}%"></i></div>${row('T1 historical',P(hit))}${row('Wilson 95% Lower',P(lower))}${row('Entered trades',F(n,0))}${row('Forward resolved',F(archive.filter(x=>x.outcome&&x.outcome!=='OPEN').length,0))}<div class="warning-box">لا تُعرض عبارة «مثبت» لمجرد تحسن Backtest. المطلوب Forward Out-of-Sample مجمّد بدون tuning.</div></div>`;
  const combined=[...archive];
  $('evaluationRows').innerHTML=combined.length?combined.map(x=>`<tr><td>${E(x.sessionDate)}</td><td>${E(x.ticker)}</td><td>${E(x.publicationState||x.decision)}</td><td>${F(x.entryLow,3)}–${F(x.entryHigh,3)}</td><td>${F(x.target1,3)}</td><td>${F(x.stop,3)}</td><td>${F(x.fusionRank,1)}</td><td>${P(x.wilson)}</td></tr>`).join(''):'<tr><td colspan="8"><div class="empty">سيبدأ الأرشيف من أول جلسة تشاهدها بهذه الواجهة.</div></td></tr>';
  const models=[
    {name:'RC1',entered:120,t1:65.8,stop:27.5,avg:.66,pf:1.49,wilson:57,verdict:'Baseline السابق'},
    {name:'RC2',entered:sim.entered??64,t1:sim.target1Pct??73.4,stop:sim.stopPct??18.8,avg:sim.avgNetPct??1.23,pf:sim.profitFactor??2.33,wilson:sim.wilson95LowerTarget1Pct??61.5,verdict:'Research / Shadow'}
  ];
  for(const v of A(S.ablation?.variants).slice(0,4))models.push({name:v.label,entered:v.entered,t1:v.target1Pct,stop:v.stopPct,avg:v.avgNetPct,pf:v.profitFactor,wilson:null,verdict:v.evidenceClass||v.historicalAttribution||'Ablation'});
  $('modelRows').innerHTML=models.map(m=>`<tr><td><b>${E(m.name)}</b></td><td>${F(m.entered,0)}</td><td>${P(m.t1)}</td><td>${P(m.stop)}</td><td>${P(m.avg)}</td><td>${F(m.pf,2)}</td><td>${P(m.wilson)}</td><td><span class="model-status ${m.name==='RC2'?'good':'warn'}">${E(m.verdict)}</span></td></tr>`).join('');
}

async function loadWithheld(){
  S.withheld=[];
  for(const w of A(S.scan?.withheldForReconciliation)){
    try{const d=await api('analyze',{ticker:w.ticker});S.withheld.push({...d.result,publicationEligible:false,publicationState:'PRICE_RECONCILIATION_REQUIRED',technicalEligible:true})}catch{}
  }
}
async function refreshAll(){
  $('lastUpdate').textContent='جارٍ تحديث RC2…';
  try{
    const [health,scan,market]=await Promise.all([api('health'),api('scan',{limit:50}),api('market-index')]);
    S.health=health;S.scan=scan;S.market=market;await loadWithheld();archiveCurrentScan();lastRefreshAt=Date.now();
    const effectiveDate=effectiveSessionDate()||scan.universe?.sessionDate||'—';
    $('lastUpdate').innerHTML=`آخر بيانات <b>${E(effectiveDate)}</b>${scan.universe?.sessionDate&&effectiveDate!==scan.universe.sessionDate?` <small>(Universe ${E(scan.universe.sessionDate)})</small>`:''}<br>RC2 · ${E(scan.engine)} · ${E(scan.schemaVersion)}`;
    window.__RC2_UI_SCAN__={health,scan,market,effectiveDate,refreshedAt:new Date().toISOString()};window.dispatchEvent(new CustomEvent('rc2:ui-scan',{detail:window.__RC2_UI_SCAN__}));
    renderReady();renderTruth();renderRecs();renderMarket();populateFundamentalTickers();renderPortfolio();
    if(!S.selected&&scan.recommendations?.[0])selectTicker(scan.recommendations[0].ticker);else if(S.selected)renderSelected();
    loadEvidence(false);
  }catch(e){$('lastUpdate').textContent='تعذر التحديث';toast('خطأ في تحميل RC2: '+e.message)}
}

function bind(){
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${b.dataset.view}`));if(b.dataset.view==='evidence')loadEvidence(false);if(b.dataset.view==='portfolio')renderPortfolio();if(b.dataset.view==='fundamentals')populateFundamentalTickers()});
  $('refreshBtn').onclick=refreshAll;$('recommendationFilter').onchange=renderRecs;$('decisionLogBtn').onclick=()=>window.open(`${API}?route=decision-log&format=csv&limit=50`,'_blank');
  $('marketSearch').oninput=renderMarket;$('marketScope').onchange=renderMarket;
  ['capitalInput','riskPctInput','maxWeightInput'].forEach(id=>$(id).oninput=()=>{renderPosition();renderPortfolio()});$('addPortfolioBtn').onclick=addPortfolio;
  $('clearPortfolioBtn').onclick=()=>{if(confirm('مسح كل المراكز التجريبية؟')){S.pf=[];save(K.portfolio,S.pf);renderPortfolio()}};
  $('portfolioRiskLimit').value=S.settings.portfolioRiskLimit;$('portfolioPositionLimit').value=S.settings.portfolioPositionLimit;$('strategyExposureLimit').value=S.settings.strategyExposureLimit;
  ['portfolioRiskLimit','portfolioPositionLimit','strategyExposureLimit'].forEach(id=>$(id).oninput=()=>{S.settings[id]=N($(id).value);save(K.settings,S.settings);renderPortfolio()});
  $('fundamentalTicker').onchange=loadFundForm;['revenueGrowth','profitGrowth','roe','debtEquity','pe','fairValue','positiveCfo','auditedData','fundamentalNotes'].forEach(id=>$(id).addEventListener('input',renderFundScore));$('saveFundamentalBtn').onclick=saveFund;
  $('evidenceRefreshBtn').onclick=()=>loadEvidence(true);$('evidenceCsvBtn').onclick=()=>window.open(`${API}?route=decision-log&format=csv&limit=50`,'_blank');
  setInterval(()=>{if(document.visibilityState==='visible')refreshAll()},300000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastRefreshAt>120000)refreshAll()});
}

bind();refreshAll();
