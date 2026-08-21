from pathlib import Path
import hashlib,re
ROOT=Path(__file__).resolve().parents[1]
def rep(rel,a,b):
 p=ROOT/rel;s=p.read_text(encoding='utf-8')
 if a not in s: raise SystemExit('MARKER:'+a[:80])
 p.write_text(s.replace(a,b,1),encoding='utf-8')
def sha(rel):
 b=(ROOT/rel).read_bytes();return hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()
rep('public/session-monitor.js',
"    #${PANEL_ID} .sm-outcome-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 13px}#${PANEL_ID} .sm-kpi{padding:11px 12px;border:1px solid #24566a;border-radius:11px;background:#071823}#${PANEL_ID} .sm-kpi small{display:block;color:#8eacbc;font-size:10px;margin-bottom:4px}#${PANEL_ID} .sm-kpi b{display:block;font-size:21px}#${PANEL_ID} .sm-kpi span{font-size:11px;color:#b7ced9}\n",
"    #${PANEL_ID} .sm-outcome-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 13px}#${PANEL_ID} .sm-kpi{padding:11px 12px;border:1px solid #24566a;border-radius:11px;background:#071823}#${PANEL_ID} .sm-kpi small{display:block;color:#8eacbc;font-size:10px;margin-bottom:4px}#${PANEL_ID} .sm-kpi b{display:block;font-size:21px}#${PANEL_ID} .sm-kpi span{font-size:11px;color:#b7ced9}\n    #${PANEL_ID} .sm-evidence-banner{margin:0 0 13px;padding:12px 14px;border:1px solid #2d7358;border-radius:12px;background:#0a2b29;line-height:1.75;color:#d8eee7}#${PANEL_ID} .sm-evidence-banner b{color:#7de0b3}#${PANEL_ID} .sm-evidence-banner span{color:#b9d5cd}\n")
rep('public/session-monitor.js',
"  const outcome = outcomeSummary(results);\n  const phaseLabel",
"  const outcome = outcomeSummary(results);\n  const completedEvidence = outcomeSummary(lastEvidenceResults);\n  const completedSession = [...new Set(lastEvidenceResults.map((x) => x.signalDate).filter(Boolean))].sort().at(-1) || null;\n  const phaseLabel")
rep('public/session-monitor.js',
"    <div class=\"sm-source\"><span>${esc(phaseLabel)} · القاهرة ${esc(phase.time)}</span><span>آخر جلب: ${lastGeneratedAt ? esc(new Date(lastGeneratedAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})) : '—'} · Poll 5m · Source delay 15m</span></div>\n    ${results.length ? `<div class=\"sm-outcome-summary\">",
"    <div class=\"sm-source\"><span>${esc(phaseLabel)} · القاهرة ${esc(phase.time)}</span><span>آخر جلب: ${lastGeneratedAt ? esc(new Date(lastGeneratedAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})) : '—'} · Poll 5m · Source delay 15m</span></div>\n    ${completedSession ? `<div class=\"sm-evidence-banner\"><b>آخر توصيات مكتملة التقييم: ${esc(completedSession)} — تحقق فعلي ${completedEvidence.achieved}/${completedEvidence.total}</b><br><span>${completedEvidence.achievedPct === null ? '—' : pct(completedEvidence.achievedPct)} حققت هدفًا بعد تفعيل الدخول · لم يتفعل الدخول ${completedEvidence.missedEntry}/${completedEvidence.total}${completedEvidence.targetsWithoutEntry ? ` · ${completedEvidence.targetsWithoutEntry} منها لمس الأهداف بدون دخول` : ''}</span></div>` : ''}\n    ${results.length ? `<div class=\"sm-outcome-summary\">")
rep('public/session-monitor.js',
"    renderEvidenceOutcomeSummary(lastEvidenceResults);\n  } finally",
"    renderEvidenceOutcomeSummary(lastEvidenceResults);\n    render(readFrozenSignals(), lastResults, null);\n  } finally")
rep('test/session-monitor.test.js',
"  assert.ok(client.includes('results.map((x) => x.signalDate)'));\n});",
"  assert.ok(client.includes('results.map((x) => x.signalDate)'));\n  assert.ok(client.includes('آخر توصيات مكتملة التقييم'));\n  assert.ok(client.includes('completedEvidence.achieved'));\n});")
contract=ROOT/'stability/frozen-runtime-contract.js';s=contract.read_text(encoding='utf-8');s=s.replace("contractVersion: '1.5.0'","contractVersion: '1.6.0'",1);h=sha('public/session-monitor.js');s,n=re.subn(r"('public/session-monitor\.js':\s*')[a-f0-9]{40}(')",rf"\g<1>{h}\g<2>",s,count=1);assert n==1;contract.write_text(s,encoding='utf-8');print('BANNER_PATCH',h)
