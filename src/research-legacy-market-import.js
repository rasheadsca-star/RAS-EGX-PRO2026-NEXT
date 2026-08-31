import { sha256 } from './hash.js';
import { stampResearchRecord,assertResearchOnly } from './research-source-policy.js';

const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
function n(v){if(v==null||v==='')return null;const x=Number(String(v).replace(/,/g,'').replace(/[^0-9.+-]/g,''));return Number.isFinite(x)?x:null}
function ticker(v){return String(v??'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9._-]/g,'')}
function validBar(x){return x&&x.open>0&&x.high>0&&x.low>0&&x.close>0&&x.high>=x.open&&x.high>=x.close&&x.high>=x.low&&x.low<=x.open&&x.low<=x.close&&(x.volume==null||x.volume>=0)}

export function importLegacyMarketSnapshot(snapshot,{legacyCommit,sourceFileHash,expectedSession=null,importedAt=null}={}){
  const reasons=[];
  if(!snapshot||!Array.isArray(snapshot.rows))reasons.push('LEGACY_MARKET_ROWS_MISSING');
  if(!/^[0-9a-f]{40}$/i.test(String(legacyCommit??'')))reasons.push('INVALID_LEGACY_MARKET_COMMIT');
  if(!/^[0-9a-f]{64}$/i.test(String(sourceFileHash??'')))reasons.push('INVALID_LEGACY_MARKET_FILE_HASH');
  if(expectedSession&&!DATE_RE.test(String(expectedSession)))reasons.push('INVALID_EXPECTED_SESSION');
  if(reasons.length)return{state:'BLOCKED',reasons,manifest:null,observations:[]};

  const observations=[];const rejected=[];
  for(const row of snapshot.rows){
    const t=ticker(row?.symbol??row?.ticker??row?.code),session=String(row?.sourceSessionDate??row?.marketSessionDate??row?.sessionDate??'').slice(0,10);
    const bar={ticker:t,session,open:n(row?.open),high:n(row?.high),low:n(row?.low),close:n(row?.price??row?.last??row?.close),volume:n(row?.volume),previousClose:n(row?.previousClose),turnover:n(row?.valueTraded??row?.turnover),sourceUrl:row?.sourceUrl??null,sourceMarketTime:row?.sourceMarketTime??null,sourceSessionEvidence:row?.sourceSessionEvidence??null,legacyRowUpdatedAt:row?.updatedAt??null};
    const rowReasons=[];
    if(!t)rowReasons.push('MISSING_TICKER');if(!DATE_RE.test(session))rowReasons.push('MISSING_EXPLICIT_SESSION_FIELD');if(!validBar(bar))rowReasons.push('INVALID_OHLCV');if(!/mubasher/i.test(String(row?.source??snapshot?.source??'')))rowReasons.push('NON_MUBASHER_LEGACY_ROW');
    if(rowReasons.length){rejected.push({ticker:t||null,session:session||null,reasons:rowReasons});continue}
    const inferredEvidence=/quorum|time_only|inferred/i.test(String(bar.sourceSessionEvidence??''));
    const stale=expectedSession&&session!==expectedSession;
    const researchState=stale?'STALE_RESEARCH':'READY_RESEARCH';
    const quarantineReasons=stale?[`EXPECTED_SESSION_MISMATCH:${expectedSession}:${session}`]:[];
    const body={...bar,researchState,quarantineReasons,verificationState:inferredEvidence?'LEGACY_MUBASHER_SESSION_QUORUM':'LEGACY_MUBASHER_EXPLICIT_SESSION',legacyMarketProvenance:{legacyCommit:String(legacyCommit).toLowerCase(),sourceFileHash:String(sourceFileHash).toLowerCase(),snapshotGeneratedAt:snapshot?.generatedAt??null,snapshotUpdatedAt:snapshot?.updatedAt??null,snapshotSource:snapshot?.source??null,importedAt}};
    const stamped=stampResearchRecord({...body,rowHash:sha256(body)},{sourceId:'LEGACY_MARKET_IMPORT'});assertResearchOnly(stamped);observations.push(stamped);
  }
  observations.sort((a,b)=>a.ticker.localeCompare(b.ticker)||a.session.localeCompare(b.session));
  const stableManifest={schemaVersion:'egx-one-legacy-market-import-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,legacyCommit:String(legacyCommit).toLowerCase(),sourceFileHash:String(sourceFileHash).toLowerCase(),sourcePath:'data/market.json',expectedSession,snapshotGeneratedAt:snapshot?.generatedAt??null,snapshotUpdatedAt:snapshot?.updatedAt??null,snapshotSource:snapshot?.source??null,counts:{sourceRows:snapshot.rows.length,accepted:observations.length,rejected:rejected.length,expectedSessionRows:observations.filter(x=>x.session===expectedSession).length,staleRows:observations.filter(x=>expectedSession&&x.session!==expectedSession).length},observationHashes:observations.map(x=>x.rowHash)};
  const manifest={...stableManifest,manifestHash:sha256(stableManifest)};
  return{state:observations.length?'READY_RESEARCH':'SOURCE_UNAVAILABLE',reasons:[],manifest,observations,rejected};
}
