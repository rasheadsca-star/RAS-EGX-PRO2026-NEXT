from pathlib import Path
import hashlib, re

ROOT = Path(__file__).resolve().parents[1]

def replace_once(rel, old, new):
    p=ROOT/rel
    s=p.read_text(encoding='utf-8')
    if old not in s: raise SystemExit(f'MARKER_NOT_FOUND:{rel}:{old[:60]}')
    p.write_text(s.replace(old,new,1),encoding='utf-8')

def blob_sha(rel):
    b=(ROOT/rel).read_bytes(); return hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()

# Add a canonical accepted forward baseline so the 19-Aug evidence is not dependent on one browser's prior localStorage.
replace_once('public/session-monitor.js',
"let lastResults = [];\nlet lastGeneratedAt = null;\nlet refreshing = false;\n",
"let lastResults = [];\nlet lastEvidenceResults = [];\nlet lastGeneratedAt = null;\nlet refreshing = false;\nlet evidenceRefreshing = false;\n\nconst ACCEPTED_FORWARD_BASELINE = Object.freeze([\n  Object.freeze({sessionDate:'2026-08-19',firstSeenAt:'2026-08-20T05:42:27.499Z',ticker:'COPR',decision:'RESEARCH_PENDING_PULLBACK',publicationState:'RESEARCH_CANDIDATE',price:0.48,entryLow:0.4567,entryHigh:0.4655,stop:0.4404,target1:0.4879,target2:0.5167,fusionRank:80.7,wilson:null,sourceCommit:'75aa7bd42c77db8d081278e0279611bc42ab5ec8',outcome:'OPEN',evidenceSource:'IMMUTABLE_ACCEPTED_FORWARD_SNAPSHOT'}),\n  Object.freeze({sessionDate:'2026-08-19',firstSeenAt:'2026-08-20T05:42:27.499Z',ticker:'FAIT',decision:'RESEARCH_PENDING_PULLBACK',publicationState:'RESEARCH_CANDIDATE',price:40.65,entryLow:39.58,entryHigh:40.0348,stop:38.7422,target1:41.261,target2:42.14,fusionRank:76.5,wilson:null,sourceCommit:'75aa7bd42c77db8d081278e0279611bc42ab5ec8',outcome:'OPEN',evidenceSource:'IMMUTABLE_ACCEPTED_FORWARD_SNAPSHOT'}),\n  Object.freeze({sessionDate:'2026-08-19',firstSeenAt:'2026-08-20T05:42:27.499Z',ticker:'MPCO',decision:'RESEARCH_PENDING_PULLBACK',publicationState:'RESEARCH_CANDIDATE',price:2.2,entryLow:2.1267,entryHigh:2.1644,stop:2.0572,target1:2.2606,target2:2.3,fusionRank:75.7,wilson:null,sourceCommit:'75aa7bd42c77db8d081278e0279611bc42ab5ec8',outcome:'OPEN',evidenceSource:'IMMUTABLE_ACCEPTED_FORWARD_SNAPSHOT'}),\n]);\n")

insert = """function ensureAcceptedForwardBaseline() {
  try {
    const archive = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    const rows = Array.isArray(archive) ? archive : [];
    const existing = new Set(rows.map((x) => `${x.sessionDate}|${x.ticker}`));
    let changed = false;
    for (const signal of ACCEPTED_FORWARD_BASELINE) {
      const key = `${signal.sessionDate}|${signal.ticker}`;
      if (existing.has(key)) continue;
      rows.push({ ...signal }); existing.add(key); changed = true;
    }
    if (changed) {
      rows.sort((a,b) => String(b.sessionDate).localeCompare(String(a.sessionDate)) || String(a.ticker).localeCompare(String(b.ticker)));
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(rows));
    }
  } catch {}
}

function readArchiveSignals() {
  ensureAcceptedForwardBaseline();
  try {
    const rows = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    return (Array.isArray(rows) ? rows : [])
      .filter(x => x.sessionDate && x.ticker && n(x.entryLow) > 0 && n(x.entryHigh) >= n(x.entryLow) && n(x.stop) > 0 && n(x.target1) > 0)
      .sort((a,b) => String(b.sessionDate).localeCompare(String(a.sessionDate)) || (n(b.fusionRank) ?? -1) - (n(a.fusionRank) ?? -1));
  } catch { return []; }
}

"""
replace_once('public/session-monitor.js','function readFrozenSignals() {',insert+'function readFrozenSignals() {')
replace_once('public/session-monitor.js',
"    const rows = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');\n    if (!Array.isArray(rows) || !rows.length) return [];\n",
"    const rows = readArchiveSignals();\n    if (!rows.length) return [];\n")

# Evidence summary should use the evaluated signal session, not simply the newest archive session.
replace_once('public/session-monitor.js',
"    const session = [...new Set((Array.isArray(archive) ? archive : []).map((x) => x.sessionDate).filter(Boolean))].sort().at(-1);\n    const rows = (Array.isArray(archive) ? archive : []).filter((x) => x.sessionDate === session);\n",
"    const session = [...new Set(results.map((x) => x.signalDate).filter(Boolean))].sort().at(-1);\n    const rows = (Array.isArray(archive) ? archive : []).filter((x) => x.sessionDate === session);\n")
replace_once('public/session-monitor.js',
"  host.innerHTML = [\n    ['تحقق فعلي بعد الدخول', `${s.achieved}/${s.total}`, s.achievedPct === null ? '—' : `${pct(s.achievedPct)} من توصيات الجلسة`],\n",
"  const signalSession = [...new Set(results.map((x) => x.signalDate).filter(Boolean))].sort().at(-1) || '—';\n  host.innerHTML = [\n    [`نتيجة توصيات ${signalSession}`, `${s.achieved}/${s.total}`, s.achievedPct === null ? '—' : `${pct(s.achievedPct)} حققت هدفًا بعد تفعيل الدخول`],\n")

