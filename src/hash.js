import { createHash } from 'node:crypto';
export function canonicalize(value){if(Array.isArray(value))return `[${value.map(canonicalize).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;return JSON.stringify(value)}
export function sha256(value){return createHash('sha256').update(typeof value==='string'?value:canonicalize(value)).digest('hex')}
