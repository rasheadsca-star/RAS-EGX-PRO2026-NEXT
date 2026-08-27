import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export default async function handler(req,res){
  try{
    let html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
    html=html.replace('</head>','<link rel="stylesheet" href="/portfolio-monitor.css?v=1"></head>');
    html=html.replace('</body>','<script defer src="/portfolio-monitor.js?v=1"></script></body>');
    res.statusCode=200;
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store');
    res.end(html);
  }catch(error){
    res.statusCode=500;res.setHeader('content-type','text/plain; charset=utf-8');res.end(`SEPA-X shell unavailable: ${error?.message||error}`);
  }
}
