from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]


def replace_once(rel, old, new):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH_MARKER_NOT_FOUND:{rel}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def git_blob_sha(path):
    data = path.read_bytes()
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()

# 1) Route the monitoring feed through the existing Vercel API function.
api_helper = r'''async function sessionMonitorPayload(url) {
  const tickers = [...new Set(String(url.searchParams.get('tickers') ?? '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter((x) => /^[A-Z0-9._-]{2,12}$/.test(x)))]
    .slice(0, 10);
  if (!tickers.length) return { status: 400, body: { ok: false, error: 'tickers is required' } };
  const force = url.searchParams.get('force') === '1';
  const { fetchMubasherQuote } = await import('../monitor/session-quote.js');
  const settled = await Promise.allSettled(tickers.map((ticker) => fetchMubasherQuote(ticker, { force })));
  const quotes = [], errors = [];
  settled.forEach((result, index) => {
    const ticker = tickers[index];
    if (result.status === 'fulfilled') quotes.push(result.value);
    else {
      logInternal('SESSION_MONITOR_QUOTE_ERROR', result.reason, { ticker });
      errors.push({ ticker, error: 'QUOTE_SOURCE_UNAVAILABLE' });
    }
  });
  return {
    status: 200,
    body: {
      ok: true,
      monitor: 'SESSION_MONITOR_V1',
      generatedAt: new Date().toISOString(),
      monitorOnly: true,
      scoringImpact: 'NONE',
      recommendationMutationAllowed: false,
      executionAllowed: false,
      source: 'MUBASHER_DELAYED_15_MIN',
      delayedMinutes: 15,
      disclaimer: 'Monitoring prices update only the observed status of already-frozen RC2 candidates and never alter Alpha, Fusion Rank, hard gates, or recommendations.',
      requested: tickers.length,
      returned: quotes.length,
      quotes,
      errors,
    },
  };
}

'''
replace_once('api/index.js', 'export default async function handler(req, res) {', api_helper + 'export default async function handler(req, res) {')
replace_once(
    'api/index.js',
    "    const route = url.searchParams.get('route') ?? 'scan';\n",
    "    const route = url.searchParams.get('route') ?? 'scan';\n    if (route === 'session-monitor') {\n      const monitor = await sessionMonitorPayload(url);\n      return json(res, monitor.status, monitor.body);\n    }\n",
)

# 2) Preserve trade accounting while exposing directional target touches without an entry.
old_no_entry = r'''  if (entryIndex < 0) {
    const third = entryWindow[ENTRY_EXPIRY_SESSIONS - 1];
    const thirdStillOpen = Boolean(third?.partial);
    if (entryWindow.length >= ENTRY_EXPIRY_SESSIONS && !thirdStillOpen) return { ...base, state:'ENTRY_EXPIRED', resolved:true, entered:false };
    if (base.zone === 'IN_ENTRY_ZONE') return { ...base, state:'ENTRY_ZONE_TOUCHED', resolved:false, entered:false };
    if (base.zone === 'ABOVE_ENTRY') return { ...base, state:'WAIT_PULLBACK_ABOVE_ENTRY', resolved:false, entered:false };
    if (base.zone === 'BELOW_ENTRY') return { ...base, state:'WAIT_RECOVERY_BELOW_ENTRY', resolved:false, entered:false };
    return { ...base, state:'WAITING_FOR_ENTRY', resolved:false, entered:false };
  }
'''
new_no_entry = r'''  if (entryIndex < 0) {
    const firstT1Touch = bars.find((bar) => bar.high >= plan.target1) ?? null;
    const firstT2Touch = plan.target2 > 0 ? (bars.find((bar) => bar.high >= plan.target2) ?? null) : null;
    const noEntryTargets = {
      target1TouchedWithoutEntry: Boolean(firstT1Touch),
      target2TouchedWithoutEntry: Boolean(firstT2Touch),
      target1TouchDateWithoutEntry: firstT1Touch?.date ?? null,
      target2TouchDateWithoutEntry: firstT2Touch?.date ?? null,
    };
    const third = entryWindow[ENTRY_EXPIRY_SESSIONS - 1];
    const thirdStillOpen = Boolean(third?.partial);
    if (entryWindow.length >= ENTRY_EXPIRY_SESSIONS && !thirdStillOpen) return { ...base, ...noEntryTargets, state:'ENTRY_EXPIRED', resolved:true, entered:false };
    if (base.zone === 'IN_ENTRY_ZONE') return { ...base, ...noEntryTargets, state:'ENTRY_ZONE_TOUCHED', resolved:false, entered:false };
    if (base.zone === 'ABOVE_ENTRY') return { ...base, ...noEntryTargets, state:'WAIT_PULLBACK_ABOVE_ENTRY', resolved:false, entered:false };
    if (base.zone === 'BELOW_ENTRY') return { ...base, ...noEntryTargets, state:'WAIT_RECOVERY_BELOW_ENTRY', resolved:false, entered:false };
    return { ...base, ...noEntryTargets, state:'WAITING_FOR_ENTRY', resolved:false, entered:false };
  }
'''
replace_once('public/session-monitor-core.js', old_no_entry, new_no_entry)

