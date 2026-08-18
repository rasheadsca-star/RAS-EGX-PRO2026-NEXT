(()=>{
  'use strict';
  if(window.__MAIN_APP_INDEPENDENT_CONSENSUS_EVIDENCE__)return;
  window.__MAIN_APP_INDEPENDENT_CONSENSUS_EVIDENCE__=true;
  const URL=new URL('../../data/stable/v16-main-app-engine-performance.json',location.href).href;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=v=>Number.isFinite(Number(v))?`${Number(v).toFixed(1)}%`:'—';
  const signed=v=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${Number(v).toFixed(1)} نقطة`:'—';
  const style=document.createElement('style');
  style.textContent=`
    #mainAppIndependentConsensusEvidence{margin:0 0 14px;padding:13px 14px;border:1px solid #375b70;border-radius:14px;background:#0a1d2a;color:#d9eef8;text-align:right;display:grid;gap:10px}
    .ma-ice-head{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}.ma-ice-head b{font-size:16px;color:#fff}.ma-ice-badge{font-size:11px;font-weight:900;padding:5px 9px;border-radius:999px;border:1px solid #7c6330;background:#332913;color:#ffe2a0}.ma-ice-badge.pass{border-color:#378063;background:#12382a;color:#c8ffe6}
    .ma-ice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ma-ice-group{border:1px solid #294d61;border-radius:11px;padding:10px;background:#0d2736;display:grid;gap:7px}.ma-ice-group.confirmed{border-color:#34745b}.ma-ice-group h4{margin:0;color:#f2fbff;font-size:13px}.ma-ice-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;direction:ltr}.ma-ice-metric{padding:7px 4px;border-radius:8px;background:#071a25;text-align:center}.ma-ice-metric b{display:block;color:#fff;font-size:15px}.ma-ice-metric small{display:block;font-size:9px;color:#9db6c2;direction:rtl;margin-top:2px}.ma-ice-target b{color:#88f0c3}.ma-ice-stop b{color:#ff9eaa}
    .ma-ice-deltas{display:flex;gap:7px;flex-wrap:wrap}.ma-ice-chip{font-size:11px;padding:5px 8px;border-radius:999px;background:#102c3c;border:1px solid #31566b;color:#d7eef9}.ma-ice-foot{font-size:11px;line-height:1.55;color:#9cb6c3;border-top:1px dashed #345166;padding-top:8px}
    @media(max-width:620px){.ma-ice-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  function group(label,g,confirmed=false){
    if(!g)return '';
    return `<div class="ma-ice-group${confirmed?' confirmed':''}"><h4>${esc(label)}</h4><div class="ma-ice-metrics"><div class="ma-ice-metric ma-ice-target"><b>${pct(g.conservativeTargetHitRatePct)}</b><small>هدف محافظ</small></div><div class="ma-ice-metric ma-ice-stop"><b>${pct(g.stopTouchRatePct)}</b><small>ضرب الوقف</small></div><div class="ma-ice-metric"><b>${Number(g.executableCount||0)}</b><small>قابل للتنفيذ</small></div></div></div>`;
  }
  function render(data){
    const e=data?.independentConsensusEvidence;if(!e?.available)return;
    const gate=e.bonusEvidenceGate||{},d=e.deltasAgreementMinusV16Only||{};
    let box=document.getElementById('mainAppIndependentConsensusEvidence');
    if(!box){box=document.createElement('div');box.id='mainAppIndependentConsensusEvidence';}
    const sig=JSON.stringify({g:e.generatedAt,pass:gate.evidenceSupportsBonus,a:e.agreed,b:e.v16Only,d});
    if(box.dataset.signature!==sig){
      box.dataset.signature=sig;
      const pass=gate.evidenceSupportsBonus===true;
      const badge=pass?`الدليل يدعم مراجعة Bonus ${Number(gate.suggestedBonusPct||0).toFixed(1)}%`:'Bonus غير مُفعّل';
      box.innerHTML=`<div class="ma-ice-head"><b>قيمة التوافق المستقل V16.9 + V19</b><span class="ma-ice-badge${pass?' pass':''}">${esc(badge)}</span></div><div class="ma-ice-grid">${group('اختيارات V16 المؤكدة أيضًا من V19',e.agreed,true)}${group('اختيارات V16 فقط',e.v16Only,false)}</div><div class="ma-ice-deltas"><span class="ma-ice-chip">فرق الهدف ${esc(signed(d.targetRatePct))}</span><span class="ma-ice-chip">فرق الوقف ${esc(signed(d.stopRatePct))}</span><span class="ma-ice-chip">فرق Target−Stop ${esc(signed(d.targetMinusStopEdgePct))}</span></div><div class="ma-ice-foot">${esc(gate.noteAr||'التوافق هنا بين منهجين مستقلين تشخيصيًا. لا يتم تعديل ترتيب MAIN APP أو الأوزان تلقائيًا من هذا المؤشر.')}</div>`;
    }
    const perf=document.getElementById('mainAppEnginePerformance');
    if(perf&&perf.nextElementSibling!==box)perf.insertAdjacentElement('afterend',box);
  }
  async function refresh(){try{const r=await fetch(`${URL}?t=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw Error(`HTTP ${r.status}`);render(await r.json());}catch(e){console.warn('Independent consensus evidence unavailable:',e.message||e)}}
  function init(){refresh();setInterval(refresh,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
