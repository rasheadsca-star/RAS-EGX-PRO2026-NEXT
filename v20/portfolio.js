(() => {
  'use strict';

  const core = window.V20PortfolioCore;
  if (!core) return;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[ch]));
  const numeric = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  const num = (value, digits = 2) => { const n = numeric(value); return n === null ? '—' : n.toLocaleString('ar-EG', { maximumFractionDigits: digits }); };
  const pct = value => numeric(value) === null ? '—' : `${num(value, 1)}%`;
  const money = value => numeric(value) === null ? '—' : num(value, 4);

  const riskAr = code => ({
    NO_CURRENT_SESSION_PRICE:'لا يوجد سعر موثوق للجلسة الحالية',
    SOURCE_CONFLICT:'يوجد تعارض مصدر مسجل',
    CURRENT_DATA_QUALITY_PARTIAL:'جودة بيانات الجلسة جزئية',
    GLOBAL_EXECUTION_GATE_CLOSED:'بوابة التنفيذ العامة مغلقة',
    REFERENCE_STOP_LEVEL_REACHED_OR_BREACHED:'السعر عند/دون وقف الخطة المرجعية',
    REFERENCE_TARGET1_REACHED_OR_EXCEEDED:'السعر بلغ/تجاوز الهدف الأول المرجعي'
  }[code] || code);

  const state = {
    marketExplorer: null,
    current: null,
    holdings: [],
  };

  async function json(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  function loadHoldings() {
    try {
      const raw = JSON.parse(localStorage.getItem(core.STORAGE_KEY) || '[]');
      state.holdings = Array.isArray(raw)
        ? raw.map(item => core.normalizeHolding(item)).filter(x => x.ok).map(x => x.holding)
        : [];
    } catch {
      state.holdings = [];
    }
  }

  function persistHoldings() {
    localStorage.setItem(core.STORAGE_KEY, JSON.stringify(state.holdings));
  }

  function marketMap() {
    return new Map((state.marketExplorer?.rows || []).map(row => [row.ticker, row]));
  }

  function opportunityMap() {
    return new Map((state.current?.opportunities || []).map(row => [row.ticker, row]));
  }

  function evaluateAll() {
    const market = marketMap();
    const opportunities = opportunityMap();
    return state.holdings.map(holding => core.evaluateHolding(
      holding,
      market.get(holding.ticker) || null,
      opportunities.get(holding.ticker) || null,
      state.current?.executionStatus || 'BLOCKED'
    ));
  }

  function message(text, kind = 'info') {
    const box = $('portfolioMessage');
    box.textContent = text;
    box.className = `portfolio-message portfolio-message-${kind}`;
    box.classList.remove('hidden');
  }

  function clearMessage() {
    $('portfolioMessage').classList.add('hidden');
    $('portfolioMessage').textContent = '';
  }

  function populateSymbols() {
    const list = $('portfolioSymbols');
    list.innerHTML = '';
    for (const row of state.marketExplorer?.rows || []) {
      const option = document.createElement('option');
      option.value = row.ticker;
      option.label = row.nameAr || row.nameEn || row.ticker;
      list.appendChild(option);
    }
  }

  function renderSummary(items) {
    const aggregate = core.aggregateEvaluations(items);
    $('portfolioCost').textContent = money(aggregate.totalCostBasis);
    $('portfolioValue').textContent = aggregate.pricedCount ? money(aggregate.pricedCurrentValue) : '—';
    $('portfolioPnl').textContent = aggregate.pricedCount ? `${money(aggregate.pricedPnl)} (${pct(aggregate.pricedPnlPct)})` : '—';
    $('portfolioCoverage').textContent = `${num(aggregate.pricedCount, 0)} / ${num(aggregate.holdingCount, 0)}`;
    $('portfolioPnl').className = aggregate.pricedPnl > 0 ? 'pnl-positive' : aggregate.pricedPnl < 0 ? 'pnl-negative' : '';
  }

  function referenceLabel(item) {
    if (!item.v20ReferenceStatus) return 'سوق فقط — لا توجد توصية حالية';
    const map = { ACTIONABLE:'قابل للتنفيذ', WATCH:'مراقبة', WAIT:'انتظار', AVOID:'تجنب' };
    return `V20: ${map[item.v20ReferenceStatus] || item.v20ReferenceStatus}${item.v20ReferenceRank ? ` (#${item.v20ReferenceRank})` : ''}`;
  }

  function renderRows(items) {
    const tbody = $('portfolioRows');
    const cards = $('portfolioCards');
    tbody.innerHTML = '';
    cards.innerHTML = '';

    const empty = items.length === 0;
    $('portfolioEmpty').classList.toggle('hidden', !empty);
    $('portfolioTableWrap').classList.toggle('hidden', empty);
    cards.classList.toggle('hidden', empty);
    if (empty) return;

    const weights = core.portfolioWeights(items);

    for (const item of items) {
      if (!item.ok) continue;
      const riskText = item.riskFlags.length ? item.riskFlags.map(riskAr).join(' • ') : 'لا توجد إشارات مخاطر إضافية مسجلة';
      const pnlClass = Number(item.pnl) > 0 ? 'pnl-positive' : Number(item.pnl) < 0 ? 'pnl-negative' : '';
      const monitor = item.monitoringState === 'OWNED_POSITION_REVIEW_REQUIRED' ? 'مراجعة مطلوبة' : 'متابعة';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="symbol-cell"><strong>${esc(item.ticker)}</strong><small>${esc(referenceLabel(item))}</small></td>
        <td>${money(item.averageBuyPrice)}</td>
        <td>${num(item.quantity, 4)}</td>
        <td>${money(item.costBasis)}</td>
        <td>${item.currentSessionPriced ? money(item.currentPrice) : '<span class="muted">غير متاح</span>'}</td>
        <td>${item.currentSessionPriced ? money(item.currentValue) : '—'}</td>
        <td class="${pnlClass}">${item.currentSessionPriced ? money(item.pnl) : '—'}</td>
        <td class="${pnlClass}">${item.currentSessionPriced ? pct(item.pnlPct) : '—'}</td>
        <td>${weights[item.ticker] == null ? '—' : pct(weights[item.ticker])}</td>
        <td><span class="portfolio-monitor ${item.monitoringState === 'OWNED_POSITION_REVIEW_REQUIRED' ? 'portfolio-review' : ''}">${esc(monitor)}</span></td>
        <td class="portfolio-risk-cell">${esc(riskText)}</td>
        <td><button class="portfolio-delete" type="button" data-ticker="${esc(item.ticker)}">حذف</button></td>`;
      tbody.appendChild(tr);

      const card = document.createElement('article');
      card.className = 'portfolio-card';
      card.innerHTML = `
        <div class="portfolio-card-head">
          <div><strong>${esc(item.ticker)}</strong><small>${esc(referenceLabel(item))}</small></div>
          <button class="portfolio-delete" type="button" data-ticker="${esc(item.ticker)}">حذف</button>
        </div>
        <div class="portfolio-card-grid">
          <div><span>متوسط الشراء</span><strong>${money(item.averageBuyPrice)}</strong></div>
          <div><span>الكمية</span><strong>${num(item.quantity, 4)}</strong></div>
          <div><span>السعر الحالي</span><strong>${item.currentSessionPriced ? money(item.currentPrice) : 'غير متاح'}</strong></div>
          <div><span>P&L</span><strong class="${pnlClass}">${item.currentSessionPriced ? `${money(item.pnl)} / ${pct(item.pnlPct)}` : '—'}</strong></div>
          <div><span>الوزن الحالي</span><strong>${weights[item.ticker] == null ? '—' : pct(weights[item.ticker])}</strong></div>
          <div><span>المتابعة</span><strong>${esc(monitor)}</strong></div>
        </div>
        <p class="portfolio-risk-note">${esc(riskText)}</p>`;
      cards.appendChild(card);
    }

    document.querySelectorAll('.portfolio-delete').forEach(button => {
      button.addEventListener('click', () => removeHolding(button.dataset.ticker));
    });
  }

  function render() {
    const items = evaluateAll();
    renderSummary(items);
    renderRows(items);
    const gateClosed = state.current?.executionStatus !== 'EXECUTION_GRADE';
    $('portfolioGateNote').textContent = gateClosed
      ? 'بوابة V17 الحالية لا تمنح Execution Grade. المحفظة تعرض متابعة مراكز مملوكة فقط ولا تنشئ أوامر شراء/بيع.'
      : 'حتى مع Execution Grade، المحفظة أداة متابعة فقط ولا تنشئ أوامر شراء/بيع تلقائية.';
  }

  function removeHolding(ticker) {
    const normalized = core.normalizeTicker(ticker);
    state.holdings = state.holdings.filter(item => item.ticker !== normalized);
    persistHoldings();
    render();
    message(`تم حذف ${normalized} من المحفظة المحلية.`, 'success');
  }

  function upsertHolding(input) {
    const normalized = core.normalizeHolding(input);
    if (!normalized.ok) {
      message('أدخل كود سهم صحيحًا ومتوسط شراء وكمية أكبر من صفر.', 'error');
      return;
    }
    const h = normalized.holding;
    const row = marketMap().get(h.ticker);
    if (!row) {
      message('الكود غير موجود في Market Explorer الحالي.', 'error');
      return;
    }
    const index = state.holdings.findIndex(item => item.ticker === h.ticker);
    if (index >= 0) state.holdings[index] = h;
    else state.holdings.push(h);
    persistHoldings();
    render();
    $('portfolioForm').reset();
    message(index >= 0 ? `تم تحديث ${h.ticker}.` : `تمت إضافة ${h.ticker} إلى محفظتك المحلية.`, 'success');
  }

  async function init() {
    try {
      const [marketExplorer, current] = await Promise.all([
        json('../data/v20/market-explorer.json'),
        json('../data/v20/current.json'),
      ]);
      state.marketExplorer = marketExplorer;
      state.current = current;
      loadHoldings();
      populateSymbols();
      render();
      $('portfolioLoading').classList.add('hidden');
      $('portfolioContent').classList.remove('hidden');
    } catch (error) {
      $('portfolioLoading').classList.add('hidden');
      $('portfolioError').classList.remove('hidden');
      $('portfolioError').textContent = `تعذر تحميل محفظتي: ${error.message}`;
    }
  }

  $('portfolioForm').addEventListener('submit', event => {
    event.preventDefault();
    clearMessage();
    upsertHolding({
      ticker: $('portfolioTicker').value,
      averageBuyPrice: $('portfolioBuyPrice').value,
      quantity: $('portfolioQuantity').value,
    });
  });

  init();
})();
