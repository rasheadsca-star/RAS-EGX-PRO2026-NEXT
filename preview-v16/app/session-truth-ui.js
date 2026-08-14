'use strict';
(() => {
  const UPDATE_URL = '../../data/stable/v15-update-status.json';
  const PRICE_TRUTH_URL = '../../data/stable/v15-price-truth.json';
  const DECISION_URL = '../../data/stable/v16-v169-primary-decision.json';

  async function readJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function nextEgxTradingSession(sessionDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate || ''))) return null;
    const date = new Date(`${sessionDate}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    do {
      date.setUTCDate(date.getUTCDate() + 1);
    } while (date.getUTCDay() === 5 || date.getUTCDay() === 6);
    return date.toISOString().slice(0, 10);
  }

  function formatCairo(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Africa/Cairo'
    }).format(date);
  }

  function ensureReleaseNote({ marketSession, recommendationSession, targetSession, aligned, executionEligible }) {
    const release = document.getElementById('releaseStatusCard');
    if (!release) return false;
    let note = document.getElementById('v16SessionTruthNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'v16SessionTruthNote';
      note.className = 'v163-notice';
      note.style.marginTop = '12px';
      release.appendChild(note);
    }

    if (!aligned) {
      note.style.borderColor = '#a94444';
      note.style.background = '#3a171b';
      note.style.color = '#ffe5e5';
      note.innerHTML = `تنبيه جلسة: آخر سوق موثق <b>${marketSession || '—'}</b> بينما السلة <b>${recommendationSession || '—'}</b>. السلة مرجع فقط حتى إعادة البناء.`;
    } else if (!executionEligible) {
      note.style.borderColor = '#8c692d';
      note.style.background = '#332713';
      note.style.color = '#ffe6ad';
      note.innerHTML = `جلسة السوق والسلة متزامنتان: <b>${marketSession || '—'}</b> → الجلسة التالية <b>${targetSession || '—'}</b>. لكن التنفيذ مغلق حاليًا حتى تعود بوابة <b>Execution Grade</b>؛ التعرض التنفيذي 0%.`;
    } else {
      note.style.borderColor = '#2d7358';
      note.style.background = '#0d3028';
      note.style.color = '#dffff1';
      note.innerHTML = `جلسة السوق والسلة متزامنتان: <b>${marketSession || '—'}</b> → الجلسة التالية <b>${targetSession || '—'}</b>. بوابة المصدر التنفيذية مفتوحة مع بقاء تأكيد الافتتاح إلزاميًا.`;
    }
    return true;
  }

  function apply(update, priceTruth, decision) {
    const scanAt = update?.sessionTruth?.scannerRunAt || update?.lastAutomaticScanAt || update?.generatedAt || null;
    const marketSession = priceTruth?.expectedSession || update?.marketSessionDate || update?.expectedLatestSession || update?.sessionDate || null;
    const recommendationSession = decision?.sessionDate || update?.recommendationSessionDate || null;
    const targetSession = nextEgxTradingSession(recommendationSession);
    const aligned = Boolean(marketSession && recommendationSession && marketSession === recommendationSession);
    const executionGrade = priceTruth?.executionGrade === true;
    const executionEligible = Boolean(aligned && executionGrade && decision?.practicalReady === true && Array.isArray(decision?.recommendations) && decision.recommendations.length > 0);

    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
      const gradeLabel = executionEligible ? 'تنفيذ مشروط متاح' : 'التنفيذ مغلق';
      lastUpdate.textContent = `آخر تشغيل للمسح: ${formatCairo(scanAt)} · جلسة السوق: ${marketSession || '—'} · ${gradeLabel}`;
      lastUpdate.title = !aligned
        ? `جلسة السلة ${recommendationSession || '—'} لا تطابق آخر جلسة سوق موثقة ${marketSession || '—'}.`
        : executionEligible
          ? `السلة مبنية على جلسة ${recommendationSession} ومخصصة للجلسة التالية ${targetSession || '—'}. وقت تشغيل المسح لا يعني وجود جلسة تداول جديدة.`
          : `السلة مبنية على جلسة ${recommendationSession} ومخصصة للجلسة التالية ${targetSession || '—'}، لكن آخر تحقق للمصدر لم يحقق Execution Grade.`;
      lastUpdate.dataset.marketSession = marketSession || '';
      lastUpdate.dataset.recommendationSession = recommendationSession || '';
      lastUpdate.dataset.sessionAligned = String(aligned);
      lastUpdate.dataset.executionGrade = String(executionGrade);
      lastUpdate.dataset.executionEligible = String(executionEligible);
    }

    let tries = 0;
    const syncRelease = () => {
      if (ensureReleaseNote({ marketSession, recommendationSession, targetSession, aligned, executionEligible })) return;
      if (tries++ < 40) setTimeout(syncRelease, 200);
    };
    syncRelease();
  }

  async function start() {
    try {
      const [update, priceTruth, decision] = await Promise.all([
        readJson(UPDATE_URL),
        readJson(PRICE_TRUTH_URL),
        readJson(DECISION_URL)
      ]);

      let attempts = 0;
      const syncHeader = () => {
        if (document.getElementById('lastUpdate')) {
          apply(update, priceTruth, decision);
          return;
        }
        if (attempts++ < 40) setTimeout(syncHeader, 200);
      };
      syncHeader();
    } catch (error) {
      console.warn('V16 session truth UI unavailable:', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
