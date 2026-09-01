import { DEFAULT_SOURCE_POLICY } from './acquisition-policy.js';
import { validateSourceReceipt,validateIndependentReceipts } from './source-provenance.js';
import { validateOhlcvGeometry } from './market-data-semantics.js';

const HEX64=/^[0-9a-f]{64}$/i;
const norm=v=>String(v??'').trim().toUpperCase();
const uniq=a=>[...new Set((Array.isArray(a)?a:[]).map(norm).filter(Boolean))].sort();

export const LICENSED_EOD_ADMISSION_SCHEMA='licensed-eod-dataset-admission-1';

export function assessLicensedEodProviderCapability(evidence={}){
  const c=evidence?.capabilityEvidence??evidence;
  const reasons=[];
  if(!evidence?.provider) reasons.push('MISSING_PROVIDER');
  if(evidence?.candidateSourceId!=='LICENSED_EOD') reasons.push('SOURCE_ID_NOT_LICENSED_EOD');
  if(c?.egxCoveragePublished!==true) reasons.push('EGX_COVERAGE_NOT_PUBLISHED');
  if(c?.historicalAvailablePublished!==true) reasons.push('HISTORICAL_CAPABILITY_NOT_PUBLISHED');
  if(c?.endOfDayAvailablePublished!==true) reasons.push('EOD_CAPABILITY_NOT_PUBLISHED');
  if(c?.assetClassIncludesEquities!==true) reasons.push('EQUITY_CAPABILITY_NOT_PUBLISHED');
  if(c?.aggregatedOhlcBarsPublished!==true||c?.endOfDayOhlcBarsPublished!==true) reasons.push('TRUE_OHLC_CAPABILITY_NOT_PUBLISHED');
  const capabilityReady=reasons.length===0;
  return Object.freeze({
    schemaVersion:LICENSED_EOD_ADMISSION_SCHEMA,
    state:capabilityReady?'CAPABILITY_READY_DATASET_NOT_ADMITTED':'CAPABILITY_BLOCKED',
    capabilityReady,
    datasetReceiptReady:false,
    downstreamLineageEligible:false,
    productionAuthority:false,
    reasons:Object.freeze(reasons)
  });
}

function exactCoverage(expected,observed){
  const e=uniq(expected),o=uniq(observed),es=new Set(e),os=new Set(o);
  const missing=e.filter(x=>!os.has(x)),unexpected=o.filter(x=>!es.has(x));
  return {ready:e.length>0&&missing.length===0&&unexpected.length===0&&e.length===o.length,expected:e,observed:o,missing,unexpected};
}

function validateLicenseEvidence(licenseEvidence,provider){
  const reasons=[];
  if(!licenseEvidence||typeof licenseEvidence!=='object') return {ready:false,reasons:['LICENSE_ENTITLEMENT_EVIDENCE_REQUIRED']};
  if(norm(licenseEvidence.provider)!==norm(provider)) reasons.push('LICENSE_PROVIDER_MISMATCH');
  if(licenseEvidence.entitlementConfirmed!==true) reasons.push('LICENSE_ENTITLEMENT_NOT_CONFIRMED');
  if(licenseEvidence.permittedApplicationUseConfirmed!==true) reasons.push('LICENSE_APPLICATION_USE_NOT_CONFIRMED');
  if(!HEX64.test(String(licenseEvidence.licenseReceiptHash??''))) reasons.push('LICENSE_RECEIPT_HASH_INVALID');
  return {ready:reasons.length===0,reasons};
}

