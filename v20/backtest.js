(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const load = async url => { const r = await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
  const card = (title, value, note, ok, tone='') => `<article class="evidence-card ${tone || (ok ? 'ok' : 'blocked')}"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;

  async function init() {
    try {
      const [policy, profiles, archive, forward, performance, operations, current] = await Promise.all([
        load('../data/v20/decision-intelligence-policy.json'), load('../data/v20/stock-profiles.json'), load('../data/v20/signal-archive/index.json'),
        load('../data/v20/forward-evaluation.json'), load('../data/v20/performance-evidence-registry.json'), load('../data/v20/release-operations.json'), load('../data/v20/current.json')
      ]);
      const entries = Array.isArray(archive.entries) ? archive.entries : [];
      const dates = [...new Set(entries.map(x=>x.sessionDate).filter(Boolean))];
      const evals = Array.isArray(forward.evaluations) ? forward.evaluations : [];
      const resolved = evals.filter(x=>x.status==='RESOLVED');
      const pending = evals.filter(x=>x.status==='PENDING');
      const v19Dev = (performance.entries||[]).find(x=>x.evidenceId==='V19_V6_DEVELOPMENT_OOS');
      const v19Reuse = (performance.entries||[]).find(x=>x.evidenceId==='V19_V6_REUSED_BENCHMARK');
      const v18Accepted = performance.policy?.v18PerformanceAccepted === true || operations.v18Reference?.performanceEvidenceAccepted === true;
      const historicalV20Snapshots = false;
      const independentHoldout = false;
      const enoughFreshForward = resolved.length > 0 && dates.length >= 20;
      const ready = historicalV20Snapshots && independentHoldout;
      const status = ready ? 'READY_FOR_INDEPENDENT_V20_SCORE_BACKTEST' : enoughFreshForward ? 'READY_FOR_FRESH_FORWARD_CALIBRATION_NOT_HISTORICAL_BACKTEST' : 'NOT_READY_FOR_INDEPENDENT_V20_SCORE_BACKTEST';

      $('state').textContent = status === 'NOT_READY_FOR_INDEPENDENT_V20_SCORE_BACKTEST' ? 'غير جاهز لمعايرة V20 Score' : status;
      $('state').className = ready ? 'good' : 'bad';
      $('session').textContent = `جلسة القرار ${current.sessionDate || '—'}`;
      $('archiveCount').textContent = String(entries.length);
      $('signalDates').textContent = `${dates.length} تاريخ إشارة مستقل`;
      $('forwardResolved').textContent = `${resolved.length} / ${evals.length}`;
      $('forwardPending').textContent = `${pending.length} Pending`;
      $('v19Dev').textContent = v19Dev ? `${v19Dev.sample?.sessions ?? '—'} جلسة` : 'غير متاح';
      $('holdout').textContent = independentHoldout ? 'متوفر' : 'غير متوفر';

      const evidence = [
        ['Decision score status', policy.status || profiles.decisionIntelligenceSummary?.status || '—', 'SHADOW_RESEARCH_ONLY_UNCALIBRATED مطلوب حاليًا', false, 'context'],
        ['Immutable V20 signals', `${entries.length} إصدار`, `${dates.length} تاريخ جلسة مستقل`, dates.length >= 20],
        ['Resolved V20 forward', `${resolved.length} نتيجة`, `${pending.length} ما زالت Pending`, resolved.length > 0],
        ['V19 Development OOS', v19Dev ? 'متوفر' : 'غير متوفر', 'دليل تطوير V19 فقط — ليس V20 Score backtest', Boolean(v19Dev), 'context'],
        ['V19 reused benchmark', v19Reuse ? 'متوفر' : 'غير متوفر', v19Reuse?.independence?.freshIndependentEvidence === false ? 'Non-independent / post-hoc' : 'راجع الاستقلالية', false, 'warning'],
        ['V18 performance', v18Accepted ? 'مقبول' : 'غير مقبول', operations.v18Reference?.auditStatus || 'غير مدقق', v18Accepted],
      ];
      $('evidenceGrid').innerHTML = evidence.map(x=>card(...x)).join('');

      const missing = [
        ['Point-in-time historical V20 score snapshots','غير متوفرة','لا توجد سلسلة تاريخية مجمدة لخصائص V20 Score قبل معرفة النتائج.'],
        ['Historical V20 score/outcome series','غير متوفرة','V19 historical performance لا يجوز إعادة تسميته كسلسلة V20 Score.'],
        ['Independent holdout for V20 Score','غير متوفر','مطلوب Holdout مستقل لم يرَه التصميم/المعايرة.'],
        ['Fresh resolved forward sample', enoughFreshForward ? 'بدأ يتوفر' : 'غير كافٍ', `${resolved.length} resolved عبر ${dates.length} signal dates؛ لا يكفي للمعايرة الحالية.`],
      ];
      $('missingGrid').innerHTML = missing.map(x=>card(x[0],x[1],x[2],false)).join('');

      const methodology = [
        'Frozen score version لكل إشارة', 'Point-in-time feature snapshot قبل outcome', 'منع future rows وlook-ahead',
        'الدخول من أول جلسة سوق مقبولة وفق السياسة المجمدة', 'Target/Stop ambiguity محافظة', 'تكلفة Round-trip مركزية',
        'فصل Development / Walk-forward / Holdout', 'Fresh independent holdout قبل أي production claim', 'فصل Research returns عن Applied Portfolio', 'الحفاظ على immutable signal hashes'
      ];
      $('methodology').innerHTML = methodology.map(x=>`<div><span>✓</span><strong>${esc(x)}</strong></div>`).join('');

      const claims = [
        ['V20 Score backtest claim', ready, 'ممنوع حتى تتوفر point-in-time history مستقلة أو evidence مكافئة.'],
        ['Calibrated alpha claim', false, 'ممنوع. Research heuristic غير معايرة.'],
        ['Target probability claim', false, 'ممنوع اشتقاق probability من Research Score.'],
        ['Profitability claim', false, 'ممنوع. لا يوجد V20 independent performance validation.'],
        ['V19 reused benchmark validates V20', false, 'ممنوع. Non-independent benchmark.'],
        ['Pending forward = 0%', false, 'ممنوع. Pending يظل null.'],
      ];
      $('claims').innerHTML = claims.map(([title,allowed,note])=>`<div class="claim"><span class="claim-state ${allowed?'allow':'deny'}">${allowed?'مسموح':'ممنوع'}</span><div><strong>${esc(title)}</strong><small>${esc(note)}</small></div></div>`).join('');
    } catch (error) {
      $('error').classList.remove('hidden'); $('error').textContent = `تعذر تحميل Backtest Readiness: ${error.message}`;
    }
  }
  init();
})();