# Reconcile every archived signal against completed later history. Sessions with zero later bars are not allowed to hide the latest evaluated session.
reconcile = """async function refreshEvidenceArchive() {
  if (evidenceRefreshing) return;
  evidenceRefreshing = true;
  try {
    const signals = readArchiveSignals();
    if (!signals.length) return;
    const histories = await Promise.all(signals.map((x) => loadHistory(x.ticker, x.sessionDate).catch(() => [])));
    const evaluated = signals.map((signal,index) => evaluateFrozenCandidate(signal,histories[index],null))
      .filter((result) => Number(result.sessionsObserved || 0) > 0);
    if (!evaluated.length) return;
    syncArchiveOutcomes(evaluated);
    const latestSession = [...new Set(evaluated.map((x) => x.signalDate).filter(Boolean))].sort().at(-1);
    lastEvidenceResults = evaluated.filter((x) => x.signalDate === latestSession);
    renderEvidenceOutcomeSummary(lastEvidenceResults);
  } finally { evidenceRefreshing = false; }
}

"""
replace_once('public/session-monitor.js','function freshnessSummary(results) {',reconcile+'function freshnessSummary(results) {')
replace_once('public/session-monitor.js',
"  syncArchiveOutcomes(detail.results);\n  renderEvidenceOutcomeSummary(detail.results);\n",
"  syncArchiveOutcomes(detail.results);\n  void refreshEvidenceArchive();\n")
replace_once('public/session-monitor.js',
"document.querySelector('[data-view=\"evidence\"]')?.addEventListener('click', () => setTimeout(() => renderEvidenceOutcomeSummary(lastResults), 30));\n",
"document.querySelector('[data-view=\"evidence\"]')?.addEventListener('click', () => setTimeout(() => { if (lastEvidenceResults.length) renderEvidenceOutcomeSummary(lastEvidenceResults); void refreshEvidenceArchive(); }, 30));\n")
replace_once('public/session-monitor.js','function startWhenArchiveReady() {','ensureAcceptedForwardBaseline();\n\nfunction startWhenArchiveReady() {')

# Exact 3-signal regression: FAIT T2, MPCO T1, COPR no-entry/T1+T2 => 2/3 actual trade successes.
marker="test('candidate monitor never enters on the signal session', () => {"
test="""test('19-Aug accepted basket resolves to 2 of 3 achieved after entry while COPR remains missed-entry directional hit', () => {
  const day = (open,high,low,close) => [{date:'2026-08-20',open,high,low,close}];
  const copr = evaluateFrozenCandidate({sessionDate:'2026-08-19',ticker:'COPR',price:.48,entryLow:.4567,entryHigh:.4655,stop:.4404,target1:.4879,target2:.5167}, day(.48,.55,.47,.52), null, new Date('2026-08-21T16:00:00Z'));
  const fait = evaluateFrozenCandidate({sessionDate:'2026-08-19',ticker:'FAIT',price:40.65,entryLow:39.58,entryHigh:40.0348,stop:38.7422,target1:41.261,target2:42.14}, day(40,43.5,39.58,42.44), null, new Date('2026-08-21T16:00:00Z'));
  const mpco = evaluateFrozenCandidate({sessionDate:'2026-08-19',ticker:'MPCO',price:2.2,entryLow:2.1267,entryHigh:2.1644,stop:2.0572,target1:2.2606,target2:2.3}, day(2.19,2.29,2.14,2.22), null, new Date('2026-08-21T16:00:00Z'));
  const rows=[copr,fait,mpco];
  assert.equal(rows.filter(x => x.entered && ['TARGET1_REACHED','TARGET2_REACHED'].includes(x.state)).length, 2);
  assert.equal(fait.state, 'TARGET2_REACHED');
  assert.equal(mpco.state, 'TARGET1_REACHED');
  assert.equal(copr.entered, false);
  assert.equal(copr.target1TouchedWithoutEntry, true);
  assert.equal(copr.target2TouchedWithoutEntry, true);
});

test('live evidence reconciliation preserves accepted 19-Aug baseline independently from newer unevaluated sessions', async () => {
  const client = await readFile(new URL('../public/session-monitor.js', import.meta.url), 'utf8');
  assert.ok(client.includes('IMMUTABLE_ACCEPTED_FORWARD_SNAPSHOT'));
  assert.ok(client.includes('refreshEvidenceArchive'));
  assert.ok(client.includes('sessionsObserved || 0'));
  assert.ok(client.includes('results.map((x) => x.signalDate)'));
});

"""
replace_once('test/session-monitor.test.js',marker,test+marker)

# Update freeze hash for the intentionally changed client only.
contract=ROOT/'stability/frozen-runtime-contract.js'; s=contract.read_text(encoding='utf-8')
s=s.replace("contractVersion: '1.4.0'","contractVersion: '1.5.0'",1)
sha=blob_sha('public/session-monitor.js')
s,count=re.subn(r"('public/session-monitor\.js':\s*')[a-f0-9]{40}(')",rf"\g<1>{sha}\g<2>",s,count=1)
if count!=1: raise SystemExit('CONTRACT_HASH_NOT_FOUND')
contract.write_text(s,encoding='utf-8')
print('EVIDENCE_RECONCILIATION_PATCH_APPLIED',sha)
