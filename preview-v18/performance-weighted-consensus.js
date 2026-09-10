const PERFORMANCE_WEIGHTED_CONSENSUS_SCHEMA='18.2.1-performance-weighted';
const PERFORMANCE_WEIGHTED_RANKING_SCHEMA='18.2.2-performance-weighted-ranking';
function installPerformanceWeightedConsensusUi(){
  if(typeof filteredOpportunities==='function'){
    filteredOpportunities=function(){
      const q=state.filters.search.trim().toLowerCase();
      return(state.data?.allCandidates||[]).filter(row=>passesTier(row)&&(state.filters.family==='all'||(row.strategyFamilies||[]).includes(state.filters.family))&&(!state.filters.multi||Number(row.engineAgreementBadge?.eligibleEngineCount??row.engineAgreementBadge?.engineCount??0)>=2)&&(!q||row.ticker?.toLowerCase().includes(q)||row.companyNameAr?.toLowerCase().includes(q)));
    };
  }
  if(typeof renderTopFive==='function'){
    const base=renderTopFive;
    renderTopFive=function(){
      base();
      document.querySelectorAll('#topFiveList .top-card').forEach(card=>{
        const row=candidateByTicker(card.dataset.openTicker),b=row?.engineAgreementBadge;if(!b)return;
        const tag=document.createElement('small');
        const raw=Number(b.rawEngineCount??b.engineCount??0),effective=Number(b.eligibleEngineCount??b.engineCount??0),rel=b.forwardReliabilityScore;
        tag.textContent=`اتفاق ${effective}/${raw} · موثوقية ${rel==null?'—':fmt(rel,0)+'%'}`;
        tag.style.gridColumn='2';tag.style.fontWeight='900';tag.style.color=effective>=2?'#ffbf69':'#cfe9ff';
        tag.title=(b.engineDetails||[]).map(x=>`${x.engine}: ${x.state} · وزن ${fmt(x.voteWeightPct,0)}% · Forward ${x.forwardSessions}/${x.promotionThresholdSessions}`).join('\n');
        card.appendChild(tag);
      });
    };
  }
  if(typeof selectTicker==='function'){
    const baseSelect=selectTicker;
    selectTicker=function(ticker){
      baseSelect(ticker);const row=candidateByTicker(ticker),b=row?.engineAgreementBadge;if(!b)return;
      let box=document.getElementById('weightedConsensusDetail');
      if(!box){box=document.createElement('div');box.id='weightedConsensusDetail';box.className='detail-section';const host=document.getElementById('detailContent');if(host)host.insertBefore(box,host.children[2]||null)}
      const details=(b.engineDetails||[]).map(x=>`<div class="condition ${x.fresh?'pass':'fail'}"><b>${esc(x.engine)} · ${esc(x.state)}</b><em>وزن ${fmt(x.voteWeightPct,0)}% · Reliability ${fmt(x.reliabilityScore,0)} · Forward ${fmt(x.forwardSessions,0)}/${fmt(x.promotionThresholdSessions,0)}</em></div>`).join('');
      box.innerHTML=`<h3>Performance‑Weighted Consensus</h3><div class="technical-grid">${metric('الاتفاق الخام',`${fmt(b.rawEngineCount,0)} محركات`)}${metric('الاتفاق الفعّال',`${fmt(b.eligibleEngineCount,0)} محركات`)}${metric('Forward Reliability',b.forwardReliabilityScore==null?'—':`${fmt(b.forwardReliabilityScore,0)}%`)}${metric('Weighted Agreement',b.weightedAgreementScore==null?'—':`${fmt(b.weightedAgreementScore,0)}%`)}</div><div class="condition-list" style="margin-top:8px">${details||'<div class="condition"><b>لا توجد مساهمات محركات مسجلة</b></div>'}</div>`;
    };
  }
  if(state?.data){try{renderTopFive();renderOpportunities();if(state.selected)selectTicker(state.selected)}catch(err){console.warn('Performance weighted consensus UI refresh skipped',err)}}
}
installPerformanceWeightedConsensusUi();
