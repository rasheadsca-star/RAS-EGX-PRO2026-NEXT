(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const n = value => { if (value === null || value === undefined || value === '') return null; const x = Number(value); return Number.isFinite(x) ? x : null; };
  const num = (value, d = 1) => n(value) === null ? '—' : n(value).toLocaleString('ar-EG', { maximumFractionDigits:d });
  const rr = value => n(value) === null ? '—' : n(value).toFixed(2);
  const pct = value => n(value) === null ? '—' : `${num(value,1)}%`;
  const tierAr = value => ({RESEARCH_A:'بحث A',RESEARCH_B:'بحث B',RESEARCH_C:'بحث C',RESEARCH_D:'بحث D'}[value] || value || '—');
  const alignAr = value => ({IN_ENTRY_RANGE:'داخل نطاق الدخول',BELOW_ENTRY_RANGE_WAITING:'أقل من نطاق الدخول — انتظار',ABOVE_ENTRY_RANGE_DO_NOT_CHASE:'أعلى نطاق الدخول — لا تطارد'}[value] || value || '—');
  const get = (row, key) => row?.[key] ?? row?.tradePlan?.[key] ?? row?.plan?.[key] ?? null;
  const json = async url => { const r = await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };

  function ensureCss(){
    if(document.querySelector('link[data-v20-native-research-css]')) return;
    const link=document.createElement('link'); link.rel='stylesheet'; link.href='./native-research.css'; link.dataset.v20NativeResearchCss='true'; document.head.appendChild(link);
  }
  function ensurePanel(){
    if(document.getElementById('nativeResearchPanel')) return document.getElementById('nativeResearchPanel');
    const anchor=document.querySelector('.opportunities-panel'); if(!anchor) return null;
    const panel=document.createElement('section'); panel.id='nativeResearchPanel'; panel.className='panel native-research-panel'; panel.setAttribute('aria-labelledby','nativeResearchTitle');
    panel.innerHTML=`
      <div class="native-header">
        <div>
          <span class="eyebrow">V20 Native — Full Market</span>
          <h2 id="nativeResearchTitle">ترشيحات السوق الكامل المستقلة</h2>
          <p>المحرك يبدأ من Master Universe بالكامل. Legacy لا يدخل في الدرجة؛ يظهر فقط كمرجع مقارنة. هذه ترشيحات بحثية وليست إذن تنفيذ.</p>
        </div>
        <div class="native-guard"><strong>Research Only</strong><span>Legacy contribution = 0%</span></div>
      </div>
      <div id="nativeResearchMetrics" class="native-metrics"></div>
      <div class="native-toolbar">
        <label><span>بحث Native</span><input id="nativeResearchSearch" type="search" placeholder="الكود أو الاسم…" autocomplete="off"></label>
        <label><span>الفئة</span><select id="nativeResearchTier"><option value="ALL">كل الفئات</option><option value="RESEARCH_A">بحث A</option><option value="RESEARCH_B">بحث B</option><option value="RESEARCH_C">بحث C</option><option value="RESEARCH_D">بحث D</option></select></label>
        <label><span>الترتيب</span><select id="nativeResearchSort"><option value="SCORE">V20 Score</option><option value="RR">Net R/R</option><option value="LIQUIDITY">السيولة</option><option value="SR">S/R</option><option value="TECHNICAL">الفني</option></select></label>
      </div>
      <div id="nativeResearchError" class="state-message hidden"></div>
      <div class="native-table-wrap table-wrap"><table><thead><tr><th>#</th><th>السهم</th><th>V20 Native</th><th>السيولة</th><th>S/R</th><th>فني</th><th>Net R/R</th><th>الدخول</th><th>وقف</th><th>هدف 1</th><th>المصدر</th></tr></thead><tbody id="nativeResearchRows"></tbody></table></div>
      <div id="nativeResearchCards" class="native-cards"></div>
      <div class="native-footnote">أي سهم هنا يظل SHADOW / RESEARCH ONLY. لا يفتح V17 Execution Gate، لا يخصص أموالًا، ولا يغيّر Champion.</div>`;
    anchor.parentNode.insertBefore(panel,anchor);
    const dialog=document.createElement('dialog'); dialog.id='nativeResearchDialog'; dialog.className='native-dialog'; dialog.innerHTML='<div class="native-dialog-head"><div><span class="eyebrow">V20 Native Research Candidate</span><h2 id="nativeResearchDialogTitle">—</h2></div><button id="nativeResearchDialogClose" type="button" aria-label="إغلاق">×</button></div><div id="nativeResearchDialogBody"></div>';
    document.body.appendChild(dialog);
    document.getElementById('nativeResearchDialogClose').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    return panel;
  }

  let nativeData=null, rows=[];
  function normalizeCandidates(native){
    const list=Array.isArray(native?.publishedCandidates)?native.publishedCandidates:Array.isArray(native?.top5)?native.top5:[];
    return list.map((row,i)=>({ ...row, rank:n(row.rank) ?? i+1, nativeResearchScore:n(row.nativeResearchScore), liquidity2Score:n(row.liquidity2Score), srConfluenceScore:n(row.srConfluenceScore), technicalScore:n(row.technicalScore), netRiskReward:n(get(row,'netRiskReward')), entryLow:n(get(row,'entryLow')), entryHigh:n(get(row,'entryHigh')), stop:n(get(row,'stop')), target1:n(get(row,'target1')), target2:n(get(row,'target2')), alignmentState:row.alignmentState ?? row.tradePlan?.alignment?.state ?? null }));
  }
  function renderMetrics(){
    const s=nativeData?.summary||{}; const box=document.getElementById('nativeResearchMetrics'); if(!box)return;
    const items=[['Universe',s.universeCount],['Technical Ready',s.trustedTechnicalReadyCount],['Multi-method S/R',s.srMultiMethodReadyCount],['اجتاز الجودة',s.nativeResearchRecommendationCount],['Top منشور',s.publishedResearchCandidateCount],['خارج Legacy',s.nativeResearchCandidatesOutsideLegacySeedCount]];
    box.innerHTML=items.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${num(value,0)}</strong></div>`).join('');
  }
  function filtered(){
    const q=(document.getElementById('nativeResearchSearch')?.value||'').trim().toLowerCase(); const tier=document.getElementById('nativeResearchTier')?.value||'ALL'; const sort=document.getElementById('nativeResearchSort')?.value||'SCORE';
    const out=rows.filter(row=>{const hay=`${row.ticker||''} ${row.nameAr||''} ${row.nameEn||''}`.toLowerCase();return(!q||hay.includes(q))&&(tier==='ALL'||row.nativeResearchTier===tier);});
    const key={SCORE:'nativeResearchScore',RR:'netRiskReward',LIQUIDITY:'liquidity2Score',SR:'srConfluenceScore',TECHNICAL:'technicalScore'}[sort]||'nativeResearchScore';
    return out.sort((a,b)=>(n(b[key])??-Infinity)-(n(a[key])??-Infinity)||String(a.ticker||'').localeCompare(String(b.ticker||''),'en'));
  }
  function sourceBadge(row){ return row.wasInLegacySeedUniverse===true?'<span class="native-source legacy-ref">Legacy ref</span>':'<span class="native-source native-new">Native جديد</span>'; }
  function render(){
    renderMetrics(); const tbody=document.getElementById('nativeResearchRows'),cards=document.getElementById('nativeResearchCards'); if(!tbody||!cards)return; tbody.innerHTML='';cards.innerHTML='';
    for(const row of filtered()){
      const tr=document.createElement('tr'); tr.tabIndex=0; tr.setAttribute('role','button'); tr.innerHTML=`<td>${num(row.rank,0)}</td><td class="symbol-cell"><strong>${esc(row.ticker)}</strong><small>${esc(row.nameAr||row.nameEn||'—')}</small></td><td><strong class="native-score">${num(row.nativeResearchScore,1)}</strong><small>${esc(tierAr(row.nativeResearchTier))}</small></td><td>${num(row.liquidity2Score,1)}</td><td>${num(row.srConfluenceScore,1)}<small>${num(row.srMethodCount,0)} طرق</small></td><td>${num(row.technicalScore,1)}</td><td class="rr-primary">${rr(row.netRiskReward)}</td><td>${num(row.entryLow,4)}–${num(row.entryHigh,4)}</td><td>${num(row.stop,4)}</td><td>${num(row.target1,4)}</td><td>${sourceBadge(row)}</td>`;
      tr.addEventListener('click',()=>openCandidate(row)); tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCandidate(row);}}); tbody.appendChild(tr);
      const card=document.createElement('button'); card.type='button'; card.className='native-card'; card.innerHTML=`<div class="native-card-head"><div class="symbol-cell"><strong>${esc(row.ticker)}</strong><small>${esc(row.nameAr||row.nameEn||'—')}</small></div>${sourceBadge(row)}</div><div class="native-card-score"><span>V20 Native</span><strong>${num(row.nativeResearchScore,1)}</strong><small>${esc(tierAr(row.nativeResearchTier))}</small></div><div class="native-card-grid"><div><span>سيولة</span><strong>${num(row.liquidity2Score,1)}</strong></div><div><span>S/R</span><strong>${num(row.srConfluenceScore,1)}</strong></div><div><span>Net R/R</span><strong>${rr(row.netRiskReward)}</strong></div><div><span>الدخول</span><strong>${num(row.entryLow,4)}–${num(row.entryHigh,4)}</strong></div></div>`; card.addEventListener('click',()=>openCandidate(row));cards.appendChild(card);
    }
  }
  function openCandidate(row){
    const d=document.getElementById('nativeResearchDialog'),title=document.getElementById('nativeResearchDialogTitle'),body=document.getElementById('nativeResearchDialogBody'); if(!d||!body)return; title.textContent=`${row.ticker} — ${row.nameAr||row.nameEn||''}`;
    const legacy=row.wasInLegacySeedUniverse===true?`كان موجودًا كمرجع Legacy؛ Baseline rank: ${num(row.baselineResearchRank,0)}`:'اكتشاف Native خارج قائمة Legacy الأصلية.';
    body.innerHTML=`<div class="native-dialog-guard"><strong>Research Score ≠ Execution Permission</strong><span>هذا الترشيح مستقل بحثيًا، لكن V17 ما زال سلطة التنفيذ وV16.9 ما زال Champion.</span></div><div class="native-detail-hero"><div><span>V20 Native Score</span><strong>${num(row.nativeResearchScore,1)}</strong><small>${esc(tierAr(row.nativeResearchTier))}</small></div><div><span>Discovery Score</span><strong>${num(row.discoveryScore,1)}</strong></div><div><span>Net R/R بعد التكلفة</span><strong>${rr(row.netRiskReward)}</strong></div><div><span>محاذاة السعر</span><strong>${esc(alignAr(row.alignmentState))}</strong></div></div><h3>الأدلة الرئيسية</h3><div class="native-detail-grid"><div><span>Liquidity 2.0</span><strong>${num(row.liquidity2Score,1)}</strong></div><div><span>S/R Confluence</span><strong>${num(row.srConfluenceScore,1)}</strong><small>${num(row.srMethodCount,0)} طرق</small></div><div><span>Technical</span><strong>${num(row.technicalScore,1)}</strong></div><div><span>Legacy contribution</span><strong>0%</strong></div></div><h3>خطة البحث المشتقة من الأدلة</h3><div class="native-detail-grid"><div><span>الدخول</span><strong>${num(row.entryLow,4)} – ${num(row.entryHigh,4)}</strong></div><div><span>وقف</span><strong>${num(row.stop,4)}</strong></div><div><span>هدف 1</span><strong>${num(row.target1,4)}</strong></div><div><span>هدف 2</span><strong>${num(row.target2,4)}</strong></div></div><div class="native-legacy-note">${esc(legacy)}</div>`;
    if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');
  }
  async function boot(){
    ensureCss(); const panel=ensurePanel(); if(!panel)return;
    try{
      const evidence=await json('../data/v20/market-explorer-regression.json'); const native=evidence?.fullMarketNative;
      if(!native||native.regressionOk!==true||native.legacySeedDependency!==false) throw new Error('Native full-market evidence is unavailable or not accepted');
      nativeData=native; rows=normalizeCandidates(native);
      if(rows.length===0) throw new Error('No persisted Native candidates');
      document.getElementById('nativeResearchSearch').addEventListener('input',render); document.getElementById('nativeResearchTier').addEventListener('change',render); document.getElementById('nativeResearchSort').addEventListener('change',render); render();
      panel.dataset.ready='true';
    }catch(error){const box=document.getElementById('nativeResearchError');if(box){box.classList.remove('hidden');box.textContent=`تعذر تحميل V20 Native: ${error.message}`;} panel.dataset.ready='false';}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
