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

  function ensureReleaseNote({ marketSession, recommendationSession, targetSession, aligned }) {
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
    note.style.borderColor = aligned ? '#2d7358' : '#a94444';
    note.style.background = aligned ? '#0d3028' : '#3a171b';
    note.innerHTML = aligned
      ? `جلسة السوق والسلة متزامنتان: <b>${marketSession || '—'}</b> → الجلسة التالية <b>${targetSession || '—'}</b>.`
      : `تنبيه جلسة: آخر سوق موثق <b>${marketSession || '—'}</b> بينما السلة <b>${recommendationSession || '—'}</b>. السلة مرجع فقط حتى إعادة البناء.`;
    return true;
  }

  function apply(update, priceTruth, decision) {
    const scanAt = update?.sessionTruth?.scannerRunAt || update?.lastAutomaticScanAt || update?.generatedAt || null;
    const marketSession = priceTruth?.expectedSession || update?.marketSessionDate || update?.expectedLatestSession || update?.sessionDate || null;
    const recommendationSession = decision?.sessionDate || update?.recommendationSessionDate || null;
    const targetSession = nextEgxTradingSession(recommendationSession);
    const aligned = Boolean(marketSession && recommendationSession && marketSession === recommendationSession);

    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
      lastUpdate.textContent = `آخر تشغيل للمسح: ${formatCairo(scanAt)} · جلسة السوق: ${marketSession || '—'}`;
      lastUpdate.title = aligned
        ? `السلة مبنية على جلسة ${recommendationSession} ومخصصة للجلسة التالية ${targetSession || '—'}. وقت تشغيل المسح لا يعني وجود جلسة تداول جديدة.`
        : `جلسة السلة ${recommendationSession || '—'} لا تطابق آخر جلسة سوق موثقة ${marketSession || '—'}.`;
      lastUpdate.dataset.marketSession = marketSession || '';
      lastUpdate.dataset.recommendationSession = recommendationSession || '';
      lastUpdate.dataset.sessionAligned = String(aligned);
    }

    let tries = 0;
    const syncRelease = () => {
      if (ensureReleaseNote({ marketSession, recommendationSession, targetSession, aligned })) return;
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
