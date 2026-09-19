#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic } from '../src/store.js';
import { emptyV3Ledger, updateV3ForwardLedger } from '../src/forward-shadow-v3.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),data=path.join(root,'data'),scan=readJson(path.join(data,'current-scan.json'),null);if(!scan)throw new Error('CURRENT_SCAN_REQUIRED');
const file=path.join(data,'research','full-structure-v3-forward.json'),ledger=readJson(file,emptyV3Ledger()),next=updateV3ForwardLedger(ledger,scan);writeJsonAtomic(file,next);console.log(JSON.stringify(next.summary,null,2));
