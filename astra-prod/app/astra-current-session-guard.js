'use strict';
(() => {
  if (window.__ASTRA_CURRENT_SESSION_GUARD_BOOT__) return;
  window.__ASTRA_CURRENT_SESSION_GUARD_BOOT__ = true;

  const A = v => Array.isArray(v) ? v : [];
  const load = async url => {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'g=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
    return r.json();
  };
  const dateOnly = v => (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  const newer = (a, b) => Boolean(a && (!b || a > b));

  let active = false;
  let applying = false;
  let context = null;
  let timer = null;

  function findCard(label) {
    return [...document.querySelectorAll('.card')].find(c => c.querySelector('small')?.textContent?.trim() === label) || null;
  }

  function ensureNotice() {
    if (document.getElementById('astraCurrentSessionGuardNotice')) return;
    const wrap = document.querySelector('main.wrap');
    if (!wrap) return;
    const box = document.createElement('div');
    box.id = 'astraCurrentSessionGuardNotice';
    box.className = 'panel';
    box.style.borderColor = '#8a7130';
    box.style.background = '#302716';
    box.innerHTML = `<div class="notice" style="margin:0"><b>جلسة السوق الحالية ${context.marketSession} مكتملة وموثقة.</b> محرك MAIN APP أعاد <b>${context.currentCount}</b> توصيات لهذه الجلسة. لقطة G22 المعروضة في data.json ما زالت من ${context.snapshotSession || 'جلسة سابقة'}؛ لذلك تم حجب توصيات اللقطة السابقة من العرض كأنها توصيات اليوم إلى أن يكتمل rebuild الحالي.</div>`;
    wrap.insertBefore(box, wrap.firstChild);
  }

  function scrubStaleCurrentLabels() {
    document.querySelectorAll('#view-search .name').forEach(el => {
      if (/ضمن توصيات Astra الحالية/.test(el.textContent || '')) el.textContent = 'ضمن لقطة G22 السابقة — ليست توصية للجلسة الحالية';
    });
    document.querySelectorAll('#view-portfolio .tag.good').forEach(el => {
      if (/ضمن Astra/.test(el.textContent || '')) { el.textContent = 'لقطة سابقة'; el.classList.remove('good'); el.classList.add('warn'); }
    });
    document.querySelectorAll('#stockDetail p').forEach(el => {
      if (/ضمن DecisionSnapshot الحالي/.test(el.textContent || '')) el.textContent = 'ضمن لقطة G22 السابقة — ليست توصية للجلسة الحالية';
    });
  }

  function applyGuard() {
    if (!active || applying || !context) return;
    applying = true;
    try {
      const sessionBadge = document.getElementById('sessionBadge');
      if (sessionBadge) sessionBadge.textContent = 'جلسة ' + context.marketSession;
      const snapshotBadge = document.getElementById('snapshotBadge');
      if (snapshotBadge && !/سابق/.test(snapshotBadge.textContent || '')) snapshotBadge.textContent += ' · سابق';
      const gateBadge = document.getElementById('gateBadge');
      if (gateBadge) { gateBadge.textContent = 'CURRENT SESSION VERIFIED · G22 PENDING'; gateBadge.classList.remove('good'); gateBadge.classList.add('warn'); }

      const sessionCard = findCard('جلسة القرار');
      if (sessionCard) {
        const small = sessionCard.querySelector('small');
        const b = sessionCard.querySelector('b');
        if (small) small.textContent = 'جلسة السوق الحالية';
        if (b) b.textContent = context.marketSession;
      }
      const opportunitiesCard = findCard('فرص Astra الحالية');
      if (opportunitiesCard?.querySelector('b')) opportunitiesCard.querySelector('b').textContent = String(context.currentCount);

      const home = document.getElementById('view-home');
      if (home) {
        [...home.querySelectorAll('.panel')].forEach(panel => {
          if (panel.querySelector('h2')?.textContent?.includes('أفضل فرص Astra')) {
            const grid = panel.querySelector('.grid');
            if (grid) grid.innerHTML = `<div class="empty">لا توجد توصيات منشورة للجلسة الحالية ${context.marketSession}. تم حجب توصيات ${context.snapshotSession || 'اللقطة السابقة'} من اعتبارها توصيات اليوم.</div>`;
          }
        });
      }

      const recView = document.getElementById('view-recommendations');
      if (recView) {
        const tbody = recView.querySelector('tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty">0 توصيات للجلسة الحالية ${context.marketSession}. لقطة ${context.snapshotSession || 'السابقة'} محفوظة كسجل تاريخي فقط.</td></tr>`;
        const cards = recView.querySelectorAll('.grid.three .card b');
        if (cards[0]) cards[0].textContent = '0';
        if (cards[1]) cards[1].textContent = '0%';
        if (cards[2]) cards[2].textContent = '100%';
      }

      scrubStaleCurrentLabels();
      ensureNotice();
      window.__ASTRA_CURRENT_SESSION_GUARD__ = { ...context, active: true, appliedAt: new Date().toISOString() };
    } finally {
      applying = false;
    }
  }

  function scheduleApply() {
    clearTimeout(timer);
    timer = setTimeout(applyGuard, 30);
  }

  async function boot() {
    for (let i = 0; i < 150 && !window.__ASTRA_G22_READY__; i++) await new Promise(r => setTimeout(r, 100));
    const [app, handoff, scan] = await Promise.all([
      load('./data.json'),
      load('../../data/ops/g22-main-app-handoff.json'),
      load('../../data/stable/v16-immediate-scan-status.json')
    ]);
    const snapshotSession = dateOnly(app?.sourceDecision?.session);
    const marketSession = dateOnly(handoff?.sessionDate || scan?.sessionDate);
    const currentCount = Number(scan?.recommendationCount ?? 0);
    const verified = handoff?.final === true && handoff?.sourceReady === true && handoff?.currentSessionReady === true && handoff?.executionGrade === true && handoff?.pagesPublished === true && scan?.final === true && scan?.sourceReady === true && scan?.currentSessionReady === true && scan?.executionGrade === true && dateOnly(scan?.sessionDate) === marketSession;
    if (!verified || !newer(marketSession, snapshotSession)) {
      window.__ASTRA_CURRENT_SESSION_GUARD__ = { active: false, verified, marketSession, snapshotSession, checkedAt: new Date().toISOString() };
      return;
    }
    context = { marketSession, snapshotSession, currentCount, handoffFingerprint: handoff?.materialFingerprint || null, canonicalDataHead: handoff?.canonicalDataHead || null };
    active = true;
    applyGuard();
    const main = document.querySelector('main.wrap');
    if (main) new MutationObserver(scheduleApply).observe(main, { childList: true, subtree: true, characterData: true });
    document.addEventListener('click', scheduleApply, true);
    document.addEventListener('input', scheduleApply, true);
  }

  boot().catch(error => {
    console.warn('ASTRA_CURRENT_SESSION_GUARD_FAILED', error);
    window.__ASTRA_CURRENT_SESSION_GUARD__ = { active: false, error: String(error?.message || error), checkedAt: new Date().toISOString() };
  });
})();
