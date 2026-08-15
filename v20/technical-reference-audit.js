(() => {
'use strict';
const panel=document.getElementById('referencePanel');
if(!panel)return;
const esc=v=>String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const numeric=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const num=(v,d=4)=>numeric(v)===null?'—':numeric(v).toLocaleString('ar-EG',{maximumFractionDigits:d});
const pct=v=>numeric(v)===null?'—':`${num(v,3)}%`;
const stateLabel=s=>({DUAL_PROVIDER_CURRENT_CLOSE_WITHIN_EXISTING_TOLERANCE:'مصدران حاليان متقاربان — مرشح مراجعة يدوي فقط',DUAL_PROVIDER_CURRENT_CLOSE_CONFLICT:'تعارض بين Close المصدرين',SINGLE_PROVIDER_CURRENT_CLOSE_ONLY:'Close حالي من مصدر واحد فقط',NO_CURRENT_SESSION_PROVIDER_CLOSE:'لا يوجد Close للجلسة الحالية من المصدرين'}[s]||s||'—');
async function load(){const r=await fetch('../data/v20/regression.json',{cache:'no-store'});if(!r.ok)throw new Error(`regression HTTP ${r.status}`);return r.json()}
function providerClose(row,name){return (row.candidates||[]).find(x=>x.provider===name)?.close??null}
function render(audit){
 const policy=audit?.policy||{},rows=audit?.rows||[],counts=audit?.stateCounts||{};
 if(policy.authoritativeCurrentMarketReference!==false||policy.autoFillCurrentMarketPriceAllowed!==false||policy.causeInferenceAllowed!==false||policy.corporateActionInferenceAllowed!==false)throw new Error('Unsafe current-reference audit policy');
 document.body.dataset.referenceAuditTargetCount=String(audit.targetCount??rows.length);
 document.body.dataset.referenceAuditCandidateCount=String(audit.manualReferenceReviewCandidateCount??0);
 document.body.dataset.referenceAuditAuthoritative='false';
 document.body.dataset.referenceAuditAutoFill='false';
 if(!rows.length){panel.classList.add('hidden');panel.innerHTML='';return}
 const cards=rows.map(row=>{const y=providerClose(row,'YAHOO'),s=providerClose(row,'STARTA'),candidate=row.manualReferenceReviewCandidate===true;return `<button type="button" data-reference-ticker="${esc(row.ticker)}" data-reference-state="${esc(row.state)}" data-manual-candidate="${candidate?'true':'false'}"><b>${esc(row.ticker)}</b><span>${esc(stateLabel(row.state))}</span><small>Yahoo ${esc(num(y))} • Starta ${esc(num(s))}${row.differencePct!==null&&row.differencePct!==undefined?` • Δ ${esc(pct(row.differencePct))}`:''}</small><small>${candidate?'MANUAL REVIEW CANDIDATE — NOT RESOLVED':'REVIEW EVIDENCE ONLY'}</small></button>`}).join('');
 const states=Object.entries(counts).map(([k,v])=>`${esc(stateLabel(k))}: ${esc(v)}`).join(' • ');
 panel.innerHTML=`<div class="review-panel-head"><div><span class="eyebrow">Current reference candidate audit</span><strong>${esc(audit.targetCount??rows.length)} سهم بدون Current Market Reference authoritative</strong></div><small>${esc(states)}</small></div><div class="review-route-grid reference-audit-grid">${cards}</div><div class="review-policy"><strong>Authoritative = NO • Auto-fill = NO • Cause verified = NO</strong> — استخدام نفس tolerance الحالية (${esc(pct(policy.existingReconciliationTolerancePct))}) تشخيصي للمراجعة اليدوية فقط؛ لا يملأ سعر السوق ولا يغير Data Truth أو Decision Score أو V17 gate.</div>`;
 panel.classList.remove('hidden');
 panel.querySelectorAll('[data-reference-ticker]').forEach(btn=>btn.addEventListener('click',()=>{const search=document.getElementById('search'),avail=document.getElementById('availability');if(avail){avail.value='UNAVAILABLE';avail.dispatchEvent(new Event('change',{bubbles:true}))}if(search){search.value=btn.dataset.referenceTicker||'';search.dispatchEvent(new Event('input',{bubbles:true}));search.scrollIntoView({behavior:'smooth',block:'center'})}}));
}
load().then(reg=>{const audit=reg?.fullMarketTechnicalRegression?.currentReferenceCandidateAudit,rr=reg?.fullMarketTechnicalRegression?.currentReferenceCandidateAuditRegression;if(!audit||rr?.ok!==true)throw new Error('Current-reference candidate audit not validated');render(audit)}).catch(e=>{console.error('V20 current-reference audit UI:',e);panel.classList.remove('hidden');panel.innerHTML=`<div class="error">تعذر تحميل Current Reference Audit: ${esc(e.message)}</div>`;document.body.dataset.referenceAuditError=e.message});
})();