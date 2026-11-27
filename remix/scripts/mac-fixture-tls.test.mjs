import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:https';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createFixtureTLS, createFixtureTLSFetch } from './mac-fixture-tls.mjs';
const exec = promisify(execFile);

test('ephemeral CA trusts only the exact canonical worker and wrong/untrusted roots fail normal TLS', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mac-fixture-tls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const correctDirectory = join(directory, 'correct'), wrongDirectory = join(directory, 'wrong');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(correctDirectory, { mode: 0o700 }); await mkdir(wrongDirectory, { mode: 0o700 });
  const correct = await createFixtureTLS(correctDirectory), wrong = await createFixtureTLS(wrongDirectory);
  const bytes = Buffer.from('synthetic-TLS-range');
  const server = createServer({ key: readFileSync(correct.keyFile), cert: readFileSync(correct.certFile) }, (request, response) => {
    if (request.headers.range !== `bytes=0-${bytes.length - 1}`) { response.writeHead(416); response.end(); return; }
    response.writeHead(206, { 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`, 'Content-Length': bytes.length }); response.end(bytes);
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `https://127.0.0.1:${server.address().port}`, url = origin + '/api/v1/attachments/local-object?sig=unit-only';
    const scoped = createFixtureTLSFetch(origin, correct.caFile);
    assert.equal((await scoped(url, { headers: { Range: `bytes=0-${bytes.length - 1}` } })).status, 206);
    await assert.rejects(createFixtureTLSFetch(origin, wrong.caFile)(url, { headers: { Range: `bytes=0-${bytes.length - 1}` } }), error => /CERT|ISSUER|VERIFY|SELF_SIGNED/.test(error.code));
    const probe = join(directory, 'other-child.cjs');
    await writeFile(probe, 'process.send({ trusted: Boolean(process.env.NODE_EXTRA_CA_CERTS) });', { mode: 0o600 });
    const code = `
      const cp=require('node:child_process');
      const {ResourceGovernor}=require(${JSON.stringify(resolve('../electron/lib/folder-resource-governor.cjs'))});
      const {governedDownload}=require(${JSON.stringify(resolve('../electron/lib/folder-transfer-process.cjs'))});
      (async()=>{
        const other=cp.fork(${JSON.stringify(probe)},[],{env:{PATH:process.env.PATH,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced'});
        const unrelated=await new Promise((resolve,reject)=>{other.once('message',resolve);other.once('error',reject);other.once('exit',code=>{if(code)reject(Error('Unrelated child failed'))})});
        const governor=new ResourceGovernor({downloadBytesPerSecond:5000000,cpuPercent:15});governor.totalBytesPerSecond=5000000;
        const target={url:${JSON.stringify(url)},headers:{Range:'bytes=0-${bytes.length-1}'},offset:0,length:${bytes.length},size:${bytes.length},expiresAt:new Date(Date.now()+60000).toISOString()};
        try{const result=await governedDownload(governor,target,AbortSignal.timeout(5000),()=>{},()=>target);console.log(JSON.stringify({ok:true,sha256:result.sha256,unrelatedTrusted:unrelated.trusted}));}
        catch(error){console.log(JSON.stringify({ok:false,code:error.code,unrelatedTrusted:unrelated.trusted}));}
      })().catch(()=>{process.exitCode=1});`;
    const run = async trust => {
      const args = [...(trust ? ['--require', resolve('scripts/mac-fixture-worker-trust.cjs')] : []), '-e', code];
      const env = { PATH: process.env.PATH, ...(trust ? { THINGTIME_FIXTURE_CA_FILE: trust.caFile, THINGTIME_FIXTURE_TLS_ROOT: trust.root } : {}) };
      const result = await exec(process.execPath, args, { env, timeout: 15000 });
      return JSON.parse(result.stdout.trim());
    };
    const accepted = await run(correct);
    assert.equal(accepted.ok, true); assert.equal(accepted.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(accepted.unrelatedTrusted, false);
    for (const trust of [wrong, null]) {
      const rejected = await run(trust);
      assert.equal(rejected.ok, false); assert.match(rejected.code, /CERT|ISSUER|VERIFY|SELF_SIGNED/); assert.equal(rejected.unrelatedTrusted, false);
    }
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
