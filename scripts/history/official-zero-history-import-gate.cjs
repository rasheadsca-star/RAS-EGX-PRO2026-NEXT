'use strict';
function evaluateOfficialBootstrap({item,entry,existing,latestMarketSession,review}={}){
 const zero=!Array.isArray(existing?.sessions)||existing.sessions.length===0;
 const rows=Array.isArray(item?.sessions)?item.sessions:[];
 const currency=String(entry?.currency||'EGP').toUpperCase();
 const reasons=[];
 if(entry?.active===false||!entry?.ticker)reasons.push('inactive_or_unmapped');
 if(item?.currency&&String(item.currency).toUpperCase()!==currency)reasons.push('currency_mismatch');
 if(rows.some(x=>x.currency&&String(x.currency).toUpperCase()!==currency))reasons.push('row_currency_mismatch');
 if(zero){
  if(item?.source!=='egx_official')reasons.push('official_source_required');
  if(!item?.isin||!entry?.isin||String(item.isin).toUpperCase()!==String(entry.isin).toUpperCase())reasons.push('isin_match_required');
  if(!review?.reviewedBy||!review?.reviewedAt)reasons.push('review_record_required');
  if(rows.length<60)reasons.push('at_least_60_sessions_required');
  if(!latestMarketSession||!rows.some(x=>x.date===latestMarketSession))reasons.push('current_exact_session_required');
  let officialHost=false;
  try { const u=new URL(String(item?.sourceUrl||''));officialHost=u.protocol==='https:' && (u.hostname==='egx.com.eg'||u.hostname.endsWith('.egx.com.eg')||u.hostname==='egidegypt.com'||u.hostname.endsWith('.egidegypt.com')); } catch {}
  if(!officialHost)reasons.push('recognized_official_egx_origin_required');
  if(new Set(rows.map(x=>x.date)).size!==rows.length)reasons.push('duplicate_dates');
  if(latestMarketSession&&rows.some(x=>String(x.date||'')>latestMarketSession))reasons.push('post_session_lookahead');
 }
 return {eligible:reasons.length===0,zeroHistory:zero,currency,reasons};
}
module.exports={evaluateOfficialBootstrap};
