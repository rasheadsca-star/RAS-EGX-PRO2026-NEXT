(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const load=async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return r.json()};
  const num=(v,d=1)=>v===null||v===undefined||v===''?'—':Number(v).toLocaleString('ar-EG',{maximumFractionDigits:d});
  const pct=v=>v===null||v===undefined?'—':`${num(v,1)}%`;
  async function init(){try{
    const [current,regime,explorer]=await Promise.all([load('../data/v20/current.json'),load('../data/v20/market-regime.json'),load('../data/v20/market-explorer.json')]);
    $('status').textContent=current.executionStatus==='EXECUTION_GRADE'?'Execution Grade':current.executionStatus==='RESEARCH_ONLY'?'بحث فقط — التنفيذ مغلق':current.executionStatus||'محظور';
    $('status').className=current.executionStatus==='EXECUTION_GRADE'?'good':'bad';
    $('session').textContent=`جلسة ${current.sessionDate||'—'}`;
    $('regime').textContent=regime.verified===true?regime.regime:'غير متحقق';
    $('exposure').textContent=pct(current.portfolio?.recommendedExposurePct);
    $('trendCoverage').textContent=pct(explorer.summary?.marketTrendContextCoverageOfUniversePct);
    $('fullTechnical').textContent=`${num(explorer.summary?.currentTechnicalReadyCount,0)} / ${num(explorer.summary?.universeCount,0)}`;
    $('guardText').textContent=current.executionStatus==='EXECUTION_GRADE'
      ? 'Score ≠ Confidence ≠ Execution Permission. حتى مع Execution Grade، صفحات البحث لا تنشئ أوامر ولا تغيّر Champion تلقائيًا.'
      : 'Score ≠ Confidence ≠ Execution Permission. بوابة V17 الحالية مغلقة؛ لا توجد صفحة بحثية هنا تنشئ ACTIONABLE أو Exposure أو أمر شراء.';
  }catch(error){$('error').classList.remove('hidden');$('error').textContent=`تعذر تحميل Research Center: ${error.message}`;}}
  init();
})();
