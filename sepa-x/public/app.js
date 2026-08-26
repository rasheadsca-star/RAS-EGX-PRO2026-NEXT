(()=>{
  const boot=()=>{
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const num=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
    const pct=v=>Number.isFinite(Number(v))?`${Number(v).toFixed(2)}%`:'—';
    const outcomeLabel=v=>v==='TARGET1'?'حقق T1':v==='STOP'?'ضرب الوقف':v==='TIME_EXIT'?'خروج زمني':String(v||'—');
    const outcomeTone=v=>v==='TARGET1'?'bt-good':v==='STOP'?'bt-bad':'bt-warn';

    if(!document.getElementById('sepaxBacktestInlineStyles')){
      const style=document.createElement('style');
      style.id='sepaxBacktestInlineStyles';
      style.textContent=`
        #backtestTradesPanel{border:1px solid #246789!important;box-shadow:0 0 0 1px rgba(77,182,255,.08),0 18px 50px rgba(0,0,0,.18)}
        .bt-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap}
        .bt-head h2{margin:0 0 6px}.bt-head p{margin:0;color:#91afc0;line-height:1.7}
        .bt-badge{display:inline-flex;align-items:center;padding:7px 11px;border-radius:999px;background:#123f32;color:#78f0b8;font-weight:800;font-size:12px}
        .bt-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:9px;margin:14px 0}
        .bt-summary>div{border:1px solid #1c4058;background:#081b29;border-radius:10px;padding:11px}.bt-summary small{display:block;color:#86a7ba;margin-bottom:5px}.bt-summary b{font-size:18px}
        .bt-tools{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.bt-tools input,.bt-tools select,.bt-tools button{border:1px solid #28506a;background:#071923;color:#eef7fb;border-radius:9px;padding:9px 11px}.bt-tools button{cursor:pointer;background:#123b54;font-weight:800}
        .bt-legend{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 12px;color:#95afbd;font-size:12px}.bt-entry{color:#55bdff!important}.bt-stop{color:#ff7181!important}.bt-target{color:#55e7a1!important}
        .bt-table-wrap{overflow:auto;border:1px solid #1c4058;border-radius:11px;background:#071923}.bt-table{width:100%;min-width:1140px;border-collapse:collapse}.bt-table th,.bt-table td{padding:11px 9px;border-bottom:1px solid #153448;text-align:right;white-space:nowrap}.bt-table th{position:sticky;top:0;background:#0c2a3d;z-index:1;color:#d7edf7}.bt-table td small{display:block;color:#829faf;margin-top:4px}.bt-table .price{font-size:16px;font-weight:900}.bt-pill{display:inline-block;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:900}.bt-good{background:#123f32;color:#78f0b8}.bt-bad{background:#4a1c26;color:#ff9dac}.bt-warn{background:#473b14;color:#ffe080}.bt-empty{padding:26px;text-align:center;color:#8facbd}
        #backtestQuickTab{border-color:#2a8dbd!important;color:#dff5ff!important;background:linear-gradient(180deg,#123b54,#0b293b)!important;font-weight:900!important}
      `;
      document.head.appendChild(style);
    }

    const evidence=document.getElementById('view-evidence');
    if(!evidence)return;

    if(!document.getElementById('backtestQuickTab')){
      const evidenceTab=document.querySelector('.tab[data-view="evidence"]');
      if(evidenceTab&&evidenceTab.parentElement){
        const quick=document.createElement('button');
        quick.id='backtestQuickTab';
        quick.className='tab';
        quick.type='button';
        quick.textContent='الدخول / الوقف / الأهداف';
        quick.addEventListener('click',()=>{
          evidenceTab.click();
          setTimeout(()=>document.getElementById('backtestTradesPanel')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
        });
        evidenceTab.parentElement.insertBefore(quick,evidenceTab);
      }
    }

    let panel=document.getElementById('backtestTradesPanel');
    if(!panel){
      panel=document.createElement('article');
      panel.id='backtestTradesPanel';
      panel.className='panel';
      panel.innerHTML=`
        <div class="bt-head">
          <div><h2>تفاصيل صفقات Backtest — الدخول والوقف والأهداف</h2><p>الأسعار الفعلية المستخدمة في المحاكاة التاريخية: Entry ثم Stop Loss ثم T1 / T2 / T3، مع نتيجة الصفقة وتاريخ الخروج.</p></div>
          <span class="bt-badge">POINT-IN-TIME • NO LOOK-AHEAD</span>
        </div>
        <div id="btInlineSummary" class="bt-summary"><div><small>الحالة</small><b>جارٍ التحميل…</b></div></div>
        <div class="bt-tools">
          <input id="btSymbolFilter" placeholder="فلتر بالسهم — مثال ETEL" autocomplete="off">
          <select id="btOutcomeFilter"><option value="ALL">كل النتائج</option><option value="TARGET1">حقق T1</option><option value="STOP">ضرب الوقف</option><option value="TIME_EXIT">خروج زمني</option></select>
          <button id="btRefreshBtn" type="button">تحديث الصفقات</button>
        </div>
        <div class="bt-legend"><span><b class="bt-entry">ENTRY</b> نقطة الدخول</span><span><b class="bt-stop">STOP</b> وقف الخسارة</span><span><b class="bt-target">T1 / T2 / T3</b> الأهداف</span></div>
        <div id="btInlineTable" class="bt-table-wrap"><div class="bt-empty">جارٍ تحميل تفاصيل الصفقات…</div></div>`;
      const grid=evidence.querySelector('.evidence-grid');
      if(grid)grid.insertAdjacentElement('afterend',panel);else evidence.prepend(panel);
    }

    let allTrades=[];
    let report=null;

    const render=()=>{
      const q=String(document.getElementById('btSymbolFilter')?.value||'').trim().toUpperCase();
      const outcome=String(document.getElementById('btOutcomeFilter')?.value||'ALL');
      let rows=allTrades;
      if(q)rows=rows.filter(t=>String(t.symbol||'').toUpperCase().includes(q));
      if(outcome!=='ALL')rows=rows.filter(t=>String(t.outcome||'')===outcome);
      const box=document.getElementById('btInlineTable');
      if(!box)return;
      if(!rows.length){box.innerHTML='<div class="bt-empty">لا توجد صفقات مطابقة للفلتر.</div>';return;}
      box.innerHTML=`<table class="bt-table"><thead><tr><th>الإشارة</th><th>السهم</th><th>ENTRY</th><th>STOP</th><th>T1</th><th>T2</th><th>T3</th><th>الخروج</th><th>النتيجة</th></tr></thead><tbody>${rows.map(t=>`<tr>
        <td><b>${esc(t.signalDate||'—')}</b><small>${esc(t.status||'')}</small></td>
        <td><b>${esc(t.symbol||'—')}</b><small>Rank #${esc(t.rank??'—')}</small></td>
        <td><b class="price bt-entry">${num(t.entryPrice)}</b><small>${esc(t.entryDate||'—')}</small></td>
        <td><b class="price bt-stop">${num(t.stopLoss)}</b><small>Risk ${pct(t.riskPct)}</small></td>
        <td><b class="price bt-target">${num(t.target1)}</b><small>${t.target1Hit?'✓ تحقق':''}</small></td>
        <td><b class="price bt-target">${num(t.target2)}</b><small>${t.target2Hit?'✓ تحقق':''}</small></td>
        <td><b class="price bt-target">${num(t.target3)}</b><small>${t.target3Hit?'✓ تحقق':''}</small></td>
        <td><span class="bt-pill ${outcomeTone(t.outcome)}">${esc(outcomeLabel(t.outcome))}</span><small>${esc(t.exitDate||'—')}</small></td>
        <td><b class="${Number(t.netPct)>=0?'bt-entry':'bt-stop'}">${pct(t.netPct)}</b><small>${num(t.netR)}R • ${esc(t.holdingSessions??'—')} جلسة</small></td>
      </tr>`).join('')}</tbody></table>`;
    };

    const loadTrades=async()=>{
      const box=document.getElementById('btInlineTable');
      if(box)box.innerHTML='<div class="bt-empty">جارٍ تحميل تفاصيل الصفقات…</div>';
      try{
        const r=await fetch('/backtest/trades',{cache:'no-store'});
        if(!r.ok)throw new Error(`HTTP ${r.status}`);
        report=await r.json();
        allTrades=Array.isArray(report.trades)?report.trades.filter(t=>t.entered===true):[];
        const s=report.summary||{};
        const summary=document.getElementById('btInlineSummary');
        if(summary)summary.innerHTML=`
          <div><small>الصفقات المنفذة</small><b>${esc(report.count??allTrades.length)}</b></div>
          <div><small>إيجابي</small><b>${pct(s.positivePct)}</b></div>
          <div><small>T1 Hit</small><b>${pct(s.target1HitPct)}</b></div>
          <div><small>Profit Factor</small><b>${num(s.profitFactor,3)}</b></div>
          <div><small>Expectancy</small><b>${num(s.expectancyR,3)}R</b></div>
          <div><small>Generated</small><b style="font-size:13px">${esc(String(report.generatedAt||'—').slice(0,10))}</b></div>`;
        render();
      }catch(e){
        if(box)box.innerHTML=`<div class="bt-empty">تعذر تحميل تفاصيل Backtest: ${esc(e.message)}</div>`;
      }
    };

    document.getElementById('btSymbolFilter')?.addEventListener('input',render);
    document.getElementById('btOutcomeFilter')?.addEventListener('change',render);
    document.getElementById('btRefreshBtn')?.addEventListener('click',loadTrades);
    loadTrades();
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
