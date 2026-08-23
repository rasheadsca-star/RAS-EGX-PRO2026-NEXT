const ENDPOINT = '/api/fundamental';
const MANUAL_KEY = 'egx-tfe-rc2-v169-fundamentals';
const cache = new Map();
let requestSeq = 0;
let lastTicker = '';

const $ = (id) => document.getElementById(id);
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const esc = (v) => String(v ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => n(v) === null ? '—' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: d });
const pct = (v, d = 1) => n(v) === null ? '—' : `${fmt(v, d)}%`;
const dateFmt = (v) => {
  const t = Date.parse(v || '');
  if (!Number.isFinite(t)) return v || '—';
  return new Intl.DateTimeFormat('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(t));
};
const money = (v) => {
  if (n(v) === null) return '—';
  return new Intl.NumberFormat('ar-EG', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(v));
};
const manualState = () => { try { return JSON.parse(localStorage.getItem(MANUAL_KEY) || '{}') || {}; } catch { return {}; } };

function ensureStyle() {
  if ($('fundamentalAutoStyle')) return;
  const style = document.createElement('style');
  style.id = 'fundamentalAutoStyle';
  style.textContent = `
    #fundamentalAutoAnalysis{margin-bottom:14px}.fa-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.fa-head h2{margin:0 0 5px}.fa-head p{margin:0;color:#91adbb;font-size:11px;line-height:1.7}.fa-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.fa-badge{border:1px solid #38677e;border-radius:999px;padding:5px 9px;font-size:10px;color:#c6edff}.fa-note{border:1px solid #315367;background:#08202d;border-radius:9px;padding:9px 10px;margin:10px 0;font-size:10px;line-height:1.7;color:#a9c4d1}.fa-note.warn{border-color:#7a6336;color:#ffe3a3}.fa-note.bad{border-color:#7b4650;color:#ffbbc2}.fa-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;margin:10px 0}.fa-card{border:1px solid #294b5d;background:#061923;border-radius:9px;padding:8px;min-width:0}.fa-card small{display:block;color:#8da8b7;font-size:9px}.fa-card b{display:block;margin-top:4px;font-size:14px;overflow:hidden;text-overflow:ellipsis}.fa-score{display:grid;grid-template-columns:140px 1fr;gap:12px;align-items:center;margin:10px 0}.fa-score-ring{width:120px;height:120px;border-radius:50%;display:grid;place-items:center;margin:auto;position:relative}.fa-score-ring:after{content:'';position:absolute;inset:10px;border-radius:50%;background:#071923}.fa-score-ring>div{position:relative;z-index:1;text-align:center}.fa-score-ring strong{display:block;font-size:27px}.fa-score-ring span{font-size:9px;color:#8da8b7}.fa-verdict h3{margin:0 0 6px}.fa-verdict p{margin:0;color:#a8c2ce;line-height:1.7;font-size:11px}.fa-pillars{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin:10px 0}.fa-pillar{border:1px solid #294b5d;border-radius:8px;padding:7px;background:#071923}.fa-pillar>div{display:flex;justify-content:space-between;gap:4px;font-size:9px}.fa-track{height:6px;background:#173443;border-radius:99px;overflow:hidden;margin-top:6px}.fa-track i{display:block;height:100%;background:#49bce9}.fa-section{margin-top:13px}.fa-section h3{margin:0 0 8px;font-size:13px}.fa-table{width:100%;border-collapse:collapse;font-size:10px}.fa-table th,.fa-table td{padding:7px;border-bottom:1px solid #234455;text-align:right}.fa-flags{display:grid;gap:6px}.fa-flag{padding:8px;border:1px solid #345366;border-radius:8px;font-size:10px;line-height:1.6}.fa-flag.CRITICAL,.fa-flag.HIGH{border-color:#824852;color:#ffc1c6}.fa-flag.MEDIUM{border-color:#7c6436;color:#ffe1a0}.fa-flag.LOW{color:#b9d6e2}.fa-source{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.fa-source a{color:#75d4ff}.fa-good{color:#63dda7}.fa-warn{color:#ffd27d}.fa-bad{color:#ff8894}
    @media(max-width:900px){.fa-grid,.fa-pillars{grid-template-columns:repeat(3,1fr)}.fa-source{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:600px){.fa-head,.fa-score{grid-template-columns:1fr;display:grid}.fa-grid,.fa-pillars,.fa-source{grid-template-columns:repeat(2,1fr)}}`;
  document.head.appendChild(style);
}

function ensureHost() {
  const view = $('view-fundamentals');
  if (!view) return null;
  ensureStyle();
  let host = $('fundamentalAutoAnalysis');
  if (!host) {
    host = document.createElement('article');
    host.id = 'fundamentalAutoAnalysis';
    host.className = 'panel';
    const layout = view.querySelector('.fundamental-layout');
    if (layout) layout.insertAdjacentElement('beforebegin', host); else view.prepend(host);
  }
  const panels = view.querySelectorAll('.fundamental-layout > .panel');
  if (panels[0]) {
    const h = panels[0].querySelector('h2');
    const p = panels[0].querySelector('.panel-head p');
    if (h) h.textContent = 'البيانات اليدوية المحلية (اختياري)';
    if (p) p.textContent = 'يمكن تعديل أو حفظ قيمك يدويًا. التحليل التلقائي الموثق بالمصدر يظهر في الأعلى ولا يُستبدل بهذه المدخلات.';
  }
  if (panels[1]) {
    const h = panels[1].querySelector('h2');
    const p = panels[1].querySelector('.panel-head p');
    if (h) h.textContent = 'التقييم اليدوي المحلي';
    if (p) p.textContent = 'هذا الصندوق يخص القيم اليدوية المحفوظة فقط؛ درجة Fundamental Engine التلقائية تظهر في الأعلى.';
  }
  return host;
}

function card(label, value, cls = '', note = '') {
  return `<div class="fa-card"><small>${esc(label)}</small><b class="${cls}">${esc(value)}</b>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
}

function sourceLink(url, label) {
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '—';
}

function fillForm(record, ticker) {
  const saved = manualState()?.[ticker];
  if (saved && Object.keys(saved).length) return false;
  const map = {
    revenueGrowth: record?.calculated?.revenueGrowthPct,
    profitGrowth: record?.calculated?.netIncomeGrowthPct,
    roe: record?.latest?.returnOnEquityPct,
    debtEquity: record?.latest?.debtToEquity,
    pe: record?.latest?.peRatio,
    fairValue: record?.relativeFairValue?.fairValue,
  };
  for (const [id, value] of Object.entries(map)) {
    const el = $(id);
    if (el && n(value) !== null) el.value = value;
  }
  if ($('positiveCfo')) $('positiveCfo').checked = n(record?.latest?.operatingCashFlow) > 0;
  if ($('auditedData')) $('auditedData').checked = record?.dataQuality?.audited === true;
  const notes = $('fundamentalNotes');
  if (notes && !notes.value) notes.value = `تعبئة تلقائية للعرض من ${record?.source?.provider || 'Fundamental Engine'} — الفترة ${record?.financialPeriodEnd || '—'}. لا يتم الحفظ إلا عند الضغط على زر الحفظ.`;
  return true;
}

function renderRecord(payload) {
  const host = ensureHost();
  if (!host) return;
  const r = payload.record;
  const q = r.dataQuality || {}, l = r.latest || {}, c = r.calculated || {}, fv = r.relativeFairValue || {}, peer = r.peerComparison || {}, br = r.breakdown || {};
  const score = n(r.score) ?? 0;
  const scoreCls = score >= 70 ? 'fa-good' : score >= 50 ? 'fa-warn' : 'fa-bad';
  const ringColor = score >= 70 ? '#42c891' : score >= 50 ? '#d6ac4f' : '#df6975';
  const sourceWarning = q.officialVerified === true && q.audited === true
    ? '<div class="fa-note"><b class="fa-good">مصدر موثق ومدقق.</b></div>'
    : `<div class="fa-note warn"><b>تنبيه المصدر:</b> البيانات الحالية ${esc(q.sourceTier || r.source?.providerTier || 'غير مصنفة')} وليست إفصاحًا رسميًا مدققًا حسب الملف الحالي. تُستخدم كمعلومة مساعدة فقط.</div>`;
  const maxByPillar = { profitability: 25, growth: 20, balanceSheet: 20, cashFlow: 15, valuation: 15, disclosure: 5 };
  const pillarNames = { profitability: 'الربحية', growth: 'النمو', balanceSheet: 'الميزانية', cashFlow: 'التدفقات', valuation: 'التقييم', disclosure: 'الإفصاح' };
  const methods = Array.isArray(fv.methods) ? fv.methods : [];
  const flags = Array.isArray(r.redFlags) ? r.redFlags : [];
  host.innerHTML = `
    <div class="fa-head"><div><h2>التحليل المالي التلقائي — ${esc(r.ticker)}</h2><p>${esc(r.companyNameAr || '')} · Fundamental Engine V16 · Supplemental Only</p></div><div class="fa-actions"><span class="fa-badge">بيانات ${esc(dateFmt(payload.generatedAt))}</span><button class="btn" id="fundamentalAutoRefresh">تحديث التحليل المالي</button></div></div>
    ${sourceWarning}
    <div class="fa-score"><div class="fa-score-ring" style="background:conic-gradient(${ringColor} ${Math.max(0, Math.min(100, score)) * 3.6}deg,#17364b 0)"><div><strong class="${scoreCls}">${fmt(score,0)}</strong><span>Fundamental / 100</span></div></div><div class="fa-verdict"><h3>${esc(r.grade || '—')} · ${esc(r.verdictAr || r.verdict || '—')}</h3><p>الفترة المالية: <b>${esc(r.financialPeriodEnd || '—')}</b> · عمر القوائم وقت بناء التحليل: <b>${fmt(r.statementAgeDays,0)} يوم</b> · اكتمال البيانات: <b>${pct(q.completenessPct)}</b> · القالب: <b>${esc(r.classification?.template || 'GENERAL')}</b>.</p></div></div>
    <div class="fa-pillars">${Object.entries(maxByPillar).map(([k,max]) => { const v=n(br[k])??0; return `<div class="fa-pillar"><div><span>${pillarNames[k]}</span><b>${fmt(v,0)}/${max}</b></div><div class="fa-track"><i style="width:${Math.max(0,Math.min(100,v/max*100))}%"></i></div></div>`; }).join('')}</div>
    <div class="fa-grid">
      ${card('الإيرادات', money(l.revenue))}${card('صافي الربح', money(l.netIncome), n(l.netIncome)>=0?'fa-good':'fa-bad')}${card('نمو الإيرادات', pct(c.revenueGrowthPct), n(c.revenueGrowthPct)>=0?'fa-good':'fa-bad')}${card('نمو الأرباح', pct(c.netIncomeGrowthPct), n(c.netIncomeGrowthPct)>=0?'fa-good':'fa-bad')}${card('ROE', pct(l.returnOnEquityPct))}${card('هامش صافي الربح', pct(l.netMarginPct))}
      ${card('Operating Cash Flow', money(l.operatingCashFlow), n(l.operatingCashFlow)>=0?'fa-good':'fa-bad')}${card('Free Cash Flow', money(l.freeCashFlow), n(l.freeCashFlow)>=0?'fa-good':'fa-bad')}${card('Debt / Equity', fmt(l.debtToEquity,2))}${card('P/E', fmt(l.peRatio,2))}${card('P/B', fmt(l.priceToBook,2))}${card('Dividend Yield', pct(l.dividendYieldPct))}
    </div>
    <div class="fa-section"><h3>التقييم النسبي والقيمة العادلة</h3><div class="fa-grid">${card('السعر المرجعي في التحليل', fmt(r.currentPrice,3))}${card('القيمة العادلة النسبية', fmt(fv.fairValue,3), n(fv.marginOfSafetyPct)>=0?'fa-good':'fa-bad')}${card('النطاق المنخفض', fmt(fv.low,3))}${card('النطاق المرتفع', fmt(fv.high,3))}${card('هامش الأمان', pct(fv.marginOfSafetyPct), n(fv.marginOfSafetyPct)>=0?'fa-good':'fa-bad')}${card('ثقة التقييم', fv.confidence || '—')}</div>${methods.length?`<div class="table-wrap"><table class="fa-table"><thead><tr><th>الطريقة</th><th>مضاعف السهم</th><th>مضاعف النظراء</th><th>القيمة الضمنية</th></tr></thead><tbody>${methods.map(m=>`<tr><td>${esc(m.name)}</td><td>${fmt(m.currentMultiple,2)}</td><td>${fmt(m.peerMultiple,2)}</td><td>${fmt(m.impliedValue,3)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="fa-note">لا توجد طرق تقييم نسبي كافية لهذا السهم.</div>'}</div>
    <div class="fa-section"><h3>المقارنة مع النظراء</h3><div class="fa-grid">${card('مجموعة المقارنة', peer.peerKey || '—')}${card('عدد النظراء', fmt(peer.peerCount,0))}${card('Median P/E', fmt(peer.medians?.peRatio,2))}${card('Median P/S', fmt(peer.medians?.priceToSales,2))}${card('Median P/B', fmt(peer.medians?.priceToBook,2))}${card('Percentile هامش الربح', pct(peer.percentiles?.netMargin))}</div></div>
    <div class="fa-section"><h3>العلامات الحمراء</h3><div class="fa-flags">${flags.length?flags.map(f=>`<div class="fa-flag ${esc(f.severity)}"><b>${esc(f.severity)} · ${esc(f.code)}</b><br>${esc(f.text)}</div>`).join(''):'<div class="fa-note"><b class="fa-good">لا توجد Red Flags مسجلة في آخر تحليل مالي متاح.</b></div>'}</div></div>
    <div class="fa-section"><h3>شفافية المصدر</h3><div class="fa-source">${card('المزود', r.source?.provider || '—')}${card('الفئة', r.source?.providerTier || q.sourceTier || '—')}${card('Official Verified', q.officialVerified===true?'نعم':'لا',q.officialVerified===true?'fa-good':'fa-warn')}${card('Audited', q.audited===true?'نعم':'لا',q.audited===true?'fa-good':'fa-warn')}</div><div class="fa-note">Income: ${sourceLink(r.source?.incomeUrl,'القائمة المالية')} · Balance Sheet: ${sourceLink(r.source?.balanceSheetUrl,'الميزانية')} · Cash Flow: ${sourceLink(r.source?.cashFlowUrl,'التدفقات')} · Statistics: ${sourceLink(r.source?.statisticsUrl,'الإحصاءات')}<br>القيمة العادلة هنا <b>Relative Peer Valuation</b> وليست DCF ولا قيمة مضمونة. هذا القسم لا يدخل في RC2 Fusion Rank أو قرار النشر.</div></div>`;
  $('fundamentalAutoRefresh')?.addEventListener('click', () => loadTicker(r.ticker, true));
  const autoFilled = fillForm(r, r.ticker);
  if (!autoFilled) host.insertAdjacentHTML('beforeend', '<div class="fa-note">يوجد تقييم يدوي محفوظ لهذا السهم؛ لم يتم استبداله. البيانات التلقائية بالأعلى مستقلة عنه.</div>');
}

function renderState(message, type = '') {
  const host = ensureHost();
  if (!host) return;
  host.innerHTML = `<div class="fa-head"><div><h2>التحليل المالي التلقائي</h2><p>Fundamental Engine V16 · Supplemental Only</p></div></div><div class="fa-note ${type}">${esc(message)}</div>`;
}

async function loadTicker(ticker, force = false) {
  ticker = String(ticker || '').trim().toUpperCase();
  if (!ticker) return;
  lastTicker = ticker;
  const seq = ++requestSeq;
  if (!force && cache.has(ticker)) {
    const payload = cache.get(ticker);
    if (payload.found) renderRecord(payload); else renderState(`لا توجد تغطية مالية تلقائية للسهم ${ticker}.`, 'warn');
    return;
  }
  renderState(`جارٍ تحميل البيانات المالية تلقائيًا لـ ${ticker}…`);
  try {
    const r = await fetch(`${ENDPOINT}?ticker=${encodeURIComponent(ticker)}&t=${Date.now()}`, { cache: 'no-store' });
    const payload = await r.json().catch(() => ({}));
    if (!r.ok || !payload.ok) throw new Error(payload.error || `HTTP ${r.status}`);
    if (seq !== requestSeq || ticker !== lastTicker) return;
    cache.set(ticker, payload);
    if (!payload.found || !payload.record) return renderState(`لا توجد تغطية مالية تلقائية للسهم ${ticker} في ملف Fundamental الحالي.`, 'warn');
    renderRecord(payload);
  } catch (error) {
    if (seq !== requestSeq) return;
    renderState(`تعذر تحميل التحليل المالي لـ ${ticker}: ${error.message}`, 'bad');
  }
}

function currentTicker() { return $('fundamentalTicker')?.value || ''; }

function start() {
  ensureHost();
  const select = $('fundamentalTicker');
  if (select) select.addEventListener('change', () => setTimeout(() => loadTicker(currentTicker()), 0));
  document.querySelector('[data-view="fundamentals"]')?.addEventListener('click', () => setTimeout(() => loadTicker(currentTicker()), 80));
  window.addEventListener('rc2:ui-scan', () => setTimeout(() => loadTicker(currentTicker()), 180));
  const observer = new MutationObserver(() => {
    const ticker = currentTicker();
    if (ticker && ticker !== lastTicker) loadTicker(ticker);
  });
  if (select) observer.observe(select, { childList: true });
  setTimeout(() => { const ticker = currentTicker(); if (ticker) loadTicker(ticker); }, 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
