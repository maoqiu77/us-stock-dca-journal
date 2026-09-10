import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProbeWithoutRedirects } from '../src/dev/probe-transport.ts';

test('transport rejects cleartext and URL credentials before native I/O', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return { status: 200 }; };
  for (const url of ['http://localhost:8843/ok','https://user:secret@localhost:8843/ok','file:///tmp/a']) {
    await assert.rejects(fetchProbeWithoutRedirects(fetcher,url));
  }
  assert.equal(calls,0);
});
test('transport pins redirect rejection, omits cookies and uses only a synthetic marker', async () => {
  await fetchProbeWithoutRedirects(async (url,init) => {
    assert.equal(url,'https://localhost:8843/ok');
    assert.equal(init.redirect,'error');
    assert.equal(init.credentials,'omit');
    assert.equal(init.headers.Authorization,'Bearer synthetic-public-probe');
    assert.ok(init.signal instanceof AbortSignal);
    return {status:200};
  },'https://localhost:8843/ok');
});
test('hung native transport is aborted within its explicit probe timeout', async () => {
  await assert.rejects(fetchProbeWithoutRedirects((_url,init)=>new Promise((_resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  }),'https://localhost:8843/hang',5),/aborted/);
});
