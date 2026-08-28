import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { buildHeaders, buildTarget, getOrigin } from '../api/_proxy.js';

function mockRes(){
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k,v){this.headers[String(k).toLowerCase()]=v},
    end(v){this.body=v;return this}
  };
}

test('origin is immutable and rejects project aliases', () => {
  assert.match(getOrigin({}).hostname, /^egx-tfe-v20-fusion-rc2-[a-z0-9]+-/);
  assert.throws(() => getOrigin({RC2_ORIGIN:'https://egx-tfe-v20-fusion-rc2.vercel.app'}), /immutable/);
});

test('target preserves client query without leaking internal upstream parameter', () => {
  const url = buildTarget({query:{upstream:'/api/index',route:'scan',limit:'50'}}, {NODE_ENV:'test',RC2_ORIGIN:'http://127.0.0.1:9090'});
  assert.equal(url.href, 'http://127.0.0.1:9090/api/index?route=scan&limit=50');
});

test('automation bypass is sent only as an upstream header', () => {
  const h = buildHeaders({headers:{accept:'application/json'}}, {VERCEL_AUTOMATION_BYPASS_SECRET:'secret-value'});
  assert.equal(h.get('x-vercel-protection-bypass'), 'secret-value');
  assert.equal(h.get('x-vercel-set-bypass-cookie'), 'samesitenone');
});

test('protection redirect fails closed with an explicit 502', async () => {
  const originalFetch=global.fetch;
  global.fetch=async()=>new Response('Redirecting',{status:302,headers:{location:'https://vercel.com/sso-api?url=x'}});
  const old={...process.env};
  process.env.NODE_ENV='test'; process.env.RC2_ORIGIN='http://127.0.0.1:9090';
  try{
    const res=mockRes();
    await handler({method:'GET',headers:{},query:{upstream:'/'}},res);
    assert.equal(res.statusCode,502);
    assert.equal(res.headers['x-rc2-proxy-error'],'PROTECTION_BYPASS_REQUIRED');
    assert.match(String(res.body),/RC2_ORIGIN_PROTECTED/);
  } finally { global.fetch=originalFetch; process.env=old; }
});

test('successful upstream response is streamed and frame-deny headers are stripped', async () => {
  const originalFetch=global.fetch;
  global.fetch=async(_url,options)=>{
    assert.equal(options.headers.get('x-vercel-protection-bypass'),'bypass');
    return new Response('<html>ok</html>',{status:200,headers:{'content-type':'text/html','x-frame-options':'DENY','content-security-policy':"frame-ancestors 'none'"}});
  };
  const old={...process.env};
  process.env.NODE_ENV='test'; process.env.RC2_ORIGIN='http://127.0.0.1:9090'; process.env.VERCEL_AUTOMATION_BYPASS_SECRET='bypass';
  try{
    const res=mockRes();
    await handler({method:'GET',headers:{accept:'text/html'},query:{upstream:'/'}},res);
    assert.equal(res.statusCode,200);
    assert.equal(res.headers['x-frame-options'],undefined);
    assert.equal(res.headers['content-security-policy'],undefined);
    assert.equal(res.headers['x-rc2-shell'],'SAFE_SIDECAR_ONLY');
    assert.equal(Buffer.isBuffer(res.body),true);
    assert.equal(res.body.toString(),'<html>ok</html>');
  } finally { global.fetch=originalFetch; process.env=old; }
});