# 3) Make the live panel and evidence tab state the forward result plainly.
old_load_quotes = r'''async function loadQuotes(tickers, force = false) {
  const q = new URLSearchParams({ tickers:tickers.join(','), t:String(Date.now()) });
  if (force) q.set('force','1');
  const response = await fetch(`/api/session-monitor?${q}`, { cache:'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `MONITOR_HTTP_${response.status}`);
  return data;
}
'''
new_load_quotes = r'''async function loadQuotes(tickers, force = false) {
  const q = new URLSearchParams({ route:'session-monitor', tickers:tickers.join(','), t:String(Date.now()) });
  if (force) q.set('force','1');
  const response = await fetch(`/api/index?${q}`, { cache:'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `MONITOR_HTTP_${response.status}`);
  return data;
}
'''
replace_once('public/session-monitor.js', old_load_quotes, new_load_quotes)

summary_helpers = r'''function outcomeSummary(results) {
  const rows = Array.isArray(results) ? results : [];
  const total = rows.length;
  const achieved = rows.filter((r) => r.entered && ['TARGET1_REACHED','TARGET2_REACHED'].includes(r.state)).length;
  const entered = rows.filter((r) => r.entered).length;
  const missedEntry = rows.filter((r) => !r.entered).length;
  const targetsWithoutEntry = rows.filter((r) => !r.entered && (r.target1TouchedWithoutEntry || r.target2TouchedWithoutEntry)).length;
  return { total, achieved, entered, missedEntry, targetsWithoutEntry, achievedPct: total ? achieved / total * 100 : null };
}

function outcomeLabel(value) {
  const map = {
    TARGET1_REACHED:'حقق T1 بعد الدخول', TARGET2_REACHED:'حقق T2 بعد الدخول',
    TARGET1_WITHOUT_ENTRY:'لم يدخل · لمس T1', TARGET2_WITHOUT_ENTRY:'لم يدخل · لمس T1 وT2',
    POSITION_OPEN:'دخول مُفعّل · مفتوحة', STOP:'Stop', STOP_SAME_BAR:'Stop First',
    ENTRY_EXPIRED:'انتهت مهلة الدخول', WAIT_PULLBACK_ABOVE_ENTRY:'لم يدخل · فوق منطقة الدخول',
    WAIT_RECOVERY_BELOW_ENTRY:'لم يدخل · أسفل منطقة الدخول', ENTRY_ZONE_TOUCHED:'منطقة الدخول لُمست', WAITING_FOR_ENTRY:'انتظار الدخول', TIME_EXIT:'خروج زمني'
  };
  return map[value] || value || 'OPEN';
}

function archiveOutcome(result) {
  if (result.entered) return result.state;
  if (result.target2TouchedWithoutEntry) return 'TARGET2_WITHOUT_ENTRY';
  if (result.target1TouchedWithoutEntry) return 'TARGET1_WITHOUT_ENTRY';
  return result.state || 'OPEN';
}

function syncArchiveOutcomes(results) {
  try {
    const archive = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    if (!Array.isArray(archive) || !archive.length) return;
    let changed = false;
    for (const result of Array.isArray(results) ? results : []) {
      const row = archive.find((x) => x.sessionDate === result.signalDate && x.ticker === result.ticker);
      if (!row) continue;
      const next = {
        outcome:archiveOutcome(result), entered:Boolean(result.entered), entryDate:result.entryDate ?? null, entryPrice:result.entryPrice ?? null,
        target1TouchedWithoutEntry:Boolean(result.target1TouchedWithoutEntry), target2TouchedWithoutEntry:Boolean(result.target2TouchedWithoutEntry),
        target1TouchDateWithoutEntry:result.target1TouchDateWithoutEntry ?? null, target2TouchDateWithoutEntry:result.target2TouchDateWithoutEntry ?? null,
        outcomeUpdatedAt:new Date().toISOString(),
      };
      if (Object.entries(next).some(([k,v]) => JSON.stringify(row[k]) !== JSON.stringify(v))) {
        Object.assign(row, next); changed = true;
      }
    }
    if (changed) localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
  } catch {}
}

function renderEvidenceOutcomeSummary(results) {
  const host = document.getElementById('liveEvidenceSummary');
  if (!host || !Array.isArray(results) || !results.length) return;
  const s = outcomeSummary(results);
  host.innerHTML = [
    ['تحقق فعلي بعد الدخول', `${s.achieved}/${s.total}`, s.achievedPct === null ? '—' : `${pct(s.achievedPct)} من توصيات الجلسة`],
    ['دخلت الصفقة فعليًا', `${s.entered}/${s.total}`, 'يُحتسب النجاح فقط بعد تفعيل Entry'],
    ['لم يتفعل الدخول', `${s.missedEntry}/${s.total}`, s.targetsWithoutEntry ? `${s.targetsWithoutEntry} منها لمس الأهداف بدون دخول` : 'لا تُحتسب كصفقة ناجحة'],
  ].map((x) => `<div class="summary-card"><small>${esc(x[0])}</small><b>${esc(x[1])}</b><span>${esc(x[2])}</span></div>`).join('');

  try {
    const archive = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    const session = [...new Set((Array.isArray(archive) ? archive : []).map((x) => x.sessionDate).filter(Boolean))].sort().at(-1);
    const rows = (Array.isArray(archive) ? archive : []).filter((x) => x.sessionDate === session);
    const body = document.getElementById('evaluationRows');
    if (body && rows.length) body.innerHTML = rows.map((x) => `<tr><td>${esc(x.sessionDate)}</td><td>${esc(x.ticker)}</td><td><b>${esc(outcomeLabel(x.outcome))}</b></td><td>${fmt(x.entryLow,3)}–${fmt(x.entryHigh,3)}</td><td>${fmt(x.target1,3)}</td><td>${fmt(x.stop,3)}</td><td>${fmt(x.fusionRank,1)}</td><td>${x.wilson == null ? '—' : pct(x.wilson)}</td></tr>`).join('');
  } catch {}
}

'''
replace_once('public/session-monitor.js', 'function freshnessSummary(results) {', summary_helpers + 'function freshnessSummary(results) {')

