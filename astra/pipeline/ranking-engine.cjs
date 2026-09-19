'use strict';
const {VERSION,CONFIG,finite}=require('./g09-shared.cjs');

function rankCandidates(candidateRecords){
  for(const c of candidateRecords)if(!Number.isFinite(finite(c.signal.rawScore)))throw Object.assign(new Error(`Ranking score invalid for ${c.ticker}`),{code:'RANKING_INPUT_INVALID'});
  return candidateRecords.slice().sort((a,b)=>(finite(b.signal.rawScore)-finite(a.signal.rawScore))||a.ticker.localeCompare(b.ticker)).map((c,i)=>({...c,rank:i+1,ranking:{version:VERSION.ranking,score:c.signal.rawScore,meaning:'Source-pinned V16.9 selection ordering score; not a probability of success.',components:[{name:'V16_9_SOURCE_SELECTION_SCORE',value:c.signal.rawScore,weight:null,provenance:CONFIG.rankingSource}],tieBreak:CONFIG.tieBreak}}));
}

module.exports={rankCandidates};
