'use strict';

const API = '/api/native-research';
const esc = (value) => String(value ?? '—').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const num = (value, digits = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: digits }) : '—';
};

function alignmentPresentation(state) {
  if (state === 'IN_ENTRY_RANGE') return { label: 'داخل نطاق الدخول', cls: 'good' };
  if (state === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE') return { label: 'أعلى من الدخول — لا تطارد السعر', cls: 'bad' };
  if (state === 'BELOW_ENTRY_RANGE') return { label: 'أقل من نطاق الدخول — انتظار تأكيد', cls: 'warn' };
  if (state === 'NEAR_ENTRY_PULLBACK' || state === 'PENDING_PULLBACK') return { label: 'انتظار Pullback', cls: 'warn' };
  return { label: state || 'متابعة', cls: 'warn' };
}

function ensurePanel() {
  let panel = document.getElementById('nativeResearchPanel');
  if (panel) return panel;

  const fusionGrid = document.getElementById('recommendationGrid');
  const fusionPanel = fusionGrid?.closest('article.panel');
  if (!fusionPanel) return null;

  panel = document.createElement('article');
  panel.className = 'panel';
  panel.id = 'nativeResearchPanel';
  panel.innerHTML = `
    <div class="panel-head split">
      <div>
        <h2>V20 Native Research — توصيات الجلسة التالية</h2>
        <p id="nativeResearchSubtitle">جارٍ قراءة الترتيب البحثي المحدث…</p>
      </div>
      <div class="filters">
        <span class="badge warn" id="nativeResearchMode">RESEARCH ONLY</span>
        <button class="btn" id="nativeResearchRefresh">تحديث V20 Native</button>
      </div>
    </div>
    <div class="rc2-note" id="nativeResearchNote">
      قائمة بحثية مستقلة عن بوابات Fusion RC2. لا تمنح إذن تنفيذ أو تخصيص أموال، ولا تغيّر نتيجة Fusion المنشورة أعلاه.
    </div>
    <div class="truth-grid" id="nativeResearchSummary" style="margin-bottom:14px"></div>
    <div class="recommendation-grid" id="nativeResearchGrid">
      <div class="empty">جارٍ تحميل توصيات V20 Native…</div>
    </div>`;
  fusionPanel.insertAdjacentElement('afterend', panel);
  panel.querySelector('#nativeResearchRefresh')?.addEventListener('click', () => loadNativeResearch(true));
  return panel;
}

function render(data) {
  const panel = ensurePanel();
  if (!panel) return;

  const subtitle = panel.querySelector('#nativeResearchSubtitle');
  const summary = panel.querySelector('#nativeResearchSummary');
  const grid = panel.querySelector('#nativeResearchGrid');
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  subtitle.textContent = `بيانات جلسة ${data?.sessionDate || '—'} · مخصصة للجلسة التالية ${data?.forNextTradingSession || '—'} · المصدر ${data?.engine || 'V20 Native'}`;
  summary.innerHTML = [
    ['جلسة المصدر', data?.sessionDate || '—', 'V20 Native current'],
    ['الجلسة التالية', data?.forNextTradingSession || '—', data?.freshnessStatus || '—'],
    ['المرشحون المنشورون', num(data?.summary?.publishedResearchCandidateCount, 0), `${num(data?.summary?.nativeResearchRecommendationCount, 0)} مرشح بحثي قبل حد النشر`],
    ['صلاحية التنفيذ', 'BLOCKED', 'researchOnly=true · executionAllowed=false']
  ].map(([a,b,c]) => `<div class="truth-card"><small>${esc(a)}</small><b>${esc(b)}</b><span>${esc(c)}</span></div>`).join('');

  if (!candidates.length) {
    grid.innerHTML = '<div class="empty">لا توجد مرشحات V20 Native منشورة لهذه الجلسة.</div>';
    return;
  }

  grid.innerHTML = candidates.map((x) => {
    const alignment = alignmentPresentation(x.alignmentState);
    return `<article class="rec-card">
      <div class="rec-rank">${esc(x.rank)}</div>
      <h3>${esc(x.ticker)}</h3>
      <div class="rec-name">${esc(x.nameAr || x.nameEn || '')}</div>
      <div class="tag-row">
        <span class="tag ${alignment.cls}">${esc(alignment.label)}</span>
        <span class="tag neutral">${esc(x.nativeResearchTier || 'RESEARCH')}</span>
      </div>
      <div class="rec-metrics">
        <div class="mini">السعر<b>${num(x.price,3)}</b></div>
        <div class="mini">الدخول<b>${num(x.entryLow,3)}–${num(x.entryHigh,3)}</b></div>
        <div class="mini">T1<b>${num(x.target1,3)}</b></div>
        <div class="mini">T2<b>${num(x.target2,3)}</b></div>
        <div class="mini">Stop<b>${num(x.stop,3)}</b></div>
        <div class="mini">Native Score<b>${num(x.nativeResearchScore,1)}</b></div>
        <div class="mini">Net R/R<b>${num(x.netRiskReward,2)}</b></div>
        <div class="mini">S/R<b>${num(x.srConfluenceScore,1)}</b></div>
      </div>
      <div class="gate-list">
        <div class="gate pass"><span>V20 Native Rank #${esc(x.rank)}</span><b>✓</b></div>
        <div class="gate ${x.alignmentState === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE' ? 'fail' : 'pass'}"><span>${esc(alignment.label)}</span><b>${x.alignmentState === 'ABOVE_ENTRY_RANGE_DO_NOT_CHASE' ? '✕' : '✓'}</b></div>
        <div class="gate warn"><span>Research Only — لا تنفيذ آلي</span><b>!</b></div>
      </div>
      <div class="rec-verdict ${alignment.cls}">${x.alignmentState === 'IN_ENTRY_RANGE' ? 'السعر داخل منطقة الدخول البحثية المحددة بواسطة V20 Native.' : esc(alignment.label)}</div>
    </article>`;
  }).join('');
}

function renderError(message) {
  const panel = ensurePanel();
  if (!panel) return;
  panel.querySelector('#nativeResearchSubtitle').textContent = 'تعذر قراءة V20 Native الحالي';
  panel.querySelector('#nativeResearchGrid').innerHTML = `<div class="empty">${esc(message || 'V20 Native غير متاح الآن')}</div>`;
}

async function loadNativeResearch(force = false) {
  const panel = ensurePanel();
  if (!panel) return;
  const btn = panel.querySelector('#nativeResearchRefresh');
  if (btn) btn.disabled = true;
  try {
    const response = await fetch(`${API}?limit=30&t=${Date.now()}${force ? '&force=1' : ''}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    render(data);
  } catch (error) {
    renderError(error?.message || 'تعذر التحديث');
  } finally {
    if (btn) btn.disabled = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => loadNativeResearch(false), { once: true });
} else {
  loadNativeResearch(false);
}
