function installAgreementBadgeUi(){
  if(typeof filteredOpportunities==='function'){
    filteredOpportunities=function(){
      const q=state.filters.search.trim().toLowerCase();
      return(state.data?.allCandidates||[]).filter(row=>passesTier(row)&&(state.filters.family==='all'||(row.strategyFamilies||[]).includes(state.filters.family))&&(!state.filters.multi||Number(row.engineAgreementBadge?.engineCount||0)>=2)&&(!q||row.ticker?.toLowerCase().includes(q)||row.companyNameAr?.toLowerCase().includes(q)));
    };
  }
  if(typeof renderTopFive==='function'){
    const baseRenderTopFive=renderTopFive;
    renderTopFive=function(){
      baseRenderTopFive();
      document.querySelectorAll('#topFiveList .top-card').forEach(card=>{
        const row=candidateByTicker(card.dataset.openTicker);
        const badge=row?.engineAgreementBadge;
        if(!badge?.isShared)return;
        const tag=document.createElement('small');
        tag.textContent=badge.labelAr;
        tag.style.gridColumn='2';
        tag.style.fontWeight='900';
        tag.style.color=badge.engineCount>=4?'#ffbf69':'#cfe9ff';
        tag.title=`${badge.engineCount} محركات: ${(badge.engines||[]).join(' + ')}`;
        card.appendChild(tag);
      });
    };
  }
  if(state?.data){
    try{renderTopFive();renderOpportunities();}catch(err){console.warn('Agreement badge UI refresh skipped',err)}
  }
}
installAgreementBadgeUi();