export function assessLicensedEodDatasetCandidate({
  capabilityEvidence,
  licenseEvidence,
  datasetReceipt,
  rawPayload,
  session,
  expectedTradeBarIds=[],
  bars=[],
  parserId,
  parserVersion,
  fieldSemanticsVerified=false,
  independentCrossCheckReceipt=null,
  sourcePolicy=DEFAULT_SOURCE_POLICY
}={}){
  const reasons=[];
  const capability=assessLicensedEodProviderCapability(capabilityEvidence??{});
  if(!capability.capabilityReady) reasons.push(...capability.reasons.map(x=>`CAPABILITY:${x}`));

  const provider=capabilityEvidence?.provider??null;
  const license=validateLicenseEvidence(licenseEvidence,provider);
  reasons.push(...license.reasons);

  const policy=sourcePolicy?.LICENSED_EOD;
  let receiptCheck={state:'BLOCKED',reasons:['DATASET_RECEIPT_REQUIRED'],receipt:null};
  if(datasetReceipt){
    receiptCheck=validateSourceReceipt(datasetReceipt,{policy,rawPayload});
    if(receiptCheck.state!=='READY') reasons.push(...receiptCheck.reasons.map(x=>`DATASET_RECEIPT:${x}`));
  }else reasons.push('DATASET_RECEIPT_REQUIRED');

  if(!session) reasons.push('SESSION_REQUIRED');
  if(datasetReceipt?.session&&session&&datasetReceipt.session!==session) reasons.push('DATASET_SESSION_MISMATCH');
  if(!parserId||!parserVersion) reasons.push('PARSER_ID_VERSION_REQUIRED');
  if(fieldSemanticsVerified!==true) reasons.push('TRUE_OHLCV_FIELD_SEMANTICS_NOT_VERIFIED');

  const normalizedBars=(Array.isArray(bars)?bars:[]).map(bar=>({
    id:norm(bar?.id??bar?.isin??bar?.ticker),
    session:String(bar?.session??''),
    bar
  }));
  const duplicateBarIds=normalizedBars.map(x=>x.id).filter((id,i,a)=>id&&a.indexOf(id)!==i);
  if(duplicateBarIds.length) reasons.push('DUPLICATE_BAR_IDENTITIES');
  const invalidBars=[];
  const wrongSessionBars=[];
  for(const item of normalizedBars){
    if(!item.id){invalidBars.push('MISSING_IDENTITY');continue;}
    if(item.session!==session) wrongSessionBars.push(item.id);
    const geometry=validateOhlcvGeometry(item.bar);
    if(!geometry.valid) invalidBars.push(item.id);
  }
  if(wrongSessionBars.length) reasons.push('BAR_SESSION_MISMATCH');
  if(invalidBars.length) reasons.push('INVALID_TRUE_OHLCV_BAR');

  const coverage=exactCoverage(expectedTradeBarIds,normalizedBars.map(x=>x.id));
  if(!coverage.expected.length) reasons.push('EXPECTED_TRADE_BAR_UNIVERSE_REQUIRED');
  if(coverage.missing.length) reasons.push('TRADE_BAR_COVERAGE_MISSING');
  if(coverage.unexpected.length) reasons.push('TRADE_BAR_COVERAGE_UNEXPECTED');

  let independence={state:'BLOCKED',reasons:['INDEPENDENT_CROSS_CHECK_RECEIPT_REQUIRED']};
  if(receiptCheck.receipt&&independentCrossCheckReceipt){
    independence=validateIndependentReceipts(receiptCheck.receipt,independentCrossCheckReceipt);
    if(independence.state!=='READY') reasons.push(...independence.reasons.map(x=>`INDEPENDENCE:${x}`));
  }else reasons.push('INDEPENDENT_CROSS_CHECK_RECEIPT_REQUIRED');

  const uniqueReasons=[...new Set(reasons)].sort();
  const candidateReady=uniqueReasons.length===0;
  return Object.freeze({
    schemaVersion:LICENSED_EOD_ADMISSION_SCHEMA,
    state:candidateReady?'READY_FOR_DOWNSTREAM_HISTORICAL_LINEAGE':'BLOCKED',
    candidateReady,
    capabilityReady:capability.capabilityReady,
    licenseReady:license.ready,
    datasetReceiptReady:receiptCheck.state==='READY',
    fieldSemanticsVerified:fieldSemanticsVerified===true,
    parserBound:Boolean(parserId&&parserVersion),
    exactTradeBarCoverageReady:coverage.ready,
    independentCrossCheckReady:independence.state==='READY',
    coverage:Object.freeze({expectedCount:coverage.expected.length,observedCount:coverage.observed.length,missing:Object.freeze(coverage.missing),unexpected:Object.freeze(coverage.unexpected)}),
    invalidBarIds:Object.freeze([...new Set(invalidBars)].sort()),
    wrongSessionBarIds:Object.freeze([...new Set(wrongSessionBars)].sort()),
    reasons:Object.freeze(uniqueReasons),
    downstreamLineageEligible:candidateReady,
    productionAuthority:false,
    phase4Open:false,
    note:'READY_FOR_DOWNSTREAM_HISTORICAL_LINEAGE is not Production authority. Each admitted bar still requires historical observation lineage/certificate verification and the normal Phase 3 gates.'
  });
}
