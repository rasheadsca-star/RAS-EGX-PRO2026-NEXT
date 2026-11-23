export function evaluate(sessions) {
  const portfolios = [0, 1].map(() => ({ balance: 1, peak: 1, drawdown: 0, trades: 0 }));
  let previous = '', pending = false;
  return sessions.map(s => {
    if (pending || !(s.sourceDate < s.tradeDate && s.tradeDate > previous) ||
        !(Number.isFinite(s.entry) && s.entry > 0) ||
        ![s.advances, s.declines, s.unchanged].every(n => Number.isInteger(n) && n >= 0) ||
        !(s.advances + s.declines + s.unchanged > 0)) throw Error('سجل الجلسة غير صالح');
    previous = s.tradeDate;
    const allowed = s.advances > s.declines;
    const o = s.outcome;
    pending = o === null;
    if (!pending && (o.date !== s.tradeDate || o.symbol !== s.symbol ||
        ![o.low,o.close,o.high].every(n => Number.isFinite(n) && n > 0) ||
        !(o.low <= o.close && o.close <= o.high))) throw Error('بيانات الإغلاق غير متطابقة');
    const strategies = portfolios.map((p, i) => {
      const active = !i || allowed;
      const entered = !pending && active && o.low <= s.entry && s.entry <= o.high;
      const daily = pending ? null : entered ? o.close / s.entry - 1 : 0;
      if (entered) p.trades++;
      if (!pending) {
        p.balance *= 1 + daily;
        p.peak = Math.max(p.peak, p.balance);
        p.drawdown = Math.max(p.drawdown, 1 - p.balance / p.peak);
      }
      return { ...p, active, daily };
    });
    return { session: s, strategies };
  });
}

async function render(panel) {
  const response = await fetch(new URL('./breadth-forward.json', import.meta.url), {cache:'no-store'});
  if (!response.ok) throw Error();
  const ledger = await response.json();
  const pct = n => (100*n).toFixed(2)+'%';
  const body = panel.querySelector('tbody');
  const history = evaluate(ledger.sessions);
  for (const {session:s, strategies} of history) {
    strategies.forEach((p, i) => {
      const row = body.insertRow();
      const cells = [s.tradeDate, i ? 'بشرط اتساع السوق' : 'الأساسية', p.active ? s.symbol+' عند '+s.entry.toFixed(2) : 'نقدًا',
        p.daily === null ? 'بانتظار الإغلاق' : pct(p.daily), pct(p.balance-1), pct(p.drawdown), p.trades];
      for (const value of cells) row.insertCell().textContent = value;
    });
  }
  const {session:s} = history.at(-1);
  panel.querySelector('[data-breadth]').textContent = 'نشرة '+s.sourceDate+' · الأسهم المؤهلة بالجنيه: '+s.advances+' صاعدة، '+s.declines+' هابطة، '+s.unchanged+' ثابتة.';
}
if (typeof document !== 'undefined') {
  const panel = document.querySelector('#breadth-forward');
  if (panel) render(panel).catch(() => { panel.querySelector('[data-breadth]').textContent='تعذّر تحميل سجل المقارنة.'; });
}
