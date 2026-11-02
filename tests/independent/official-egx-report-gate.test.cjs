'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {reportCheck}=require('../../scripts/independent/official-egx-report-gate.cjs');
const SESSION='2026-11-01',ISIN='EGS60121C018';
const price={expectedSession:SESSION,acceptedRows:152};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'egx-official-report-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'data/official-egx-reports');
 fs.mkdirSync(dir,{recursive:true});
 fs.mkdirSync(path.join(root,'data/history'),{recursive:true});
 const pdf=Buffer.from('%PDF-1.4\n'+'X'.repeat(120)+'\n%%EOF\n');
 fs.writeFileSync(path.join(dir,SESSION+'.pdf'),pdf);
 fs.writeFileSync(path.join(root,'data/symbol-map.json'),JSON.stringify({COMI:{ticker:'COMI',isin:ISIN,active:true}}));
 fs.writeFileSync(path.join(root,'data/history/COMI.json'),JSON.stringify({
  ticker:'COMI',isin:ISIN,sessions:[{date:SESSION,sourceSessionDate:SESSION,close:117.77,volume:3617630}]
 }));
 const manifest={schemaVersion:'egx-official-pdf-reconciliation-v1',session:SESSION,
  reviewMethod:'MANUAL_PDF_ROW_RECONCILIATION',reviewedAt:'2026-11-02T09:00:00Z',
  pdfSourceUrl:'https://www.egx.com.eg/en/Services_Reports.aspx',
  pdfSha256:crypto.createHash('sha256').update(pdf).digest('hex'),
  rows:[{ticker:'COMI',isin:ISIN,close:117.77,volume:3617630,sourcePage:1,verifiedAgainstPdf:true}]};
 const save=()=>fs.writeFileSync(path.join(dir,SESSION+'.json'),JSON.stringify(manifest));
 save();
 const check=(opts={})=>reportCheck(root,SESSION,price,{minRows:1,
  extractText:()=>SESSION+' COMI 117.77 3617630',...opts});
 return {root,dir,pdf,manifest,save,check};
}
test('no official PDF and reconciliation: fail closed',t=>{
 const f=fixture(t);
 fs.unlinkSync(path.join(f.dir,SESSION+'.pdf'));
 assert.equal(f.check().reason,'OFFICIAL_EGX_PDF_OR_RECONCILIATION_MISSING');
});
test('a matching reviewed PDF and persisted close/volume/ISIN passes only the evidence gate',t=>{
 const f=fixture(t);
 assert.equal(f.check().ok,true);
 assert.equal(reportCheck(f.root,SESSION,price,{extractText:()=>SESSION+' COMI'}).reason,
  'INSUFFICIENT_RECONCILED_SYMBOLS'); // Production floor is 80.
});
test('a forged date, hash or off-domain source cannot authorize publication',t=>{
 const f=fixture(t);
 f.manifest.session='2026-10-29';f.save();
 assert.equal(f.check().ok,false);
 f.manifest.session=SESSION;f.manifest.pdfSha256='0'.repeat(64);f.save();
 assert.equal(f.check().reason,'OFFICIAL_PDF_HASH_OR_MANIFEST_INVALID');
 f.manifest.pdfSha256=crypto.createHash('sha256').update(f.pdf).digest('hex');
 f.manifest.pdfSourceUrl='https://not-egx.example/report.pdf';f.save();
 assert.equal(f.check().reason,'INVALID_OFFICIAL_REPORT_URL');
});
test('PDF text must identify the actual report session and ticker',t=>{
 const f=fixture(t);
 assert.equal(f.check({extractText:()=> '2026-10-29 COMI'}).reason,'PDF_SESSION_DATE_NOT_VERIFIED');
 assert.equal(f.check({extractText:()=> SESSION+' WRONG'}).reason,'PDF_TICKER_NOT_FOUND');
 assert.equal(f.check({extractText:()=>{throw Error('scanned PDF')}}).reason,'OFFICIAL_PDF_TEXT_UNAVAILABLE');
});
test('row-level close, volume, ISIN and PDF page must be reconciled',t=>{
 const f=fixture(t);
 f.manifest.rows[0].volume++;f.save();
 assert.equal(f.check().reason,'OFFICIAL_VS_PERSISTED_CLOSE_VOLUME_MISMATCH');
 f.manifest.rows[0].volume--;f.manifest.rows[0].isin='EG0000000000';f.save();
 assert.equal(f.check().ok,false);
 f.manifest.rows[0].isin=ISIN;f.manifest.rows[0].sourcePage=0;f.save();
 assert.equal(f.check().reason,'INVALID_RECONCILED_ROW');
});
