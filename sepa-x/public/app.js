(()=>{
  const boot=()=>{
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const num=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
    const pct=v=>Number.isFinite(Number(v))?`${Number(v).toFixed(2)}%`:'—';
    const json=async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return r.json();};

    if(!document.getElementById('sepaxEnhancerStyles')){
      const style=document.createElement('style');
      style.id='sepaxEnhancerStyles';
      style.textContent=`
        .rec-plan-inline{margin:12px 0 10px;padding:12px;border:1px solid #24506b;border-radius:12px;background:linear-gradient(180deg,rgba(8,33,49,.96),rgba(6,27,41,.96));box-shadow:inset 0 0 0 1px rgba(76,182,255,.04)}
        .rec-plan-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;flex-wrap:wrap}.rec-plan-title b{font-size:13px;color:#e7f7ff}.rec-plan-title span{font-size:10px;font-weight:900;border-radius:999px;padding:4px 7px;background:#123b54;color:#bfe9ff}
        .rec-plan-grid{display:grid;grid-template-columns:repeat(5,minmax(72px,1fr));gap:6px}.rec-plan-cell{min-width:0;padding:8px 7px;border:1px solid #173d55;border-radius:9px;background:#071923;text-align:center}.rec-plan-cell small{display:block;color:#86a8ba;font-size:9px;font-weight:800;letter-spacing:.4px;margin-bottom:4px}.rec-plan-cell b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rec-plan-entry b{color:#55bdff}.rec-plan-stop b{color:#ff7181}.rec-plan-target b{color:#55e7a1}
        .rec-plan-entry-zone{margin:0 0 7px;padding:8px 9px;border-radius:9px;background:#0a2232;border:1px solid #1e4a64;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}.rec-plan-entry-zone span{font-size:10px;color:#8eafc0;font-weight:800}.rec-plan-entry-zone b{color:#55bdff;font-size:16px}.rec-plan-entry-zone em{font-size:10px;color:#9bb4c2;font-style:normal}
        .rec-plan-foot{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:8px;color:#91acbb;font-size:10px;line-height:1.5}.rec-plan-foot strong{color:#e4f5fc}.rec-plan-note{margin-top:8px;padding:7px 9px;border-radius:8px;font-size:10px;font-weight:800;line-height:1.55}.rec-plan-note.ok{background:#113c30;color:#79eeb9}.rec-plan-note.warn{background:#463b17;color:#ffe180}.rec-plan-note.bad{background:#451c26;color:#ff9dad}.rec-plan-missing{padding:10px;border:1px dashed #315268;border-radius:9px;color:#91acbb;font-size:11px;text-align:center}
        @media(max-width:720px){.rec-plan-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.rec-plan-grid .rec-plan-target:last-child{grid-column:span 2}.rec-plan-entry-zone b{font-size:15px}}

        #backtestTradesPanel{border:1px solid #246789!important;box-shadow:0 0 0 1px rgba(77,182,255,.08),0 18px 50px rgba(0,0,0,.18)}
        .bt-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap}.bt-head h2{margin:0 0 6px}.bt-head p{margin:0;color:#91afc0;line-height:1.7}.bt-badge{display:inline-flex;align-items:center;padding:7px 11px;border-radius:999px;background:#123f32;color:#78f0b8;font-weight:800;font-size:12px}
        .bt-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:9px;margin:14px 0}.bt-summary>div{border:1px solid #1c4058;background:#081b29;border-radius:10px;padding:11px}.bt-summary small{display:block;color:#86a7ba;margin-bottom:5px}.bt-summary b{font-size:18px}.bt-tools{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.bt-tools input,.bt-tools select,.bt-tools button{border:1px solid #28506a;background:#071923;color:#eef7fb;border-radius:9px;padding:9px 11px}.bt-tools button{cursor:pointer;background:#123b54;font-weight:800}.bt-legend{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 12px;color:#95afbd;font-size:12px}.bt-entry{color:#55bdff!important}.bt-stop{color:#ff7181!important}.bt-target{color:#55e7a1!important}.bt-table-wrap{overflow:auto;border:1px solid #1c4058;border-radius:11px;background:#071923}.bt-table{width:100%;min-width:1140px;border-collapse:collapse}.bt-table th,.bt-table td{padding:11px 9px;border-bottom:1px solid #153448;text-align:right;white-space:nowrap}.bt-table th{position:sticky;top:0;background:#0c2a3d;z-index:1;color:#d7edf7}.bt-table td small{display:block;color:#829faf;margin-top:4px}.bt-table .price{font-size:16px;font-weight:900}.bt-pill{display:inline-block;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:900}.bt-good{background:#123f32;color:#78f0b8}.bt-bad{background:#4a1c26;color:#ff9dac}.bt-warn{background:#473b14;color:#ffe080}.bt-empty{padding:26px;text-align:center;color:#8facbd}#backtestQuickTab{border-color:#2a8dbd!important;color:#dff5ff!important;background:linear-gradient(180deg,#123b54,#0b293b)!important;font-weight:900!important}
      `;
      document.head.appendChild(style);
    }

    const parseEntryBounds=row=>{
      const z=row?.entry_zone;
      if(Array.isArray(z)){
        const vals=z.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
        if(vals.length)return {low:vals[0],high:vals.at(-1)};
      }
      if(z&&typeof z==='object'){
        const lo=Number(z.low??z.from??z.min),hi=Number(z.high??z.to??z.max);
        if(Number.isFinite(lo)||Number.isFinite(hi))return {low:Number.isFinite(lo)?lo:hi,high:Number.isFinite(hi)?hi:lo};
      }
      const p=Number(row?.pivot),last=Number(row?.last_price),ref=Number.isFinite(p)?p:last;
      return Number.isFinite(ref)?{low:ref,high:ref}:null;
    };

    const buildPlan=row=>{
      if(row?.target_plan?.valid){
        const p=row.target_plan;
        return {valid:true,entryLow:Number(p.entryLow),entryHigh:Number(p.entryHigh),referenceEntry:Number(p.referenceEntry),stopLoss:Number(p.stopLoss),riskPct:Number(p.riskPct),targets:Array.isArray(p.targets)?p.targets:[]};
      }
      const bounds=parseEntryBounds(row),stop=Number(row?.stop_loss);
      if(!bounds||!Number.isFinite(stop))return {valid:false};
      const entry=Number(bounds.high),risk=entry-stop;
      if(!(entry>0&&risk>0))return {valid:false};
      return {valid:true,entryLow:bounds.low,entryHigh:bounds.high,referenceEntry:entry,stopLoss:stop,riskPct:risk/entry*100,targets:[2,3,4].map((r,i)=>({id:`T${i+1}`,r,price:entry+r*risk}))};
    };

    const recommendationRows=new Map();
    const putRows=(rows,bucket)=>{
      for(const row of Array.isArray(rows)?rows:[]){
        if(!row?.symbol)continue;
        const key=String(row.symbol).toUpperCase();
        if(!recommendationRows.has(key))recommendationRows.set(key,{...row,__bucket:bucket});
      }
    };

    const planNote=row=>{
      const review=Boolean(row?.review_required||row?.review_reason==='CORPORATE_ACTION_REVIEW_REQUIRED');
      if(review)return {tone:'warn',text:'REVIEW REQUIRED — المستويات ظاهرة للمتابعة فقط، والتنفيذ معطل حتى مراجعة Corporate Action.'};
      if(row?.__bucket==='top'&&row?.execution_allowed!==false)return {tone:'ok',text:'خطة التوصية: الدخول داخل المنطقة المحددة فقط مع الالتزام بالوقف والأهداف.'};
      if(['READY NOW','BREAKOUT CONFIRMED','NEAR PIVOT'].includes(String(row?.status||'')))return {tone:'warn',text:'خطة متابعة سعرية — لا تعتبر دخولًا معتمدًا إلا بعد اجتياز جميع بوابات SEPA‑X.'};
      return {tone:'bad',text:'مستويات مرجعية فقط — الحالة الحالية ليست توصية دخول.'};
    };

    const decorateCard=card=>{
      const symbol=String(card?.dataset?.symbol||'').toUpperCase();
      if(!symbol)return;
      const row=recommendationRows.get(symbol);
      if(!row)return;
      if(card.querySelector('.rec-plan-inline'))return;
      const plan=buildPlan(row);
      const wrap=document.createElement('div');
      wrap.className='rec-plan-inline';
      if(!plan.valid){
        wrap.innerHTML='<div class="rec-plan-missing">لا توجد خطة سعرية مكتملة لهذا السهم حاليًا.</div>';
      }else{
        const targets=[0,1,2].map(i=>plan.targets?.[i]||null);
        const zone=Math.abs(Number(plan.entryHigh)-Number(plan.entryLow))<0.000001?num(plan.entryHigh):`${num(plan.entryLow)} – ${num(plan.entryHigh)}`;
        const note=planNote(row);
        wrap.innerHTML=`
          <div class="rec-plan-title"><b>خطة الصفقة السعرية</b><span>ENTRY • STOP • T1 • T2 • T3</span></div>
          <div class="rec-plan-entry-zone"><span>ENTRY ZONE</span><b>${esc(zone)}</b><em>مرجع الحساب ${num(plan.referenceEntry)}</em></div>
          <div class="rec-plan-grid">
            <div class="rec-plan-cell rec-plan-entry"><small>ENTRY REF</small><b>${num(plan.referenceEntry)}</b></div>
            <div class="rec-plan-cell rec-plan-stop"><small>STOP LOSS</small><b>${num(plan.stopLoss)}</b></div>
            <div class="rec-plan-cell rec-plan-target"><small>T1 • ${esc(targets[0]?.r??2)}R</small><b>${num(targets[0]?.price)}</b></div>
            <div class="rec-plan-cell rec-plan-target"><small>T2 • ${esc(targets[1]?.r??3)}R</small><b>${num(targets[1]?.price)}</b></div>
            <div class="rec-plan-cell rec-plan-target"><small>T3 • ${esc(targets[2]?.r??4)}R</small><b>${num(targets[2]?.price)}</b></div>
          </div>
          <div class="rec-plan-foot"><span>Initial Risk <strong>${pct(Number.isFinite(Number(row?.risk_pct))?row.risk_pct:plan.riskPct)}</strong></span><span>Engine R:R <strong>${Number.isFinite(Number(row?.reward_risk))?`${num(row.reward_risk)}R`:'—'}</strong></span></div>
          <div class="rec-plan-note ${note.tone}">${esc(note.text)}</div>`;
      }
      const verdict=card.querySelector('.rec-verdict');
      if(verdict)card.insertBefore(wrap,verdict);else card.appendChild(wrap);
    };

    const decorateRecommendations=()=>document.querySelectorAll('.rec-card[data-symbol]').forEach(decorateCard);
    const installRecommendationPlans=async()=>{
      try{
        const [top,review,near,forming,extended,nearMiss]=await Promise.all([
          json('/opportunities/top').catch(()=>[]),json('/opportunities/review').catch(()=>[]),json('/opportunities/near').catch(()=>[]),json('/opportunities/forming').catch(()=>[]),json('/opportunities/extended').catch(()=>[]),json('/opportunities/near-miss').catch(()=>[])
        ]);
        recommendationRows.clear();
        putRows(top,'top');putRows(review,'review');putRows(near,'near');putRows(forming,'forming');putRows(extended,'extended');putRows(nearMiss,'near_miss');
        decorateRecommendations();
        const grid=document.getElementById('recommendationGrid');
        if(grid&&!grid.__sepaxPlanObserver){
          const obs=new MutationObserver(()=>decorateRecommendations());
          obs.observe(grid,{childList:true,subtree:true});
          grid.__sepaxPlanObserver=obs;
        }
      }catch(e){console.error('SEPA-X recommendation plan enhancer failed',e);}
    };

    const installBacktest=()=>{
      const evidence=document.getElementById('view-evidence');
      if(!evidence)return;
      const evidenceTab=document.querySelector('.tab[data-view="evidence"]');
      if(!document.getElementById('backtestQuickTab')&&evidenceTab?.parentElement){
        const quick=document.createElement('button');quick.id='backtestQuickTab';quick.className='tab';quick.type='button';quick.textContent='Backtest — الصفقات التاريخية';
        quick.addEventListener('click',()=>{evidenceTab.click();setTimeout(()=>document.getElementById('backtestTradesPanel')?.scrollIntoView({behavior:'smooth',block:'start'}),80)});
        evidenceTab.parentElement.insertBefore(quick,evidenceTab);
      }
      let panel=document.getElementById('backtestTradesPanel');
      if(!panel){
        panel=document.createElement('article');panel.id='backtestTradesPanel';panel.className='panel';panel.innerHTML=`
          <div class="bt-head"><div><h2>Backtest — تفاصيل الصفقات التاريخية</h2><p>هذا القسم تاريخي فقط. تفاصيل التوصيات الحالية أصبحت ظاهرة مباشرة داخل كروت التوصيات في لوحة القرار.</p></div><span class="bt-badge">POINT-IN-TIME • NO LOOK-AHEAD</span></div>
          <div id="btInlineSummary" class="bt-summary"><div><small>الحالة</small><b>جارٍ التحميل…</b></div></div>
          <div class="bt-tools"><input id="btSymbolFilter" placeholder="فلتر بالسهم — مثال ETEL" autocomplete="off"><select id="btOutcomeFilter"><option value="ALL">كل النتائج</option><option value="TARGET1">حقق T1</option><option value="STOP">ضرب الوقف</option><option value="TIME_EXIT">خروج زمني</option></select><button id="btRefreshBtn" type="button">تحديث الصفقات</button></div>
          <div class="bt-legend"><span><b class="bt-entry">ENTRY</b> نقطة الدخول</span><span><b class="bt-stop">STOP</b> وقف الخسارة</span><span><b class="bt-target">T1 / T2 / T3</b> الأهداف</span></div><div id="btInlineTable" class="bt-table-wrap"><div class="bt-empty">جارٍ تحميل تفاصيل الصفقات…</div></div>`;
        const grid=evidence.querySelector('.evidence-grid');if(grid)grid.insertAdjacentElement('afterend',panel);else evidence.prepend(panel);
      }
      let allTrades=[];
      const outcomeLabel=v=>v==='TARGET1'?'حقق T1':v==='STOP'?'ضرب الوقف':v==='TIME_EXIT'?'خروج زمني':String(v||'—');
      const outcomeTone=v=>v==='TARGET1'?'bt-good':v==='STOP'?'bt-bad':'bt-warn';
      const render=()=>{
        const q=String(document.getElementById('btSymbolFilter')?.value||'').trim().toUpperCase(),outcome=String(document.getElementById('btOutcomeFilter')?.value||'ALL');
        let rows=allTrades;if(q)rows=rows.filter(t=>String(t.symbol||'').toUpperCase().includes(q));if(outcome!=='ALL')rows=rows.filter(t=>String(t.outcome||'')===outcome);
        const box=document.getElementById('btInlineTable');if(!box)return;if(!rows.length){box.innerHTML='<div class="bt-empty">لا توجد صفقات مطابقة للفلتر.</div>';return;}
        box.innerHTML=`<table class="bt-table"><thead><tr><th>الإشارة</th><th>السهم</th><th>ENTRY</th><th>STOP</th><th>T1</th><th>T2</th><th>T3</th><th>الخروج</th><th>النتيجة</th></tr></thead><tbody>${rows.map(t=>`<tr><td><b>${esc(t.signalDate||'—')}</b><small>${esc(t.status||'')}</small></td><td><b>${esc(t.symbol||'—')}</b><small>Rank #${esc(t.rank??'—')}</small></td><td><b class="price bt-entry">${num(t.entryPrice)}</b><small>${esc(t.entryDate||'—')}</small></td><td><b class="price bt-stop">${num(t.stopLoss)}</b><small>Risk ${pct(t.riskPct)}</small></td><td><b class="price bt-target">${num(t.target1)}</b><small>${t.target1Hit?'✓ تحقق':''}</small></td><td><b class="price bt-target">${num(t.target2)}</b><small>${t.target2Hit?'✓ تحقق':''}</small></td><td><b class="price bt-target">${num(t.target3)}</b><small>${t.target3Hit?'✓ تحقق':''}</small></td><td><span class="bt-pill ${outcomeTone(t.outcome)}">${esc(outcomeLabel(t.outcome))}</span><small>${esc(t.exitDate||'—')}</small></td><td><b class="${Number(t.netPct)>=0?'bt-entry':'bt-stop'}">${pct(t.netPct)}</b><small>${num(t.netR)}R • ${esc(t.holdingSessions??'—')} جلسة</small></td></tr>`).join('')}</tbody></table>`;
      };
      const loadTrades=async()=>{
        const box=document.getElementById('btInlineTable');if(box)box.innerHTML='<div class="bt-empty">جارٍ تحميل تفاصيل الصفقات…</div>';
        try{const report=await json('/backtest/trades');allTrades=Array.isArray(report.trades)?report.trades.filter(t=>t.entered===true):[];const s=report.summary||{},summary=document.getElementById('btInlineSummary');if(summary)summary.innerHTML=`<div><small>الصفقات المنفذة</small><b>${esc(report.count??allTrades.length)}</b></div><div><small>إيجابي</small><b>${pct(s.positivePct)}</b></div><div><small>T1 Hit</small><b>${pct(s.target1HitPct)}</b></div><div><small>Profit Factor</small><b>${num(s.profitFactor,3)}</b></div><div><small>Expectancy</small><b>${num(s.expectancyR,3)}R</b></div>`;render()}catch(e){if(box)box.innerHTML=`<div class="bt-empty">تعذر تحميل تفاصيل Backtest: ${esc(e.message)}</div>`}
      };
      document.getElementById('btSymbolFilter')?.addEventListener('input',render);document.getElementById('btOutcomeFilter')?.addEventListener('change',render);document.getElementById('btRefreshBtn')?.addEventListener('click',loadTrades);loadTrades();
    };

    installRecommendationPlans();
    installBacktest();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
