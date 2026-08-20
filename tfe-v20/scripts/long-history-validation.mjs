import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { validateLongHistories } from '../sidecars/long-history-validation.js';

const dir=process.argv[2];
if(!dir) throw new Error('USAGE: node scripts/long-history-validation.mjs <history-directory>');
const root=resolve(dir);
const files=(await readdir(root)).filter((x)=>x.endsWith('.json')).sort();
const histories=[];
for(const file of files){
  const raw=JSON.parse(await readFile(join(root,file),'utf8'));
  const ticker=String(raw.ticker??basename(file,'.json')).toUpperCase();
  const rows=raw.sessions??raw.rows??raw.bars??[];
  histories.push({ticker,rows});
}
const report=validateLongHistories(histories);
console.log(JSON.stringify({ok:true,...report},null,2));
