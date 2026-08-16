const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
}

async function loadStatus() {
  const response = await fetch('/api/status', { cache: 'no-store' });
  const status = await response.json();
  const badge = $('sourceBadge');
  if (status.configured && status.ledgerValid) {
    badge.textContent = 'LSEG مرخّص · جاهز';
    badge.className = 'badge good';
    $('providerState').textContent = 'Credentials موجودة. لا يوجد أي مصدر احتياطي أو scraping.';
  } else {
    badge.textContent = 'Fail Closed · لا بيانات';
    badge.className = 'badge bad';
    $('providerState').textContent = status.configured
      ? 'المصدر مهيأ لكن سلامة الـledger تحتاج مراجعة.'
      : 'لا توجد credentials مرخّصة. النظام لن يعرض أسعارًا بديلة أو قديمة.';
  }
}

function renderAnalysis(data, ok) {
  if (!ok) {
    $('analysisResult').innerHTML = `
      <div class="blocked"><b>NO_RECOMMENDATION</b></div>
      <p>${esc(data.message || data.error)}</p>
      <div class="muted">Fail Closed: ${esc(data.error)}</div>`;
    return;
  }

  const ci = data.confidenceInterval95Pct;
  const backtest = data.backtest || {};
  const source = data.source || {};
  const features = data.features || {};

  $('analysisResult').innerHTML = `
    <div class="${data.decision === 'NO_RECOMMENDATION' ? 'blocked' : 'ok'}">
      <b>${esc(data.decision)}</b> · score ${esc(data.score)}
    </div>
    <div class="kv">
      <div><span class="muted">السعر</span><b>${esc(data.latestPrice?.value)}</b><small>${esc(data.latestPrice?.asOf)}</small></div>
      <div><span class="muted">المصدر</span><b>${esc(source.provider)}</b><small>${esc(source.mode)}</small></div>
      <div><span class="muted">Backtest</span><b>${esc(backtest.winRatePct)}%</b><small>${esc(backtest.directionalTrades)} trades · ${esc(backtest.spanYears)} years</small></div>
      <div><span class="muted">95% CI</span><b>${ci ? `${esc(ci.lowPct)}–${esc(ci.highPct)}%` : '—'}</b><small>Wilson interval</small></div>
    </div>
    <div class="kv">
      <div><span class="muted">SMA 30%</span><b>${esc(features.componentScores?.smaTrend)}</b></div>
      <div><span class="muted">RSI 25%</span><b>${esc(features.componentScores?.rsi14)}</b></div>
      <div><span class="muted">ATR 20%</span><b>${esc(features.componentScores?.atr14Risk)}</b></div>
      <div><span class="muted">Momentum 25%</span><b>${esc(features.componentScores?.momentum20)}</b></div>
    </div>
    <p class="muted">asOf: ${esc(source.asOf)} · receivedAt: ${esc(source.receivedAt)} · source: ${esc(source.provider)}</p>
    ${data.reasonCodes?.length ? `<p class="blocked">Blocked by: ${data.reasonCodes.map(esc).join(', ')}</p>` : ''}
    ${data.ledger ? `<p class="muted">Ledger #${esc(data.ledger.sequence)} · ${esc(data.ledger.entryHash).slice(0, 16)}…</p>` : ''}
  `;
}

async function loadLedger() {
  const target = $('ledger');
  try {
    const response = await fetch('/api/ledger', { cache: 'no-store' });
    const data = await response.json();
    const entries = data.entries || [];
    if (!entries.length) {
      target.textContent = 'السجل فارغ حتى الآن. لا توجد توصيات BUY/SELL موثقة.';
      target.className = 'result empty';
      return;
    }
    target.className = 'result';
    target.innerHTML = `
      <table>
        <thead><tr><th>#</th><th>وقت التسجيل</th><th>RIC</th><th>القرار</th><th>السعر/التاريخ</th><th>Hash</th></tr></thead>
        <tbody>${entries.slice().reverse().map((entry) => `
          <tr>
            <td>${esc(entry.sequence)}</td>
            <td>${esc(entry.recordedAt)}</td>
            <td>${esc(entry.payload?.instrument)}</td>
            <td>${esc(entry.payload?.decision)}</td>
            <td>${esc(entry.payload?.latestPrice?.value)} @ ${esc(entry.payload?.source?.asOf)}</td>
            <td>${esc(entry.entryHash).slice(0, 16)}…</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch {
    target.innerHTML = '<span class="blocked">تعذر التحقق من الـledger. تم الإغلاق الآمن.</span>';
  }
}

$('analysisForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const target = $('analysisResult');
  target.className = 'result';
  target.textContent = 'جارٍ التحقق من المصدر والـbacktest...';
  try {
    const response = await fetch('/api/analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ric: $('ric').value.trim(), horizon: $('horizon').value }),
    });
    const data = await response.json();
    renderAnalysis(data, response.ok);
    await loadLedger();
  } catch {
    target.innerHTML = '<span class="blocked">فشل الاتصال. لا توجد توصية.</span>';
  }
});

$('refreshLedger').addEventListener('click', loadLedger);
await Promise.all([loadStatus(), loadLedger()]);
