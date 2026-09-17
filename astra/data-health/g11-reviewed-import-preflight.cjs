'use strict';

const fs = require('fs');
const path = require('path');
const { validateSession } = require('../../scripts/history/history-validator.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const fail = (m) => { throw new Error(m); };
const EXPECTED_SESSION = '2026-09-16';

const staged = read('data/history-fallback-import.json');
const report = read('docs/astra/G11_REVIEWED_IMPORT_VALIDATION.json');
const symbolMap = read('data/symbol-map.json');

if (report.expectedSession !== EXPECTED_SESSION) fail(`review_expected_session:${report.expectedSession}`);
if (report.policy?.carryForwardForbidden !== true) fail('carry_forward_policy_not_forbidden');
if (report.policy?.syntheticValuesForbidden !== true) fail('synthetic_values_policy_not_forbidden');
if (report.policy?.acceptanceCriteriaUnchanged !== true) fail('acceptance_criteria_changed');

const accepted = [...(report.acceptedTickers || [])].sort();
const rejected = [...(report.rejectedTickers || [])].sort();
if (JSON.stringify(accepted) !== JSON.stringify(['AIHC'])) fail(`accepted_set:${accepted.join(',')}`);
if (JSON.stringify(rejected) !== JSON.stringify(['ALRA','NAPR'])) fail(`rejected_set:${rejected.join(',')}`);

const stagedRecords = Array.isArray(staged.records) ? staged.records : [];
if (stagedRecords.length !== 1 || stagedRecords[0]?.ticker !== 'AIHC') fail('staged_import_must_contain_aihc_only');
const aihc = stagedRecords[0];
if (aihc.source !== 'approved_csv' || aihc.approved !== true || aihc.symbolVerified !== true) fail('aihc_import_metadata_invalid');
if (!symbolMap.AIHC || symbolMap.AIHC.active === false) fail('aihc_missing_or_inactive_symbol_map');
if (!Array.isArray(aihc.sessions) || aihc.sessions.length !== 1) fail('aihc_session_count_invalid');
const aihcValidation = validateSession({ ticker:'AIHC', ...aihc.sessions[0] });
if (!aihcValidation.valid) fail(`aihc_ohlc_invalid:${aihcValidation.errors.join(',')}`);
if (aihc.sessions[0].date !== EXPECTED_SESSION) fail(`aihc_wrong_session:${aihc.sessions[0].date}`);
if (Number(aihc.sessions[0].volume) !== 27971185) fail('aihc_exact_volume_changed');

const byTicker = new Map((report.records || []).map((x) => [x.ticker, x]));
const alra = byTicker.get('ALRA');
if (!alra || alra.disposition !== 'REJECTED') fail('alra_must_be_rejected');
if (alra.sourceTicker !== 'AIFI' || alra.symbolIdentity !== 'PASS_EXPLICIT_ALIAS') fail('alra_aifi_identity_not_explicit');
if (alra.volumeEvidence !== 'FAIL_EXACT_SESSION_PROVENANCE') fail('alra_rejection_not_volume_provenance');
if (!symbolMap.ALRA || symbolMap.ALRA.active === false || !symbolMap.AIFI || symbolMap.AIFI.active === false) fail('alra_aifi_symbol_map_identity_missing');
const alraNames = `${symbolMap.ALRA.companyNameEn || ''} ${symbolMap.AIFI.companyNameEn || ''}`.toLowerCase();
if (!alraNames.includes('atlas') || !alraNames.includes('investment') || !alraNames.includes('food')) fail('alra_aifi_company_identity_not_consistent');
const alraProposal = validateSession({ticker:'ALRA',date:EXPECTED_SESSION,open:2.42,high:2.43,low:2.38,close:2.41,volume:1322104,currency:'EGP'});
if (!alraProposal.valid) fail(`alra_ohlc_should_be_valid:${alraProposal.errors.join(',')}`);
if (stagedRecords.some((x) => x.ticker === 'ALRA')) fail('alra_must_not_be_staged');

const napr = byTicker.get('NAPR');
if (!napr || napr.disposition !== 'REJECTED') fail('napr_must_be_rejected');
const naprProposal = validateSession({ticker:'NAPR',date:EXPECTED_SESSION,open:35.09,high:42.1,low:35.19,close:42.1,volume:1882239,currency:'EGP'});
if (naprProposal.valid || !naprProposal.errors.includes('low_above_open')) fail(`napr_guard_not_enforced:${naprProposal.errors.join(',')}`);
if (napr.ohlcInvariant !== 'FAIL_LOW_ABOVE_OPEN') fail('napr_report_reason_changed');
if (stagedRecords.some((x) => x.ticker === 'NAPR')) fail('napr_must_not_be_staged');

for (const rec of stagedRecords) {
  for (const s of rec.sessions || []) {
    if (String(s.date) !== EXPECTED_SESSION) fail(`non_expected_session_staged:${rec.ticker}:${s.date}`);
  }
}

const evidence = {
  schemaVersion:'astra-g11-reviewed-import-preflight-1',
  generatedAt:process.env.G11_EVALUATED_AT || new Date().toISOString(),
  expectedSession:EXPECTED_SESSION,
  accepted:[{ticker:'AIHC',reason:'EXACT_IDENTITY_EXPECTED_SESSION_OHLCV_VALID'}],
  rejected:[
    {ticker:'ALRA',reason:'EXACT_SESSION_VOLUME_PROVENANCE_INSUFFICIENT',identity:'ALRA_TO_AIFI_EXPLICITLY_VALIDATED'},
    {ticker:'NAPR',reason:'OHLC_INVARIANT_LOW_ABOVE_OPEN'}
  ],
  stagedTickers:stagedRecords.map((x)=>x.ticker),
  noCarryForward:true,
  acceptanceCriteriaUnchanged:true,
};
fs.writeFileSync(path.join(ROOT,'docs/astra/G11_REVIEWED_IMPORT_PREFLIGHT.json'), JSON.stringify(evidence,null,2)+'\n');
console.log('G11_REVIEWED_IMPORT_PREFLIGHT '+JSON.stringify(evidence));
