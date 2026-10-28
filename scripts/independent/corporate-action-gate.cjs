'use strict';
// Review-required price discontinuities are NOT confirmed corporate actions.
// They must remain research holdouts until adjusted-price evidence is verified.
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function pendingCorporateActionCandidates(candidates,ticker,first,last){
 if(!Array.isArray(candidates)||typeof ticker!=='string'||!iso(first)||!iso(last)||first>last)return [];
 const symbol=ticker.trim().toUpperCase();
 return candidates.filter(c=>c&&String(c.ticker||'').trim().toUpperCase()===symbol&&
   c.status==='review_required'&&iso(c.date)&&c.date>=first&&c.date<=last)
  .map(c=>({date:c.date,reason:String(c.reason||'unresolved_price_discontinuity')}))
  .sort((a,b)=>a.date.localeCompare(b.date));
}
module.exports={pendingCorporateActionCandidates};
