export const RESEARCH_AUTHORITY_MODE='RESEARCH';

export const RESEARCH_SOURCE_POLICY=Object.freeze({
  LEGACY_IMPORT:Object.freeze({sourceClass:'LEGACY_IMPORT',providerGroup:'LEGACY_ARCHIVE',researchPrimary:true,researchCrossCheck:false,productionAuthority:false,description:'Immutable migration seed from legacy EGX engines'}),
  LEGACY_MARKET_IMPORT:Object.freeze({sourceClass:'LEGACY_MARKET_SNAPSHOT',providerGroup:'MUBASHER',researchPrimary:true,researchCrossCheck:false,productionAuthority:false,description:'Exact-commit legacy market snapshot, imported as research evidence only'}),
  YAHOO_RESEARCH:Object.freeze({sourceClass:'PUBLIC_HISTORY',providerGroup:'YAHOO',researchPrimary:true,researchCrossCheck:true,productionAuthority:false,description:'Yahoo Finance OHLCV for research continuity only'}),
  MUBASHER_RESEARCH:Object.freeze({sourceClass:'PUBLIC_MARKET',providerGroup:'MUBASHER',researchPrimary:true,researchCrossCheck:true,productionAuthority:false,description:'Mubasher Egypt market/session evidence for research cross-checking'})
});

export function getResearchSourcePolicy(sourceId){
  const policy=RESEARCH_SOURCE_POLICY[String(sourceId??'').trim().toUpperCase()];
  return policy?{...policy}:null;
}

export function stampResearchRecord(record,{sourceId}={}){
  const id=String(sourceId??'').trim().toUpperCase();
  const policy=getResearchSourcePolicy(id);
  if(!policy) throw new Error(`UNKNOWN_RESEARCH_SOURCE:${id||'MISSING'}`);
  return Object.freeze({...record,authorityMode:RESEARCH_AUTHORITY_MODE,researchOnly:true,productionAuthority:false,sourceId:id,sourceClass:policy.sourceClass,providerGroup:policy.providerGroup});
}

export function assertResearchOnly(record){
  if(record?.authorityMode!==RESEARCH_AUTHORITY_MODE||record?.researchOnly!==true||record?.productionAuthority!==false) throw new Error('RESEARCH_AUTHORITY_BOUNDARY_VIOLATION');
  const policy=getResearchSourcePolicy(record?.sourceId);
  if(!policy||policy.productionAuthority!==false) throw new Error('RESEARCH_SOURCE_POLICY_VIOLATION');
  return true;
}