style_old = "    #${PANEL_ID} .sm-source{margin:13px 0;padding:11px 13px;border:1px solid #24566a;border-radius:12px;background:#081b26;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px}\n"
style_new = style_old + "    #${PANEL_ID} .sm-outcome-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 13px}#${PANEL_ID} .sm-kpi{padding:11px 12px;border:1px solid #24566a;border-radius:11px;background:#071823}#${PANEL_ID} .sm-kpi small{display:block;color:#8eacbc;font-size:10px;margin-bottom:4px}#${PANEL_ID} .sm-kpi b{display:block;font-size:21px}#${PANEL_ID} .sm-kpi span{font-size:11px;color:#b7ced9}\n"
replace_once('public/session-monitor.js', style_old, style_new)
replace_once(
    'public/session-monitor.js',
    "    @media(max-width:980px){#${PANEL_ID} .sm-grid{grid-template-columns:1fr}}\n",
    "    @media(max-width:980px){#${PANEL_ID} .sm-grid,#${PANEL_ID} .sm-outcome-summary{grid-template-columns:1fr}}\n",
)

replace_once(
    'public/session-monitor.js',
    "  const [summary, summaryCls] = freshnessSummary(results);\n",
    "  const [summary, summaryCls] = freshnessSummary(results);\n  const outcome = outcomeSummary(results);\n",
)
replace_once(
    'public/session-monitor.js',
    "    <div class=\"sm-source\"><span>${esc(phaseLabel)} · القاهرة ${esc(phase.time)}</span><span>آخر جلب: ${lastGeneratedAt ? esc(new Date(lastGeneratedAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})) : '—'} · Poll 5m · Source delay 15m</span></div>\n",
    "    <div class=\"sm-source\"><span>${esc(phaseLabel)} · القاهرة ${esc(phase.time)}</span><span>آخر جلب: ${lastGeneratedAt ? esc(new Date(lastGeneratedAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})) : '—'} · Poll 5m · Source delay 15m</span></div>\n    ${results.length ? `<div class=\"sm-outcome-summary\"><div class=\"sm-kpi\"><small>تحقق فعلي بعد الدخول</small><b>${outcome.achieved}/${outcome.total}</b><span>${outcome.achievedPct === null ? '—' : pct(outcome.achievedPct)} من توصيات الجلسة</span></div><div class=\"sm-kpi\"><small>دخلت فعليًا</small><b>${outcome.entered}/${outcome.total}</b><span>النجاح لا يُحتسب قبل Entry</span></div><div class=\"sm-kpi\"><small>لم يتفعل الدخول</small><b>${outcome.missedEntry}/${outcome.total}</b><span>${outcome.targetsWithoutEntry ? `${outcome.targetsWithoutEntry} لمس الأهداف بدون دخول` : '—'}</span></div></div>` : ''}\n",
)
replace_once(
    'public/session-monitor.js',
    "        const entered = result.entered ? `دخول ${fmt(result.entryPrice,4)} · ${esc(result.entryDate)}` : `منطقة ${fmt(result.entryLow,4)}–${fmt(result.entryHigh,4)}`;\n",
    "        const entered = result.entered ? `دخول ${fmt(result.entryPrice,4)} · ${esc(result.entryDate)}` : `منطقة ${fmt(result.entryLow,4)}–${fmt(result.entryHigh,4)}`;\n        const noEntryTargetNote = !result.entered && result.target2TouchedWithoutEntry ? 'لم يتفعل الدخول · لكن السعر لمس T1 وT2 بدون دخول' : !result.entered && result.target1TouchedWithoutEntry ? 'لم يتفعل الدخول · لكن السعر لمس T1 بدون دخول' : '';\n",
)
replace_once(
    'public/session-monitor.js',
    "          <div class=\"sm-note\"><b>${esc(fresh.labelAr || 'حالة المصدر غير معروفة')}</b>${fresh.ageMinutes !== undefined ? ` · عمر السعر ${esc(fresh.ageMinutes)} دقيقة` : ''}<br>لا تنفيذ آلي · لا تعديل للتوصية · STOP_FIRST عند غموض نفس الجلسة.</div>\n",
    "          <div class=\"sm-note\"><b>${esc(fresh.labelAr || 'حالة المصدر غير معروفة')}</b>${fresh.ageMinutes !== undefined ? ` · عمر السعر ${esc(fresh.ageMinutes)} دقيقة` : ''}${noEntryTargetNote ? `<br><b>${esc(noEntryTargetNote)}</b>` : ''}<br>لا تنفيذ آلي · لا تعديل للتوصية · STOP_FIRST عند غموض نفس الجلسة.</div>\n",
)
replace_once(
    'public/session-monitor.js',
    "  window.__RC2_SESSION_MONITOR_LAST__ = detail;\n  window.dispatchEvent(new CustomEvent('rc2:session-monitor', { detail }));\n",
    "  syncArchiveOutcomes(detail.results);\n  renderEvidenceOutcomeSummary(detail.results);\n  window.__RC2_SESSION_MONITOR_LAST__ = detail;\n  window.dispatchEvent(new CustomEvent('rc2:session-monitor', { detail }));\n",
)
replace_once(
    'public/session-monitor.js',
    "window.addEventListener('storage', event => {\n  if (event.key === ARCHIVE_KEY) refresh(true);\n});\n",
    "window.addEventListener('storage', event => {\n  if (event.key === ARCHIVE_KEY) refresh(true);\n});\ndocument.querySelector('[data-view=\"evidence\"]')?.addEventListener('click', () => setTimeout(() => renderEvidenceOutcomeSummary(lastResults), 30));\n",
)

