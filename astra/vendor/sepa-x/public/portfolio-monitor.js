(()=>{
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=v=>Number.isFinite(Number(v));
  const num=(v,d=2)=>finite(v)?Number(v).toFixed(d):'—';
  const pct=v=>finite(v)?`${Number(v).toFixed(1)}%`:'—';
  const money=v=>finite(v)?Number(v).toLocaleString('en-US',{maximumFractionDigits:2}):'—';
  const loadPositions=()=>{try{return JSON.parse(localStorage.getItem('sepax_portfolio')||'[]')}catch{return[]}};
  const savePositions=rows=>localStorage.setItem('sepax_portfolio',JSON.stringify(rows));
  const verdictClass=s=>s==='THREE_WAY_CONFLUENCE'?'good':s==='CORE_RC2_CONFLUENCE'||s==='CORE_V3_SHADOW'?'warn':s==='RISK_REVIEW'?'bad':'neutral';
  let refreshTimer=null,lastPayload=null;

  function ensurePanel(){
    const view=$('#view-portfolio');if(!view||$('#portfolioIntelligence'))return;
    const panel=document.createElement('article');panel.id='portfolioIntelligence';panel.className='panel pi-panel';
    panel.innerHTML=`
      <div class="panel-head split"><div><h2>Portfolio Intelligence — Core + RC2 + V3</h2><p>متابعة المراكز الحالية: SEPA-X للتحليل، RC2 كمرجع Precision read-only، وV3 Shadow للبحث فقط.</p></div><button class="btn" id="piRefresh">تحديث التحليل</button></div>
      <div class="engine-note pi-lock">Research Only • لا أوامر تلقائية • RC2 قراءة مرجعية فقط • V3 لا يؤثر على Eligibility</div>
      <form id="piPositionForm" class="pi-form">
        <label>السهم<input id="piSymbol" maxlength="12" placeholder="مثال COMI" required></label>
        <label>متوسط الشراء<input id="piEntry" type="number" min="0.0001" step="0.0001" required></label>
        <label>الكمية<input id="piQty" type="number" min="1" step="1" required></label>
        <button class="btn primary" type="submit">إضافة / تحديث مركز</button>
      </form>
      <div id="piStatus" class="pi-status">جاهز لتحليل المحفظة.</div>
      <div id="piSummary" class="pi-summary"></div>
      <div id="piCards" class="pi-grid"></div>`;
    view.appendChild(panel);
    $('#piRefresh').addEventListener('click',()=>refresh(true));
    $('#piPositionForm').addEventListener('submit',e=>{
      e.preventDefault();const symbol=$('#piSymbol').value.trim().toUpperCase(),entry=Number($('#piEntry').value),qty=Math.floor(Number($('#piQty').value));
      if(!/^[A-Z0-9._-]{2,12}$/.test(symbol)||!(entry>0)||!(qty>0))return;
      const rows=loadPositions(),prev=rows.find(x=>String(x.symbol).toUpperCase()===symbol);
      const next={...(prev||{}),symbol,name:prev?.name||symbol,status:prev?.status||'MANUAL',entry,qty,stop:finite(prev?.stop)?Number(prev.stop):null,rr:finite(prev?.rr)?Number(prev.rr):null,addedAt:prev?.addedAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
      const out=rows.filter(x=>String(x.symbol).toUpperCase()!==symbol);out.push(next);savePositions(out);location.reload();
    });
  }

  function metric(label,value,cls=''){return `<div class="pi-metric"><small>${esc(label)}</small><b class="${cls}">${esc(value)}</b></div>`}
  function planRow(label,value,cls=''){return `<div class="pi-row"><span>${esc(label)}</span><b class="${cls}">${esc(value)}</b></div>`}

  function syncLegacyPosition(pos,row){
    const c=row?.core;if(!c)return pos;
    return {...pos,name:c.name||pos.name,status:c.status||pos.status,stop:finite(c.stop_loss)?Number(c.stop_loss):pos.stop,rr:finite(c.reward_risk)?Number(c.reward_risk):pos.rr,lastSeenPrice:finite(c.last_price)?Number(c.last_price):pos.lastSeenPrice,lastSyncedAt:new Date().toISOString()};
  }

  function renderCard(pos,row){
    const c=row?.core||{},r=row?.rc2||null,v=row?.v3||null,f=row?.forwardSignal||null,read=row?.readout||{};
    const current=finite(c.last_price)?Number(c.last_price):finite(r?.price)?Number(r.price):null;
    const pnl=finite(current)&&finite(pos.entry)&&Number(pos.entry)>0?(current/Number(pos.entry)-1)*100:null;
    const value=finite(current)?current*Number(pos.qty||0):null;
    const pnlCls=finite(pnl)?(pnl>=0?'pi-good':'pi-bad'):'';
    const tt=c.trend_template||{},mech=v?.raw?.mechanics||{},vp=v?.raw?.plan||{},rp=r?.tradePlan||{};
    const rc2State=r?(r.publicationEligible?'ELIGIBLE':'NO RECOMMENDATION'):'UNAVAILABLE';
    const v3State=v?.pass?'MATCH — SHADOW ONLY':'NO MATCH';
    const forward=f?.state||'—';
    return `<article class="pi-card">
      <div class="pi-card-head"><div><h3>${esc(pos.symbol)}</h3><p>${esc(c.name||pos.name||'')}</p></div><span class="tag ${verdictClass(read.state)}">${esc(read.labelAr||'مراجعة')}</span></div>
      <div class="pi-price-strip">${metric('متوسط الشراء',num(pos.entry,2))}${metric('السعر الحالي',num(current,2))}${metric('P/L',pct(pnl),pnlCls)}${metric('القيمة الحالية',money(value))}</div>
      <div class="pi-three">
        <section class="pi-engine core"><h4>SEPA-X Core</h4>${planRow('الحالة',c.status||'—')}${planRow('الإجراء',c.action||'—')}${planRow('Score',num(c.final_score,1))}${planRow('RS Percentile',num(c.rs_percentile,1))}${planRow('Trend Template',tt.passed?'PASS':'FAIL',tt.passed?'pi-good':'pi-bad')}${planRow('Pivot',num(c.pivot,2))}${planRow('Core Stop',num(c.stop_loss,2),'pi-bad')}${planRow('R:R',finite(c.reward_risk)?`${num(c.reward_risk,2)}R`:'—')}</section>
        <section class="pi-engine rc2"><h4>RC2 Precision <em>Read-only</em></h4>${row?.rc2Error?`<div class="pi-error">${esc(row.rc2Error)}</div>`:planRow('الحالة',rc2State,r?.publicationEligible?'pi-good':'')}${planRow('Decision',r?.decision||'—')}${planRow('Fusion Rank',num(r?.scores?.fusionRank,1))}${planRow('Wilson',pct(r?.historicalConfidence?.wilson95LowerPct))}${planRow('Entry Zone',finite(rp.entryLow)&&finite(rp.entryHigh)?`${num(rp.entryLow,2)} – ${num(rp.entryHigh,2)}`:'—')}${planRow('Stop',num(rp.stop,2),'pi-bad')}${planRow('P1 ~0.8R',num(rp.target1,2),'pi-good')}${planRow('Structural Target',num(rp.target2,2),'pi-good')}${planRow('Alignment',rp.alignmentState||'—')}</section>
        <section class="pi-engine v3"><h4>FULL_STRUCTURE V3 <em>Shadow</em></h4>${planRow('Signal',v3State,v?.pass?'pi-good':'')}${planRow('Shadow Score',num(v?.score,1))}${planRow('Forward State',forward)}${planRow('Breakout Vol',finite(mech.breakoutVolumeRatio)?`${num(mech.breakoutVolumeRatio,2)}x`:'—')}${planRow('Retest Vol/Breakout',finite(mech.retestVolumeVsBreakout)?`${num(mech.retestVolumeVsBreakout,2)}x`:'—')}${planRow('Retest Depth',finite(mech.retestDepthAtr)?`${num(mech.retestDepthAtr,2)} ATR`:'—')}${planRow('Touches',num(mech.touches,0))}${planRow('V3 Stop',num(vp.stopLoss,2),'pi-bad')}${planRow('V3 P1',num(vp.precisionTarget?.price,2),'pi-good')}</section>
      </div>
      <div class="pi-footer"><span>السعر المرجعي: ${num(read.currentPrice,2)}</span><span>Core Stop break: ${read.checks?.belowCoreStop?'YES':'NO'}</span><span>RC2 execution: BLOCKED</span><span>V3 promotion: BLOCKED</span></div>
    </article>`;
  }

  function render(payload){
    lastPayload=payload;const positions=loadPositions(),bySymbol=new Map((payload?.rows||[]).map(x=>[String(x.symbol).toUpperCase(),x]));
    const synced=positions.map(p=>syncLegacyPosition(p,bySymbol.get(String(p.symbol).toUpperCase())));savePositions(synced);
    let total=0,cost=0,positive=0,riskReview=0,confluence=0;
    for(const p of synced){const row=bySymbol.get(String(p.symbol).toUpperCase()),current=row?.readout?.currentPrice;if(finite(current)){total+=Number(current)*Number(p.qty||0);cost+=Number(p.entry||0)*Number(p.qty||0);if(Number(current)>=Number(p.entry||0))positive++;}if(row?.readout?.state==='RISK_REVIEW')riskReview++;if(row?.readout?.state==='THREE_WAY_CONFLUENCE')confluence++;}
    const pnlPct=cost>0?(total/cost-1)*100:null;
    $('#piSummary').innerHTML=[metric('المراكز',synced.length),metric('القيمة الحالية',money(total)),metric('P/L المحفظة',pct(pnlPct),finite(pnlPct)?(pnlPct>=0?'pi-good':'pi-bad'):''),metric('مراكز رابحة',positive),metric('Risk Review',riskReview,riskReview?'pi-bad':''),metric('3-Way Confluence',confluence,confluence?'pi-good':'')].join('');
    $('#piCards').innerHTML=synced.length?synced.map(p=>renderCard(p,bySymbol.get(String(p.symbol).toUpperCase()))).join(''):'<div class="empty">أضف مراكزك الحالية من النموذج أعلاه، أو أضف سهمًا من لوحة القرار.</div>';
    $('#piStatus').textContent=`آخر تحليل: ${new Date(payload.generatedAt).toLocaleString('ar-EG')} • SEPA-X ${payload.sepaX?.source||'—'} • RC2 read-only`;
  }

  async function refresh(force=false){
    ensurePanel();const rows=loadPositions(),symbols=[...new Set(rows.map(x=>String(x.symbol||'').trim().toUpperCase()).filter(Boolean))];
    if(!symbols.length){render({generatedAt:new Date().toISOString(),rows:[],sepaX:{source:'—'}});return;}
    const status=$('#piStatus');status.textContent='جارٍ تحديث SEPA-X + RC2 + V3…';
    try{const r=await fetch(`/portfolio/intelligence?symbols=${encodeURIComponent(symbols.join(','))}${force?'&force=1':''}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);render(await r.json());}
    catch(error){status.textContent=`تعذر تحديث Portfolio Intelligence: ${error.message}`;if(lastPayload)render(lastPayload);}
  }

  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh(false),180)}
  document.addEventListener('DOMContentLoaded',()=>{
    ensurePanel();
    document.querySelector('[data-view="portfolio"]')?.addEventListener('click',schedule);
    const body=$('#portfolioRows');if(body)new MutationObserver(schedule).observe(body,{childList:true,subtree:true});
    if(location.hash==='#portfolio')refresh(false);
  });
})();
