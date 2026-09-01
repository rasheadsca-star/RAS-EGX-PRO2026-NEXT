#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { classifyRegimeFromUiSymbols } from '../src/research-market-regime.js';
import { createForwardShadowLedger, appendPublicationToForwardShadowLedger, verifyForwardShadowLedger } from '../src/research-forward-shadow-ledger.js';

const ROOT=process.cwd(),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const uiPath=path.join(ROOT,'data','research','ui','latest.json'),publicationPath=path.join(ROOT,'data','research','published','latest.json'),regimeDir=path.join(ROOT,'data','research','regime'),ledgerDir=path.join(ROOT,'data','research','shadow-ledger'),ledgerPath=path.join(ledgerDir,'latest.json');
if(!fs.existsSync(uiPath)||!fs.existsSync(publicationPath))throw new Error('REGIME_SHADOW_INPUTS_MISSING');const ui=read(uiPath),publication=read(publicationPath);if(ui.authorityMode!=='RESEARCH'||ui.productionAuthority!==false||publication.authorityMode!=='RESEARCH'||publication.productionAuthority!==false)throw new Error('REGIME_SHADOW_AUTHORITY_BOUNDARY');if(ui.session!==publication.signalSession)throw new Error('REGIME_PUBLICATION_SESSION_MISMATCH');
const regime=classifyRegimeFromUiSymbols(ui.symbols,{session:ui.session});fs.mkdirSync(regimeDir,{recursive:true});fs.writeFileSync(path.join(regimeDir,'latest.json'),JSON.stringify(regime,null,2)+'\n');
let ledger=fs.existsSync(ledgerPath)?read(ledgerPath):createForwardShadowLedger({startAfterSession:publication.signalSession});if(!verifyForwardShadowLedger(ledger))throw new Error('EXISTING_SHADOW_LEDGER_INVALID');ledger=appendPublicationToForwardShadowLedger(ledger,{publication,regime});if(!verifyForwardShadowLedger(ledger))throw new Error('UPDATED_SHADOW_LEDGER_INVALID');fs.mkdirSync(ledgerDir,{recursive:true});fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
console.log(JSON.stringify({session:regime.session,regime:regime.regime,coverage:regime.coverage,breadth:regime.breadth,policy:regime.policy,regimeHash:regime.regimeHash,shadowStartAfterSession:ledger.startAfterSession,shadowEntries:ledger.entries.length,shadowLedgerHash:ledger.ledgerHash},null,2));