# 4) Regression tests for the exact COPR-type case and the unified API route.
test_insert = r'''test('missed entry can still record directional T1/T2 touches without counting a trade', () => {
  const signal = { sessionDate:'2026-08-19', ticker:'COPR', price:0.48, entryLow:0.4567, entryHigh:0.4655, stop:0.4404, target1:0.4879, target2:0.5167 };
  const history = [{date:'2026-08-20',open:0.48,high:0.55,low:0.47,close:0.52}];
  const r = evaluateFrozenCandidate(signal, history, null, new Date('2026-08-21T16:00:00Z'));
  assert.equal(r.entered, false);
  assert.equal(r.target1TouchedWithoutEntry, true);
  assert.equal(r.target2TouchedWithoutEntry, true);
  assert.equal(r.target1TouchDateWithoutEntry, '2026-08-20');
  assert.equal(r.target2TouchDateWithoutEntry, '2026-08-20');
});

'''
replace_once('test/session-monitor.test.js', "test('candidate monitor never enters on the signal session', () => {", test_insert + "test('candidate monitor never enters on the signal session', () => {")
replace_once(
    'test/session-monitor.test.js',
    "  assert.ok(client.includes('/api/session-monitor?'));\n",
    "  assert.ok(client.includes(\"route:'session-monitor'\"));\n  assert.equal(client.includes('/api/session-monitor?'), false);\n",
)

# 5) Refresh frozen byte hashes only for intentionally changed runtime files.
contract = ROOT / 'stability/frozen-runtime-contract.js'
text = contract.read_text(encoding='utf-8')
text = text.replace("contractVersion: '1.3.0'", "contractVersion: '1.4.0'", 1)
for rel in ['api/index.js', 'public/session-monitor-core.js', 'public/session-monitor.js']:
    sha = git_blob_sha(ROOT / rel)
    import re
    pattern = rf"('{re.escape(rel)}':\s*')[a-f0-9]{{40}}(')"
    text, count = re.subn(pattern, rf"\g<1>{sha}\g<2>", text, count=1)
    if count != 1:
        raise SystemExit(f'CONTRACT_HASH_MARKER_NOT_FOUND:{rel}')
contract.write_text(text, encoding='utf-8')

print('LIVE_SUMMARY_PATCH_APPLIED')
for rel in ['api/index.js','public/session-monitor-core.js','public/session-monitor.js']:
    print(rel, git_blob_sha(ROOT / rel))
